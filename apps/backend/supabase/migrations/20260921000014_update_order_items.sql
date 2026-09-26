-- [S2-02] 14 — operator order edits: update_order_items(order_id, items) (api-contracts §6.8)
-- Staff (owner / operator) only, while status ∈ {new, accepted, preparing}. Replaces the positions
-- with the given list (same item shape as quote_order), re-quotes server-side with the order's own
-- type / zone / promo / slot / tip, updates the totals, marks changed rows modified_by_operator,
-- writes order_events(item_changed, payload = diff). Stripe: an authorized intent caps the new
-- total (amount_exceeds_authorization); below the cap a `update_amount` job is queued.

create or replace function public.update_order_items(order_id uuid, items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     public.staff_role := public.auth_role();
  v_uid      uuid := auth.uid();
  o          public.orders;
  v_q        jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_promo    public.promo_codes;
  v_promo_disc integer;
  v_promo_base integer;
  v_pickup_disc integer;
  v_subtotal integer;
  v_discount integer;
  v_fee      integer;
  v_total    integer;
  v_vat      integer;
  v_keep_promo boolean := true;
  v_before   jsonb;
  v_after    jsonb := '[]'::jsonb;
  v_old_sigs text[];
  v_sig      text;
  l          jsonb;
  p          jsonb;
  v_cap      integer;
begin
  -- v_role is null for anon / non-staff — `not in` would evaluate to NULL, so test it explicitly
  if v_role is null or v_role not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;
  select * into o from public.orders where id = update_order_items.order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if o.status not in ('new', 'accepted', 'preparing') then
    raise exception 'order_not_editable' using errcode = 'P0001',
      detail = format('status %s — positions can be edited while new / accepted / preparing', o.status);
  end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'order_rejected' using errcode = 'P0001',
      detail = '[{"code":"empty_cart"}]', hint = 'items must be a non-empty array of {item_id, qty, option_ids?}';
  end if;

  -- re-quote with the order's own parameters (never trust client totals)
  v_q := public.quote_order(jsonb_strip_nulls(jsonb_build_object(
    'type', o.type,
    'items', items,
    'postal_code', o.address->>'postal_code',
    'promo_code', o.promo_code,
    'scheduled_for', o.scheduled_for,
    'tip_cents', o.tip_cents,
    'contact', jsonb_build_object('phone', o.contact_phone)
  )));

  -- problems that matter for an edit: the order already exists, so opening hours / slot / kitchen
  -- pause (`closed`) and the zone minimum are the operator's call; item / option validity is not.
  for p in select value from jsonb_array_elements(v_q->'problems') loop
    case p->>'code'
      when 'closed', 'below_min_order' then null;
      when 'promo_invalid' then
        -- temporal reasons: the code was valid when the order was placed → keep honouring it
        if p->>'reason' in ('not_first_order', 'limit_reached', 'expired', 'not_yet_valid', 'wrong_day', 'too_late') then
          v_keep_promo := true;
        else
          v_keep_promo := false; -- min_order / category_not_in_cart / unknown → promo dropped
        end if;
      else
        v_problems := v_problems || p;
    end case;
  end loop;
  if jsonb_array_length(v_problems) > 0 then
    raise exception 'order_rejected' using errcode = 'P0001', detail = v_problems::text,
      hint = 'See details for problems [{code, item_id?, reason?}]';
  end if;

  ------------------------------------------------------------ totals
  v_subtotal    := (v_q->>'subtotal_cents')::integer;
  v_pickup_disc := (v_q->>'pickup_discount_cents')::integer;
  v_fee         := (v_q->>'delivery_fee_cents')::integer;
  v_promo_disc  := coalesce((v_q->>'promo_discount_cents')::integer, 0);

  if o.promo_code is not null and v_keep_promo and v_q->'promo' is null then
    -- recompute the discount from the promo row (quote refused it for a temporal reason)
    select * into v_promo from public.promo_codes where code = o.promo_code;
    if found then
      case coalesce(v_promo.applies_to->>'scope', 'all')
        when 'category' then
          select coalesce(sum((ln->>'line_total_cents')::integer), 0) into v_promo_base
          from jsonb_array_elements(v_q->'lines') ln
          where ln->>'category_id' = v_promo.applies_to->>'category_id';
        else
          v_promo_base := v_subtotal;
      end case;
      v_promo_disc := case v_promo.kind
        when 'percent' then round(v_promo_base * v_promo.value / 100.0)::integer
        else least(v_promo.value, v_promo_base)
      end;
    end if;
  elsif o.promo_code is not null and not v_keep_promo then
    v_promo_disc := 0;
  end if;

  v_discount := least(v_subtotal, v_pickup_disc + v_promo_disc);
  v_total    := v_subtotal - v_discount + v_fee + o.tip_cents;
  -- VAT as in quote_order: line VAT share × (subtotal − discount) / subtotal + fee VAT (19 %)
  v_vat := round(
    case when v_subtotal > 0 then
      (select sum((ln->>'line_total_cents')::numeric * mi.vat_delivery_pct / (100 + mi.vat_delivery_pct))
         from jsonb_array_elements(v_q->'lines') ln
         join public.menu_items mi on mi.id = (ln->>'item_id')::uuid)
      * (v_subtotal - v_discount)::numeric / v_subtotal
    else 0 end
    + v_fee * 19.0 / 119.0)::integer;

  ------------------------------------------------------------ Stripe cap
  if o.payment_provider = 'stripe' and o.payment_status = 'authorized' then
    v_cap := coalesce(o.payment_authorized_cents, o.total_cents);
    if v_total > v_cap then
      raise exception 'amount_exceeds_authorization' using errcode = 'P0001',
        detail = format('new total %s > authorized %s', v_total, v_cap),
        hint = 'Cancel and re-order, or take the difference in cash';
    end if;
  end if;

  ------------------------------------------------------------ replace positions
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.item_id, 'name', i.name, 'qty', i.qty, 'unit_price_cents', i.unit_price_cents,
           'options', i.options, 'line_total_cents', i.line_total_cents) order by i.created_at), '[]'::jsonb),
         coalesce(array_agg(i.item_id::text || '|' || i.qty || '|' ||
           (select coalesce(string_agg(x->>'option_id', ',' order by x->>'option_id'), '')
              from jsonb_array_elements(i.options) x)), '{}')
    into v_before, v_old_sigs
    from public.order_items i where i.order_id = o.id;

  delete from public.order_items where order_items.order_id = o.id;

  for l in select value from jsonb_array_elements(v_q->'lines') loop
    v_sig := (l->>'item_id') || '|' || (l->>'qty') || '|' ||
             (select coalesce(string_agg(x->>'option_id', ',' order by x->>'option_id'), '')
                from jsonb_array_elements(l->'options') x);
    insert into public.order_items (order_id, item_id, name, qty, unit_price_cents, options, line_total_cents, modified_by_operator)
    values (o.id, (l->>'item_id')::uuid, l->>'name', (l->>'qty')::integer,
            (l->>'unit_price_cents')::integer, l->'options', (l->>'line_total_cents')::integer,
            not (v_sig = any (v_old_sigs)));
    v_after := v_after || jsonb_build_object(
      'item_id', l->>'item_id', 'name', l->>'name', 'qty', (l->>'qty')::integer,
      'unit_price_cents', (l->>'unit_price_cents')::integer, 'options', l->'options',
      'line_total_cents', (l->>'line_total_cents')::integer,
      'modified', not (v_sig = any (v_old_sigs)));
  end loop;

  update public.orders
     set subtotal_cents = v_subtotal,
         discount_cents = v_discount,
         delivery_fee_cents = v_fee,
         total_cents = v_total,
         vat_cents = v_vat,
         promo_code = case when v_keep_promo then promo_code else null end
   where id = o.id
  returning * into o;

  insert into public.order_events (order_id, type, actor_type, actor_id, payload)
  values (o.id, 'item_changed', 'staff', v_uid, jsonb_build_object(
    'before', v_before, 'after', v_after,
    'totals', jsonb_build_object(
      'subtotal_cents_before', (select coalesce(sum((x->>'line_total_cents')::integer), 0) from jsonb_array_elements(v_before) x),
      'subtotal_cents', v_subtotal, 'discount_cents', v_discount,
      'delivery_fee_cents', v_fee, 'total_cents', v_total, 'vat_cents', v_vat),
    'promo_dropped', (not v_keep_promo)));

  -- Stripe: keep the intent in step with the new total (the worker decides what Stripe allows)
  if o.payment_provider = 'stripe' and o.payment_status in ('pending', 'authorized') then
    perform public.enqueue_payment_job(o.id, 'update_amount', v_total);
  end if;

  return to_jsonb(o) || jsonb_build_object('items', v_after);
end;
$$;

revoke execute on function public.update_order_items(uuid, jsonb) from public;
grant execute on function public.update_order_items(uuid, jsonb) to authenticated, service_role;
