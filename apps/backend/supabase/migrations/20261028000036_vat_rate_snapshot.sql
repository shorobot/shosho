-- [S2-08] 36 — D-022: snapshot the VAT rate on the order line at write time
--
-- `order_items` already freezes `name`, `unit_price_cents` and `line_total_cents` off the menu item
-- *because menu values drift* — `item_id` is even `on delete set null` so a deleted item leaves the
-- line intact. The VAT rate drifts identically and was the one thing not copied: it lived only on
-- `menu_items.vat_delivery_pct` and was read **live** at calculation time (`rpc.sql:237`,
-- `update_order_items.sql:119`). So this is an existing principle applied consistently, not a new one.
--
-- Two consequences, the second of which is a live correctness bug rather than a reporting gap:
--
--   1. Nothing recorded the rate an order actually used, so the per-rate split a German invoice is
--      normally expected to show is not derivable for any past order.
--   2. `update_order_items` recomputed an existing order's VAT by joining **today's** `menu_items`.
--      After the rates change, editing one position on a filed order silently rewrote its tax.
--
-- Owner action D9 sets the real 7 / 19 rates per item with the Steuerberater. The moment it runs,
-- every order placed before this migration loses its true rate irrecoverably. Hence the sequencing:
-- this lands first. It does NOT set, choose or suggest any rate — that is D9's, and the
-- Steuerberater's.
--
-- NO BACKFILL, deliberately. Pre-migration rows keep `vat_pct = null`, which is the true statement
-- "the rate this line used is not recorded anywhere". Backfilling by joining today's `menu_items`
-- would reprice a filed period — the exact error D-022 exists to prevent — and it would look like
-- completeness. Per-rate reporting therefore states the split as unavailable for the pre-migration
-- window, with the reason, rather than inventing a number.

alter table public.order_items add column if not exists vat_pct numeric(4,2);
alter table public.orders      add column if not exists delivery_fee_vat_pct numeric(4,2);

comment on column public.order_items.vat_pct is
  'Snapshot of the VAT rate (percent, gross-inclusive) this line''s tax was actually computed with, '
  'written by place_order / update_order_items in the same statement as the line — the rate column '
  'to the name / unit_price_cents / line_total_cents snapshots beside it. Null = the line was filed '
  'before migration 36 and its true rate is not recorded anywhere; it must NOT be filled by joining '
  'public.menu_items, whose rate is today''s and would reprice a filed period (D-022).';

comment on column public.orders.delivery_fee_vat_pct is
  'Snapshot of the VAT rate the delivery fee''s tax was computed with. Written on every order from '
  'migration 36 on, including orders with no fee (where it contributes nothing), so that null means '
  'exactly "filed before migration 36". The rate itself is still the hardcoded 19 in quote_order: '
  'whether a delivery fee is 19 % at all is a tax question for the owner''s Steuerberater, filed by '
  'D-022 and not decided here (D9).';

----------------------------------------------------------------
-- quote_order — emits the per-line rate it used, and the fee rate, so the writers below store the
-- same read rather than looking the rate up a second time. Arithmetic unchanged: the fee literal
-- `19.0 / 119.0` becomes `v_fee_vat_pct / (100 + v_fee_vat_pct)`, which is numerically identical
-- (verified exhaustively over 0..2000 cents, equal as numerics, not merely after rounding).
----------------------------------------------------------------

