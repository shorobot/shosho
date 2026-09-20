-- [S2-01] 10 — RPCs (api-contracts §2): quote_order, place_order, set_order_status,
--                get_order_by_token, kitchen_pause (+ internal helpers).
-- All RPCs are security definer; anon reaches orders/customers only through them.

---------------------------------------------------------------- helpers

-- German-friendly E.164 normalisation: "0176 123 45 67" → "+491761234567". Returns null when invalid.
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare p text := regexp_replace(coalesce(raw, ''), '[\s\-\(\)\./]', '', 'g');
begin
  if p like '00%' then p := '+' || substr(p, 3);
  elsif p like '0%' then p := '+49' || substr(p, 2);
  end if;
  if p ~ '^\+[1-9][0-9]{6,14}$' then return p; end if;
  return null;
end;
$$;

-- Is the shop open at ts (Europe/Berlin) per settings.opening_hours?
-- Shape: {"mon":[["11:00","23:00"]], … "sun":[["12:00","22:00"]], "holidays":["2026-12-25"]}
create or replace function public.shop_open_at(ts timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h    jsonb;
  loc  timestamp := ts at time zone 'Europe/Berlin';
  dkey text := lower(to_char(loc, 'dy'));
  r    jsonb;
  t    time := loc::time;
  t_to time;
begin
  select value into h from public.settings where key = 'opening_hours';
  if h is null then return true; end if;
  if h->'holidays' ? loc::date::text then return false; end if;
  for r in select value from jsonb_array_elements(coalesce(h->dkey, '[]'::jsonb)) loop
    t_to := case when r->>1 = '24:00' then '24:00:00'::time else (r->>1)::time end;
    if t >= (r->>0)::time and t < t_to then return true; end if;
  end loop;
  return false;
end;
$$;

-- Status machine (§2 set_order_status). Pure.
create or replace function public.order_transition_allowed(
  from_status public.order_status, to_status public.order_status,
  otype public.order_type, pstatus public.payment_status
)
returns boolean
language sql
immutable
as $$
  select case from_status
    when 'new'              then to_status in ('accepted', 'cancelled')
    when 'accepted'         then to_status in ('preparing', 'cancelled')
    when 'preparing'        then to_status in ('ready', 'cancelled')
    when 'ready'            then (to_status = 'out_for_delivery' and otype = 'delivery')
                                 or (to_status = 'picked_up' and otype = 'pickup')
                                 or to_status = 'cancelled'
    when 'out_for_delivery' then to_status in ('delivered', 'cancelled')
    when 'delivered'        then to_status = 'refunded' and pstatus = 'paid'
    when 'picked_up'        then to_status = 'refunded' and pstatus = 'paid'
    else false
  end
$$;

---------------------------------------------------------------- quote_order

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
  v_when      timestamptz := coalesce(v_sched, now());
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
               select 1 from public.customers c join public.orders o on o.customer_id = c.id
               where c.phone = v_phone and o.status not in ('cancelled', 'refunded')) then
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
    + v_fee * 19.0 / 119.0)::integer;

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
    'zone', v_zone_json,
    'promised_minutes', v_promised,
    'promo', v_promo_json,
    'problems', v_problems
  );
end;
$$;

---------------------------------------------------------------- place_order

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
  begin
    v_ps := coalesce(nullif(payload->>'payment_status', ''), 'pending')::public.payment_status;
  exception when others then
    v_ps := null;
  end;
  if v_ps is null or v_ps not in ('pending', 'authorized') then
    v_problems := v_problems || jsonb_build_object('code', 'invalid_input', 'field', 'payment_status');
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
    raise exception 'order_rejected' using errcode = 'P0001', detail = v_problems::text,
      hint = 'See details for problems [{code, item_id?, reason?}]';
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
    subtotal_cents, discount_cents, delivery_fee_cents, tip_cents, total_cents, vat_cents, promo_code
  ) values (
    v_channel, (v_q->>'type')::public.order_type, 'new', v_ps, v_pm, nullif(payload->>'payment_ref', ''),
    v_cust.id, v_name, v_phone, v_address, (v_q->'zone'->>'id')::uuid,
    nullif(trim(coalesce(payload->>'courier_comment', '')), ''), v_flags, v_cust.kitchen_note,
    (v_q->>'scheduled_for')::timestamptz, (v_q->>'promised_minutes')::integer,
    (v_q->>'subtotal_cents')::integer, (v_q->>'discount_cents')::integer, (v_q->>'delivery_fee_cents')::integer,
    (v_q->>'tip_cents')::integer, (v_q->>'total_cents')::integer, (v_q->>'vat_cents')::integer,
    v_q->'promo'->>'code'
  ) returning * into v_order;

  for l in select value from jsonb_array_elements(v_q->'lines') loop
    insert into public.order_items (order_id, item_id, name, qty, unit_price_cents, options, line_total_cents)
    values (v_order.id, (l->>'item_id')::uuid, l->>'name', (l->>'qty')::integer,
            (l->>'unit_price_cents')::integer, l->'options', (l->>'line_total_cents')::integer);
  end loop;

  -- stock bookkeeping for limited items
  update public.menu_items i
     set stock_remaining = greatest(i.stock_remaining - s.qty, 0)
    from (select (l->>'item_id')::uuid as item_id, sum((l->>'qty')::integer) as qty
            from jsonb_array_elements(v_q->'lines') l group by 1) s
   where i.id = s.item_id and i.stock_remaining is not null;

  insert into public.order_events (order_id, type, actor_type, actor_id, payload)
  values (v_order.id, 'created', 'customer', v_cust.id,
          jsonb_build_object('channel', v_channel, 'type', v_order.type, 'total_cents', v_order.total_cents,
                             'payment_method', v_pm, 'payment_status', v_ps,
                             'scheduled_for', v_order.scheduled_for, 'promo_code', v_order.promo_code));
  if v_ps = 'authorized' then
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (v_order.id, 'payment_authorized', 'system', null,
            jsonb_build_object('payment_method', v_pm, 'payment_ref', v_order.payment_ref));
  end if;

  -- auto-accept: paid/authorized ASAP orders under the threshold, kitchen not paused
  if v_ps in ('authorized', 'paid')
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