create or replace function public.quote_order(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type      public.order_type;
  v_items     jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_postal    text  := nullif(trim(coalesce(payload->>'postal_code', '')), '');
  v_promo     text  := upper(nullif(trim(coalesce(payload->>'promo_code', '')), ''));
  v_sched     timestamptz := nullif(payload->>'scheduled_for', '')::timestamptz;
  v_phone     text  := public.normalize_phone(payload->'contact'->>'phone');
  v_tip       integer := greatest(coalesce((payload->>'tip_cents')::integer, 0), 0);
  v_loc       timestamp := coalesce(v_sched, now()) at time zone 'Europe/Berlin';
  v_ops       jsonb;
  v_kitchen   jsonb;
  v_rush      integer := 0;
  v_lines     jsonb := '[]'::jsonb;
  v_problems  jsonb := '[]'::jsonb;
  v_cat_tot   jsonb := '{}'::jsonb;    -- category_id → cents (for category-scoped promos)
  v_subtotal  integer := 0;
  v_vat_lines numeric := 0;
  v_pickup_disc integer := 0;
  v_promo_disc  integer := 0;
  v_discount  integer := 0;
  v_fee       integer := 0;
  v_total     integer := 0;
  v_vat       integer := 0;
  v_promised  integer;
  -- D-022: the delivery fee's VAT rate. Still a hardcoded 19 — this does NOT give it a source
  -- (that is a tax question for the owner's Steuerberater, filed not decided). It names the
  -- literal once so the rate *used* and the rate *recorded* cannot drift apart.
  v_fee_vat_pct numeric(4,2) := 19.0;
  v_zone      public.delivery_zones;
  v_zone_json jsonb;
  v_promo_row public.promo_codes;
  v_promo_json jsonb;
  v_promo_base integer;
  v_promo_bad text;
  -- per line
  r          jsonb;
  it         public.menu_items;
  cat        public.menu_categories;
  v_item_id  uuid;
  v_qty      integer;
  v_opt_ids  uuid[];
  v_line_opts jsonb;
  v_opt_sum  integer;
  v_line_total integer;
  g          record;
  o          record;
  n_sel      integer;
begin
  -- type
  begin
    v_type := (payload->>'type')::public.order_type;
  exception when others then
    v_type := null;
  end;
  if v_type is null then
    v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'type');
    v_type := 'pickup';
  end if;

  select value into v_ops     from public.settings where key = 'ops';
  select value into v_kitchen from public.settings where key = 'kitchen';
  v_ops     := coalesce(v_ops, '{}'::jsonb);
  v_kitchen := coalesce(v_kitchen, '{}'::jsonb);
  if coalesce((v_kitchen->>'rush')::boolean, false) then
    v_rush := coalesce((v_ops->>'rush_extra_min')::integer, 15);
  end if;

  ------------------------------------------------------------ lines
  if jsonb_typeof(v_items) <> 'array' then v_items := '[]'::jsonb; end if;
  for r in select value from jsonb_array_elements(v_items) loop
    begin
      v_item_id := (r->>'item_id')::uuid;
    exception when others then
      v_item_id := null;
    end;
    v_qty := coalesce((r->>'qty')::integer, 1);
    if v_item_id is null or v_qty < 1 then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'items', 'item_id', r->>'item_id');
      continue;
    end if;

    select * into it from public.menu_items where id = v_item_id;
    if not found or not public.menu_item_on_sale(it) then
      v_problems := v_problems || jsonb_build_object('code', 'unavailable', 'item_id', v_item_id);
      continue;
    end if;
    select * into cat from public.menu_categories where id = it.category_id;
    -- category schedule (e.g. lunch Mo–Fr until 15:00)
    if cat.schedule is not null then
      if (cat.schedule ? 'days' and not (cat.schedule->'days') @> to_jsonb(extract(isodow from v_loc)::integer))
         or (cat.schedule ? 'until' and v_loc::time >= (cat.schedule->>'until')::time) then
        v_problems := v_problems || jsonb_build_object('code', 'unavailable', 'item_id', v_item_id, 'reason', 'schedule');
        continue;
      end if;
    end if;
    if it.max_per_order is not null and v_qty > it.max_per_order then
      v_problems := v_problems || jsonb_build_object('code', 'unavailable', 'item_id', v_item_id, 'reason', 'max_per_order', 'max', it.max_per_order);
      continue;
    end if;
    if it.stock_remaining is not null and v_qty > it.stock_remaining then
      v_problems := v_problems || jsonb_build_object('code', 'unavailable', 'item_id', v_item_id, 'reason', 'stock', 'remaining', it.stock_remaining);
      continue;
    end if;

    -- options
    v_opt_ids := '{}';
    begin
      select coalesce(array_agg(x::uuid), '{}') into v_opt_ids
      from jsonb_array_elements_text(coalesce(r->'option_ids', '[]'::jsonb)) x;
    exception when others then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_options', 'item_id', v_item_id, 'reason', 'bad_option_id');
      continue;
    end;
    v_line_opts := '[]'::jsonb;
    v_opt_sum := 0;
    -- every selected option must belong to a group linked to this item and be active
    for o in
      select sel as option_id, op.id as found_id, op.active, op.group_id
      from unnest(v_opt_ids) sel
      left join public.options op on op.id = sel
      left join public.menu_item_option_groups m on m.group_id = op.group_id and m.item_id = it.id
      where op.id is null or not op.active or m.item_id is null
    loop
      v_problems := v_problems || jsonb_build_object('code', 'invalid_options', 'item_id', v_item_id, 'option_id', o.option_id);
    end loop;
    -- group rules (min / max / required)
    for g in
      select og.*, m.sort as m_sort
      from public.menu_item_option_groups m
      join public.option_groups og on og.id = m.group_id
      where m.item_id = it.id
      order by m.sort
    loop
      select count(*) into n_sel from public.options op
      where op.group_id = g.id and op.id = any (v_opt_ids) and op.active;
      if (g.required and n_sel < greatest(g.min_select, 1))
         or n_sel < g.min_select
         or (g.max_select is not null and n_sel > g.max_select) then
        v_problems := v_problems || jsonb_build_object('code', 'invalid_options', 'item_id', v_item_id, 'group_id', g.id,
                        'min', g.min_select, 'max', g.max_select, 'selected', n_sel);
      end if;
      -- snapshot the selected options of this group
      for o in
        select op.id, op.name_de, op.name_en, op.price_cents
        from public.options op
        where op.group_id = g.id and op.id = any (v_opt_ids) and op.active
        order by op.sort
      loop
        v_line_opts := v_line_opts || jsonb_build_object(
          'group_id', g.id, 'group', g.name_en, 'group_de', g.name_de,
          'option_id', o.id, 'option', o.name_en, 'option_de', o.name_de,
          'price_cents', o.price_cents);
        v_opt_sum := v_opt_sum + o.price_cents;
      end loop;
    end loop;

    v_line_total := (it.base_price_cents + v_opt_sum) * v_qty;
    v_subtotal := v_subtotal + v_line_total;
    v_vat_lines := v_vat_lines + v_line_total * it.vat_delivery_pct / (100 + it.vat_delivery_pct);
    v_cat_tot := jsonb_set(v_cat_tot, array[it.category_id::text],
                   to_jsonb(coalesce((v_cat_tot->>(it.category_id::text))::integer, 0) + v_line_total));
    v_lines := v_lines || jsonb_build_object(
      'item_id', it.id, 'sku', it.sku, 'category_id', it.category_id,
      'name', it.name_en, 'name_de', it.name_de, 'name_en', it.name_en, 'name_ja', it.name_ja,
      'qty', v_qty, 'unit_price_cents', it.base_price_cents,
      -- D-022: the rate this line's VAT was actually computed with, two lines above. Emitted here
      -- so place_order / update_order_items store the same read, not a second lookup.
      'vat_pct', it.vat_delivery_pct,
      'options', v_line_opts, 'options_cents', v_opt_sum,
      'line_total_cents', v_line_total,
      'prep_minutes', it.prep_minutes, 'allergens', to_jsonb(it.allergens));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    v_problems := v_problems || jsonb_build_object('code', 'empty_cart');
  end if;

  ------------------------------------------------------------ time / kitchen
  if v_sched is null then
    if coalesce((v_kitchen->>'paused')::boolean, false) then
      v_problems := v_problems || jsonb_build_object('code', 'closed', 'reason', 'kitchen_paused');
    elsif not public.shop_open_at(now()) then
      v_problems := v_problems || jsonb_build_object('code', 'closed', 'reason', 'outside_hours');
    end if;
  else
    if v_sched < now() + interval '15 minutes' then
      v_problems := v_problems || jsonb_build_object('code', 'closed', 'reason', 'slot_too_soon');
    elsif v_sched > now() + make_interval(days => coalesce((v_ops->>'preorder_max_days')::integer, 7)) then
      v_problems := v_problems || jsonb_build_object('code', 'closed', 'reason', 'slot_too_far');
    elsif not public.shop_open_at(v_sched) then
      v_problems := v_problems || jsonb_build_object('code', 'closed', 'reason', 'slot_outside_hours');
    end if;
  end if;

  ------------------------------------------------------------ zone / fee / pickup
  if v_type = 'delivery' then
    if v_postal is null then
      v_problems := v_problems || jsonb_build_object('code', 'out_of_zone', 'reason', 'postal_code_missing');
    else
      select * into v_zone from public.delivery_zones z
      where z.active and v_postal = any (z.postal_codes)
      order by z.code limit 1;
      if not found then
        v_problems := v_problems || jsonb_build_object('code', 'out_of_zone', 'postal_code', v_postal);
      else
        v_zone_json := jsonb_build_object(
          'id', v_zone.id, 'code', v_zone.code, 'name', v_zone.name,
          'min_order_cents', v_zone.min_order_cents, 'fee_cents', v_zone.fee_cents,
          'free_delivery_over_cents', v_zone.free_delivery_over_cents,
          'promised_minutes', v_zone.promised_minutes);
        if v_subtotal < v_zone.min_order_cents then
          v_problems := v_problems || jsonb_build_object('code', 'below_min_order',
                          'min_order_cents', v_zone.min_order_cents, 'subtotal_cents', v_subtotal);
        end if;
        v_fee := case when v_zone.free_delivery_over_cents is not null and v_subtotal >= v_zone.free_delivery_over_cents
                      then 0 else v_zone.fee_cents end;
        v_promised := v_zone.promised_minutes + v_rush;
      end if;
    end if;
  else
    v_pickup_disc := round(v_subtotal * coalesce((v_ops->>'pickup_discount_pct')::numeric, 10) / 100)::integer;
    v_promised := coalesce((v_ops->>'prep_default_min')::integer, 22) + v_rush;
  end if;

  ------------------------------------------------------------ promo
  if v_promo is not null then
    select * into v_promo_row from public.promo_codes where code = v_promo;
    v_promo_bad := null;
    if not found or not v_promo_row.active then
      v_promo_bad := 'unknown';
    elsif v_promo_row.valid_from is not null and now() < v_promo_row.valid_from then
      v_promo_bad := 'not_yet_valid';
    elsif v_promo_row.valid_to is not null and now() > v_promo_row.valid_to then
      v_promo_bad := 'expired';
    elsif v_promo_row.usage_limit is not null and v_promo_row.used_count >= v_promo_row.usage_limit then
      v_promo_bad := 'limit_reached';
    elsif v_subtotal < v_promo_row.min_order_cents then
      v_promo_bad := 'min_order';
    elsif v_promo_row.applies_to ? 'days'
          and not (v_promo_row.applies_to->'days') @> to_jsonb(extract(isodow from v_loc)::integer) then
      v_promo_bad := 'wrong_day';
    elsif v_promo_row.applies_to ? 'until' and v_loc::time >= (v_promo_row.applies_to->>'until')::time then
      v_promo_bad := 'too_late';
    end if;

    if v_promo_bad is null then
      case coalesce(v_promo_row.applies_to->>'scope', 'all')
        when 'all' then
          v_promo_base := v_subtotal;
        when 'category' then
          v_promo_base := coalesce((v_cat_tot->>(v_promo_row.applies_to->>'category_id'))::integer, 0);
          if v_promo_base = 0 then v_promo_bad := 'category_not_in_cart'; end if;
        when 'first_order' then
          v_promo_base := v_subtotal;
          -- checked only when a phone is known (place_order always passes it)
          if v_phone is not null and exists (
               select 1 from public.customers cu join public.orders ord on ord.customer_id = cu.id
               where cu.phone = v_phone and ord.status not in ('cancelled', 'refunded')) then
            v_promo_bad := 'not_first_order';
          end if;
        else
          v_promo_bad := 'bad_scope';
      end case;
    end if;

    if v_promo_bad is null then
      v_promo_disc := case v_promo_row.kind
        when 'percent' then round(v_promo_base * v_promo_row.value / 100.0)::integer
        else least(v_promo_row.value, v_promo_base)
      end;
      v_promo_json := jsonb_build_object('code', v_promo_row.code, 'kind', v_promo_row.kind,
                        'value', v_promo_row.value, 'discount_cents', v_promo_disc,
                        'scope', coalesce(v_promo_row.applies_to->>'scope', 'all'));
    else
      v_problems := v_problems || jsonb_build_object('code', 'promo_invalid', 'promo_code', v_promo, 'reason', v_promo_bad);
    end if;
  end if;

  ------------------------------------------------------------ totals
  v_discount := least(v_subtotal, v_pickup_disc + v_promo_disc);
  v_total := v_subtotal - v_discount + v_fee + v_tip;
  v_vat := round(
    case when v_subtotal > 0 then v_vat_lines * (v_subtotal - v_discount)::numeric / v_subtotal else 0 end
    + v_fee * v_fee_vat_pct / (100 + v_fee_vat_pct))::integer;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_problems) = 0,
    'type', v_type,
    'scheduled_for', v_sched,
    'lines', v_lines,
    'subtotal_cents', v_subtotal,
    'pickup_discount_cents', v_pickup_disc,
    'promo_discount_cents', v_promo_disc,
    'discount_cents', v_discount,
    'delivery_fee_cents', v_fee,
    'tip_cents', v_tip,
    'total_cents', v_total,
    'vat_cents', v_vat,
    'delivery_fee_vat_pct', v_fee_vat_pct,
    'zone', v_zone_json,
    'promised_minutes', v_promised,
    'promo', v_promo_json,
    'problems', v_problems
  );
end;
$$;

----------------------------------------------------------------
-- place_order — writes each line%s rate in the same statement as the line
----------------------------------------------------------------

create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      public.staff_role := public.auth_role();
  v_channel   public.order_channel;
  v_q         jsonb;
  v_problems  jsonb := '[]'::jsonb;
  v_name      text := nullif(trim(coalesce(payload->'contact'->>'name', '')), '');
  v_phone     text := public.normalize_phone(payload->'contact'->>'phone');
  v_email     text := nullif(lower(trim(coalesce(payload->'contact'->>'email', ''))), '');
  v_addr_in   jsonb := payload->'address';
  v_address   jsonb;
  v_pm        public.payment_method;
  v_ps        public.payment_status;
  v_ps_in     text;
  v_staff_paid boolean := false;
  v_flags     text[];
  v_cust      public.customers;
  v_order     public.orders;
  v_ops       jsonb;
  v_kitchen   jsonb;
  l           jsonb;
begin
  -- channel: guests are always 'website'; staff (phone orders) may pass another channel
  if v_role in ('owner', 'operator') then
    begin
      v_channel := coalesce(nullif(payload->>'channel', ''), 'website')::public.order_channel;
    exception when others then
      v_channel := 'website';
    end;
  else
    v_channel := 'website';
  end if;

  -- input validation (things quote_order does not look at)
  if v_name is null then
    v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'contact.name');
  end if;
  if v_phone is null then
    v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'contact.phone');
  end if;
  begin
    v_pm := (payload->>'payment_method')::public.payment_method;
  exception when others then
    v_pm := null;
  end;
  if v_pm is null then
    v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'payment_method');
  end if;
  -- §5.6 / S7-01 finding 1: **the caller does not get to say whether money moved.**
  -- A guest (anon, or any non-staff session) may only ever create a `pending` order. `authorized`
  -- means "a provider is holding an authorization we can capture" and is reachable from exactly one
  -- place — `record_payment_event`, fed by a signature-verified Stripe webhook. Sending anything
  -- else is refused loudly rather than silently coerced, so an attempt shows up as a rejected order
  -- instead of looking like it worked.
  begin
    v_ps_in := nullif(payload->>'payment_status', '');
  exception when others then
    v_ps_in := null;
  end;
  if v_role is not null and v_role in ('owner', 'operator') then
    -- staff taking a phone order may record money already in hand (counter cash, card terminal).
    -- `paid` is the only extra state they may set, it is audited below, and `authorized` stays
    -- provider-only for them too.
    begin
      v_ps := coalesce(v_ps_in, 'pending')::public.payment_status;
    exception when others then
      v_ps := null;
    end;
    if v_ps is null or v_ps not in ('pending', 'paid') then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'payment_status',
        'reason', 'staff may record pending or paid; authorized comes from the payment provider');
    end if;
    v_staff_paid := coalesce(v_ps = 'paid', false);
  else
    if v_ps_in is not null and v_ps_in <> 'pending' then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'payment_status',
        'reason', 'a guest order is always created pending; authorization comes from the payment provider');
    end if;
    v_ps := 'pending';
  end if;
  if payload->>'type' = 'delivery' then
    if v_addr_in is null
       or nullif(trim(coalesce(v_addr_in->>'street', '')), '') is null
       or nullif(trim(coalesce(v_addr_in->>'postal_code', '')), '') is null then
      v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'address');
    else
      v_address := jsonb_strip_nulls(jsonb_build_object(
        'street', trim(v_addr_in->>'street'),
        'floor_apt', nullif(trim(coalesce(v_addr_in->>'floor_apt', '')), ''),
        'postal_code', trim(v_addr_in->>'postal_code'),
        'city', coalesce(nullif(trim(coalesce(v_addr_in->>'city', '')), ''), 'Berlin')));
      -- zone resolution uses the address postal code
      payload := payload || jsonb_build_object('postal_code', v_address->>'postal_code');
    end if;
  end if;
  begin
    select coalesce(array_agg(x), '{}') into v_flags
    from jsonb_array_elements_text(coalesce(payload->'comment_flags', '[]'::jsonb)) x;
  exception when others then
    v_flags := '{}';
  end;

  -- server-side quote — never trust client totals
  v_q := public.quote_order(payload || jsonb_build_object('contact', jsonb_build_object('phone', v_phone)));
  v_problems := v_problems || (v_q->'problems');
  if jsonb_array_length(v_problems) > 0 then
    -- §1.5: the client records the rejected checkout with the problems[] it gets back here —
    -- this transaction is about to roll back, so place_order cannot write the row itself.
    raise exception 'order_rejected' using errcode = 'P0001', detail = v_problems::text,
      hint = 'problems [{code, item_id?, reason?}]; record it with rpc record_order_attempt';
  end if;

  select value into v_ops     from public.settings where key = 'ops';
  select value into v_kitchen from public.settings where key = 'kitchen';
  v_ops     := coalesce(v_ops, '{}'::jsonb);
  v_kitchen := coalesce(v_kitchen, '{}'::jsonb);

  -- customer upsert by phone (guest checkout, no account)
  insert into public.customers (name, phone, email)
  values (v_name, v_phone, v_email)
  on conflict (phone) do update
    set name  = excluded.name,
        email = coalesce(excluded.email, customers.email)
  returning * into v_cust;

  if v_address is not null and not exists (
       select 1 from public.customer_addresses a
       where a.customer_id = v_cust.id
         and a.street = v_address->>'street' and a.postal_code = v_address->>'postal_code') then
    insert into public.customer_addresses (customer_id, street, floor_apt, postal_code, city, zone_id, is_default)
    values (v_cust.id, v_address->>'street', v_address->>'floor_apt', v_address->>'postal_code',
            v_address->>'city', (v_q->'zone'->>'id')::uuid,
            not exists (select 1 from public.customer_addresses a where a.customer_id = v_cust.id));
  end if;

  -- order
  perform set_config('shosho.actor_type', 'customer', true);
  perform set_config('shosho.actor_id', v_cust.id::text, true);

  insert into public.orders (
    channel, type, status, payment_status, payment_method, payment_ref,
    customer_id, contact_name, contact_phone, address, zone_id,
    courier_comment, comment_flags, allergy_note, scheduled_for, promised_minutes,
    subtotal_cents, discount_cents, delivery_fee_cents, tip_cents, total_cents, vat_cents, promo_code,
    delivery_fee_vat_pct
  ) values (
    v_channel, (v_q->>'type')::public.order_type, 'new', v_ps, v_pm,
    -- payment_ref is display text ("Visa ···4417"). For a guest it is an unverified claim, so it is
    -- dropped; the real one is written by the Stripe webhook. Staff may record a terminal reference.
    case when v_role is not null and v_role in ('owner', 'operator')
         then nullif(payload->>'payment_ref', '') end,
    v_cust.id, v_name, v_phone, v_address, (v_q->'zone'->>'id')::uuid,
    nullif(trim(coalesce(payload->>'courier_comment', '')), ''), v_flags, v_cust.kitchen_note,
    (v_q->>'scheduled_for')::timestamptz, (v_q->>'promised_minutes')::integer,
    (v_q->>'subtotal_cents')::integer, (v_q->>'discount_cents')::integer, (v_q->>'delivery_fee_cents')::integer,
    (v_q->>'tip_cents')::integer, (v_q->>'total_cents')::integer, (v_q->>'vat_cents')::integer,
    v_q->'promo'->>'code',
    -- D-022: the fee rate this order's vat_cents was computed with, from the same quote
    (v_q->>'delivery_fee_vat_pct')::numeric(4,2)
  ) returning * into v_order;

  for l in select value from jsonb_array_elements(v_q->'lines') loop
    insert into public.order_items (order_id, item_id, name, qty, unit_price_cents, options, line_total_cents,
                                    vat_pct)
    values (v_order.id, (l->>'item_id')::uuid, l->>'name', (l->>'qty')::integer,
            (l->>'unit_price_cents')::integer, l->'options', (l->>'line_total_cents')::integer,
            -- D-022: same statement as the line, same read as the quote that priced it
            (l->>'vat_pct')::numeric(4,2));
  end loop;

  -- stock bookkeeping for limited items
  update public.menu_items i
     set stock_remaining = greatest(i.stock_remaining - s.qty, 0)
    from (select (ln->>'item_id')::uuid as item_id, sum((ln->>'qty')::integer) as qty
            from jsonb_array_elements(v_q->'lines') ln group by 1) s
   where i.id = s.item_id and i.stock_remaining is not null;

  insert into public.order_events (order_id, type, actor_type, actor_id, payload)
  values (v_order.id, 'created', 'customer', v_cust.id,
          jsonb_build_object('channel', v_channel, 'type', v_order.type, 'total_cents', v_order.total_cents,
                             'payment_method', v_pm, 'payment_status', v_ps,
                             'scheduled_for', v_order.scheduled_for, 'promo_code', v_order.promo_code));
  -- A staff-recorded payment is the one remaining way an order can start out already paid, so it
  -- is audited: who recorded it, by what method, for how much (§1.4 `note {text, code?}`).
  if v_staff_paid then
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (v_order.id, 'note', 'staff', auth.uid(),
            jsonb_build_object('text', 'Payment recorded by staff at order entry',
                               'code', 'payment_recorded_by_staff',
                               'payment_method', v_pm,
                               'payment_ref', v_order.payment_ref,
                               'amount_cents', v_order.total_cents,
                               'channel', v_channel));
  end if;

  -- auto-accept: only off a payment state someone vouched for. A guest order is always `pending`
  -- here, so this now fires solely for a staff-recorded `paid`; the Stripe path auto-accepts in
  -- `record_payment_event` when the authorization actually arrives (migration 11).
  if v_ps = 'paid'
     and v_order.scheduled_for is null
     and not coalesce((v_kitchen->>'paused')::boolean, false)
     and v_order.total_cents < coalesce((v_ops->>'auto_accept_paid_under_cents')::integer, 0) then
    perform set_config('shosho.actor_type', 'system', true);
    perform set_config('shosho.actor_id', '', true);
    update public.orders set status = 'accepted' where id = v_order.id returning * into v_order;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'number', v_order.number,
    'total_cents', v_order.total_cents,
    'tracking_token', v_order.tracking_token,
    'status', v_order.status
  );