---------------------------------------------------------------- set_order_status

create or replace function public.set_order_status(
  order_id uuid, new_status public.order_status, payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    public.staff_role := public.auth_role();
  v_uid     uuid := auth.uid();
  o         public.orders;
  v_ops     jsonb;
  v_kitchen jsonb;
  v_driver  uuid;
  v_promised integer;
  v_zone    public.delivery_zones;
begin
  if v_role is null then
    raise exception 'not_staff' using errcode = '42501';
  end if;

  select * into o from public.orders where id = order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if not public.order_transition_allowed(o.status, new_status, o.type, o.payment_status) then
    raise exception 'illegal_transition' using errcode = 'P0001',
      detail = format('%s → %s', o.status, new_status);
  end if;

  -- role gates (§4)
  if v_role = 'kitchen' and new_status not in ('preparing', 'ready') then
    raise exception 'forbidden_for_role' using errcode = '42501', detail = format('kitchen → %s', new_status);
  end if;
  if v_role = 'driver' and (new_status <> 'delivered' or o.driver_id is distinct from v_uid) then
    raise exception 'forbidden_for_role' using errcode = '42501', detail = format('driver → %s', new_status);
  end if;

  perform set_config('shosho.actor_type', 'staff', true);
  perform set_config('shosho.actor_id', v_uid::text, true);

  case new_status
    when 'accepted' then
      update public.orders set status = 'accepted', accepted_by = v_uid where id = o.id returning * into o;

    when 'preparing' then
      select value into v_ops     from public.settings where key = 'ops';
      select value into v_kitchen from public.settings where key = 'kitchen';
      v_ops := coalesce(v_ops, '{}'::jsonb); v_kitchen := coalesce(v_kitchen, '{}'::jsonb);
      if o.type = 'delivery' and o.zone_id is not null then
        select * into v_zone from public.delivery_zones where id = o.zone_id;
        v_promised := coalesce(v_zone.promised_minutes, o.promised_minutes);
      else
        v_promised := coalesce((v_ops->>'prep_default_min')::integer, 22);
      end if;
      if coalesce((v_kitchen->>'rush')::boolean, false) then
        v_promised := v_promised + coalesce((v_ops->>'rush_extra_min')::integer, 15);
      end if;
      v_promised := coalesce((payload->>'promised_minutes')::integer, v_promised);
      update public.orders set status = 'preparing', promised_minutes = v_promised where id = o.id returning * into o;

    when 'ready' then
      update public.orders set status = 'ready' where id = o.id returning * into o;

    when 'out_for_delivery' then
      v_driver := coalesce((payload->>'driver_id')::uuid, o.driver_id);
      if v_driver is null or not exists (select 1 from public.staff s where s.id = v_driver and s.active and s.role = 'driver') then
        raise exception 'driver_required' using errcode = 'P0001', hint = 'payload.driver_id must be an active driver';
      end if;
      update public.orders set status = 'out_for_delivery', driver_id = v_driver where id = o.id returning * into o;

    when 'delivered', 'picked_up' then
      -- v1 payment stub: capture-on-completion (real provider capture = S2-02)
      update public.orders
         set status = new_status,
             payment_status = case when payment_status in ('pending', 'authorized') then 'paid' else payment_status end
       where id = o.id returning * into o;

    when 'cancelled' then
      update public.orders
         set status = 'cancelled',
             cancel_reason = nullif(trim(coalesce(payload->>'cancel_reason', '')), ''),
             payment_status = case when payment_status = 'authorized' then 'pending' else payment_status end
       where id = o.id returning * into o;

    when 'refunded' then
      update public.orders set status = 'refunded', payment_status = 'refunded' where id = o.id returning * into o;

    else
      raise exception 'illegal_transition' using errcode = 'P0001';
  end case;

  if nullif(trim(coalesce(payload->>'note', '')), '') is not null then
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (o.id, 'note', 'staff', v_uid, jsonb_build_object('text', trim(payload->>'note')));
  end if;

  return to_jsonb(o);
end;
$$;

---------------------------------------------------------------- get_order_by_token

create or replace function public.get_order_by_token(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where tracking_token = token;
  if not found then return null; end if;

  return jsonb_build_object(
    'order_id', o.id,
    'number', o.number,
    'status', o.status,
    'type', o.type,
    'payment_status', o.payment_status,
    'payment_method', o.payment_method,
    'scheduled_for', o.scheduled_for,
    'promised_minutes', o.promised_minutes,
    'eta', case
      when o.status in ('delivered', 'picked_up', 'cancelled', 'refunded') then null
      when o.scheduled_for is not null then o.scheduled_for
      else coalesce(o.preparing_at, o.accepted_at, o.created_at) + make_interval(mins => coalesce(o.promised_minutes, 0))
    end,
    'created_at', o.created_at,
    'accepted_at', o.accepted_at,
    'preparing_at', o.preparing_at,
    'ready_at', o.ready_at,
    'out_at', o.out_at,
    'completed_at', o.completed_at,
    'cancelled_at', o.cancelled_at,
    'contact_name', o.contact_name,
    'address', o.address,
    'courier_comment', o.courier_comment,
    'comment_flags', to_jsonb(o.comment_flags),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'unit_price_cents', i.unit_price_cents,
        'options', i.options, 'line_total_cents', i.line_total_cents) order by i.created_at)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'subtotal_cents', o.subtotal_cents,
    'discount_cents', o.discount_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'tip_cents', o.tip_cents,
    'total_cents', o.total_cents,
    'vat_cents', o.vat_cents,
    'promo_code', o.promo_code,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'type', e.type) order by e.at)
      from public.order_events e where e.order_id = o.id and e.type <> 'note'), '[]'::jsonb)
  );