end;
$$;

----------------------------------------------------------------
-- update_order_items — reads the order%s OWN snapshot instead of joining menu_items, so editing
-- a filed order reproduces its own tax and not today%s. A newly added position has no snapshot and
-- takes the freshly quoted rate, which is the only rate it can have.
----------------------------------------------------------------

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
  -- D-022 ------------------------------------------------------------------
  -- v_rate_map : item_id -> the VAT rate THIS order was filed with (order_items.vat_pct).
  --              Read once, before the positions are deleted, and used both to compute the new
  --              vat_cents and to write the new lines — so the rate used and the rate recorded
  --              cannot come from two different reads.
  -- v_lines    : the re-quoted lines with each line's rate resolved to the order's own rate
  --              where it has one, and to the freshly quoted rate for a newly added item.
  -- Nothing here joins public.menu_items: an edit must not reprice a filed order's tax at
  -- today's rates, which is exactly what the old menu_items join did.
  v_rate_map    jsonb;
  v_lines       jsonb := '[]'::jsonb;
  v_fee_vat_pct numeric(4,2);
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

  ------------------------------------------------------------ D-022: the order's own rates
  -- Earliest row per item wins: that is the rate the order was originally filed with, even if a
  -- later edit re-added the same item at a different rate. Lines whose item_id went null
  -- (`on delete set null`) cannot be keyed and fall through to the quoted rate below.
  select coalesce(jsonb_object_agg(item_id::text, vat_pct), '{}'::jsonb) into v_rate_map
    from (select distinct on (i.item_id) i.item_id, i.vat_pct
            from public.order_items i
           where i.order_id = o.id and i.item_id is not null and i.vat_pct is not null
           order by i.item_id, i.created_at) s;

  -- Pre-migration orders have no snapshot, so the fee falls back to the rate the code has always
  -- used. That reproduces the old arithmetic byte-for-byte rather than inventing a number.
  v_fee_vat_pct := coalesce(o.delivery_fee_vat_pct, (v_q->>'delivery_fee_vat_pct')::numeric(4,2));

  -- `with ordinality` + `order by` is load-bearing: line order decides the inserted rows'
  -- created_at order, which is what the Detail screen's before/after diff and the returned
  -- `items` array are ordered by. jsonb_agg without an explicit ORDER BY does not guarantee it.
  select coalesce(jsonb_agg(
           ln || jsonb_build_object('vat_pct',
             coalesce(v_rate_map->>(ln->>'item_id'), ln->>'vat_pct')::numeric(4,2))
           order by ord
         ), '[]'::jsonb) into v_lines
    from jsonb_array_elements(v_q->'lines') with ordinality as t(ln, ord);

  -- Invariant, not a reachable branch: quote_order emits vat_pct on every line, so the coalesce
  -- above cannot come out null. It is asserted because the failure would be silent and monetary —
  -- sum() skips nulls, so one unrated line would quietly contribute 0 VAT to a filed order.
  if exists (select 1 from jsonb_array_elements(v_lines) ln where ln->>'vat_pct' is null) then
    raise exception 'vat_rate_unresolved' using errcode = 'P0001',
      detail = 'a re-quoted line carries no vat_pct; refusing to recompute vat_cents from it',
      hint = 'quote_order must emit vat_pct per line (migration 36)';
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
  -- VAT as in quote_order: line VAT share × (subtotal − discount) / subtotal + fee VAT.
  -- D-022: the per-line rate now comes from v_lines (the order's own snapshot where it has one),
  -- not from a live menu_items join. The proration and the rounding are untouched on purpose —
  -- changing them would move vat_cents on existing orders.
  v_vat := round(
    case when v_subtotal > 0 then
      (select sum((ln->>'line_total_cents')::numeric * (ln->>'vat_pct')::numeric
                  / (100 + (ln->>'vat_pct')::numeric))
         from jsonb_array_elements(v_lines) ln)
      * (v_subtotal - v_discount)::numeric / v_subtotal
    else 0 end
    + v_fee * v_fee_vat_pct / (100 + v_fee_vat_pct))::integer;

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

  for l in select value from jsonb_array_elements(v_lines) loop
    v_sig := (l->>'item_id') || '|' || (l->>'qty') || '|' ||
             (select coalesce(string_agg(x->>'option_id', ',' order by x->>'option_id'), '')
                from jsonb_array_elements(l->'options') x);
    insert into public.order_items (order_id, item_id, name, qty, unit_price_cents, options, line_total_cents, modified_by_operator,
                                    vat_pct)
    values (o.id, (l->>'item_id')::uuid, l->>'name', (l->>'qty')::integer,
            (l->>'unit_price_cents')::integer, l->'options', (l->>'line_total_cents')::integer,
            not (v_sig = any (v_old_sigs)),
            -- D-022: the same resolved rate v_vat above was computed from
            (l->>'vat_pct')::numeric(4,2));
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
         -- D-022: records the fee rate this edit actually used (the order's own, or the fallback
         -- for an order filed before the snapshot existed)
         delivery_fee_vat_pct = v_fee_vat_pct,
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

-- `create or replace function` preserves the existing ACL; restated so this migration is explicit
-- and idempotent on a fresh database.
revoke execute on function public.quote_order(jsonb)                from public;
revoke execute on function public.place_order(jsonb)                from public;
revoke execute on function public.update_order_items(uuid, jsonb)   from public, anon;
grant  execute on function public.quote_order(jsonb)                to anon, authenticated, service_role;
grant  execute on function public.place_order(jsonb)                to anon, authenticated, service_role;
grant  execute on function public.update_order_items(uuid, jsonb)   to authenticated, service_role;