end;
$$;

---------------------------------------------------------------- kitchen_pause

create or replace function public.kitchen_pause(paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.staff_role := public.auth_role();
  v_status jsonb;
begin
  if v_role not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  insert into public.settings (key, value)
  values ('kitchen', jsonb_build_object('paused', paused, 'paused_by', auth.uid(), 'paused_at', now(), 'rush', false))
  on conflict (key) do update
    set value = settings.value || jsonb_build_object(
      'paused', paused,
      'paused_by', case when paused then auth.uid() else null end,
      'paused_at', case when paused then now() else null end);

  v_status := jsonb_build_object('paused', paused, 'since', now());
  insert into public.settings (key, value) values ('kitchen.status', v_status)
  on conflict (key) do update set value = excluded.value;

  return v_status;
end;
$$;

---------------------------------------------------------------- grants
-- PostgREST exposes every function in public; be explicit about who may call what.
revoke execute on function public.normalize_phone(text) from public;
revoke execute on function public.shop_open_at(timestamptz) from public;
revoke execute on function public.order_transition_allowed(public.order_status, public.order_status, public.order_type, public.payment_status) from public;
revoke execute on function public.quote_order(jsonb) from public;
revoke execute on function public.place_order(jsonb) from public;
revoke execute on function public.set_order_status(uuid, public.order_status, jsonb) from public;
revoke execute on function public.get_order_by_token(text) from public;
revoke execute on function public.kitchen_pause(boolean) from public;
revoke execute on function public.current_actor() from public;
revoke execute on function public.settings_public_keys() from public;

grant execute on function public.shop_open_at(timestamptz)   to anon, authenticated, service_role;
grant execute on function public.quote_order(jsonb)           to anon, authenticated, service_role;
grant execute on function public.place_order(jsonb)           to anon, authenticated, service_role;
grant execute on function public.get_order_by_token(text)     to anon, authenticated, service_role;
grant execute on function public.set_order_status(uuid, public.order_status, jsonb) to authenticated, service_role;
grant execute on function public.kitchen_pause(boolean)       to authenticated, service_role;
grant execute on function public.normalize_phone(text)        to anon, authenticated, service_role;
grant execute on function public.order_transition_allowed(public.order_status, public.order_status, public.order_type, public.payment_status) to authenticated, service_role;
grant execute on function public.settings_public_keys()       to anon, authenticated, service_role;
grant execute on function public.current_actor()              to service_role;
