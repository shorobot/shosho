-- [S2-04] 25 — the payment trust boundary (S7-01 finding 1, CRITICAL)
--
-- THE BUG. `place_order` took `payment_status` from its caller. `anon` is the caller on the guest
-- site, so anyone could post
--     rpc('place_order', { …, payment_method: 'card', payment_status: 'authorized' })
-- and get an order that (a) wrote a `payment_authorized` event nobody had authorized, (b) jumped
-- the auto-accept rule straight into the kitchen queue when it was under
-- `ops.auto_accept_paid_under_cents`, and (c) was marked `paid` the moment staff marked it
-- delivered — with `create-payment-intent` never called and Stripe never involved. A free meal for
-- every non-cash payment method. Live on staging, and locked in by a passing test
-- (`place_order.test.ts` "auto-accepts authorized orders under 50 €"), which is why it survived
-- two reviews: the test asserted the exploit was working.
--
-- THE FIX is the trust boundary, not the symptom. Three separate things were each sufficient to
-- cause it, so all three change here:
--
--   1. `place_order` — a guest order is created `pending`, full stop. `authorized` means "a provider
--      is holding money we can capture" and is reachable from exactly one place: `record_payment_event`,
--      fed by a signature-verified Stripe webhook. A guest that sends anything else is **refused**
--      (`invalid_input` on `payment_status`) rather than silently coerced, so the attempt surfaces
--      as a rejected order instead of looking like it worked. Client-supplied `payment_ref` is
--      dropped for guests too — it is an unverified display string; the webhook writes the real one.
--
--   2. Staff (`owner`/`operator`, i.e. a phone order) keep one narrow power: recording money already
--      in hand — counter cash, a card terminal — as `paid`. Not `authorized`: that is the provider's
--      word, not a person's. Every such order writes an `order_events` `note` with
--      `code = 'payment_recorded_by_staff'` and `actor_id = auth.uid()`, so "this order started out
--      paid" always has a name against it (§1.4 allows `note {text, code?}`; no new event type).
--
--   3. `set_order_status` — **completion is not evidence of payment.** The old "v1 client-reported"
--      branch marked any non-cash order without a provider `paid` on delivered/picked_up. Even with
--      (1) fixed that is wrong: today no Stripe account exists, so every card order on staging has
--      `payment_provider is null` and would have completed as `paid` having never been charged.
--      Now the order completes, `payment_status` is left alone, and an `order_events` note with
--      `code = 'payment_not_confirmed'` tells the operator the money is outstanding — the same shape
--      as the cash `cash_not_received` flag the back-office already renders.
--
-- Auto-accept now keys only off a state someone vouched for: a staff-recorded `paid` here, or the
-- real authorization in `record_payment_event` (migration 11). A guest can no longer reach it.
--
-- WHAT CHANGES FOR CLIENTS (api-contracts §5.3, §5.6, §6.8 updated in this PR):
--   · S3 (web): sending `payment_status: 'authorized'` is now an error. §5.6 already told the client
--     to leave it at `pending`, so the shipped checkout is unaffected — this makes the contract
--     enforced rather than advisory.
--   · S4 (back-office): a delivered non-cash order without Stripe stays `pending` and carries a
--     `payment_not_confirmed` note. That is the honest state and needs surfacing like the cash flag.
--   · Signatures and return shapes are unchanged for both RPCs.

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
    subtotal_cents, discount_cents, delivery_fee_cents, tip_cents, total_cents, vat_cents, promo_code
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
revoke execute on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated, service_role;

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
  v_cash    boolean;
  v_refund  integer;
  v_reason  text;
  v_extra   jsonb := '{}'::jsonb;
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

  -- §6.9 row 4: `reason` is canonical, `cancel_reason` is the legacy key the back-office still sends
  v_reason := nullif(trim(coalesce(nullif(payload->>'reason', ''), payload->>'cancel_reason', '')), '');

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
      -- §1.4 preparing {promised_minutes, station?}
      v_extra := jsonb_strip_nulls(jsonb_build_object('station', nullif(trim(coalesce(payload->>'station', '')), '')));
      perform set_config('shosho.status_payload', v_extra::text, true);
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
      if o.payment_provider = 'stripe' then
        -- capture on completion; the amount is the current total (≤ authorized — update_order_items enforces it)
        if o.payment_status = 'authorized' then
          perform public.enqueue_payment_job(o.id, 'capture', o.total_cents);
        end if;
        update public.orders set status = new_status where id = o.id returning * into o;
      elsif o.payment_method = 'cash' then
        v_cash := coalesce((payload->>'cash_received')::boolean, false);
        -- §1.4 delivered / picked_up {cash_received?}
        perform set_config('shosho.status_payload', jsonb_build_object('cash_received', v_cash)::text, true);
        update public.orders
           set status = new_status,
               payment_status = case when v_cash and payment_status in ('pending', 'authorized', 'failed')
                                     then 'paid'::public.payment_status else payment_status end,
               payment_captured_at = case when v_cash then coalesce(payment_captured_at, now()) else payment_captured_at end
         where id = o.id returning * into o;
        if not v_cash and o.payment_status <> 'paid' then
          insert into public.order_events (order_id, type, actor_type, actor_id, payload)
          values (o.id, 'note', 'staff', v_uid,
                  jsonb_build_object('text', 'Cash not received', 'code', 'cash_not_received'));
        end if;
      else
        -- Non-cash, no payment provider on the order. Until S2-04 this branch flipped the order to
        -- `paid` on completion purely because nobody had said otherwise — the second half of the
        -- S7-01 finding 1 "free order" path: with `place_order` no longer able to claim
        -- `authorized`, an order that never reached Stripe would still have been marked paid the
        -- moment staff marked it delivered. **Completion is not evidence of payment.** The order
        -- completes, `payment_status` is left exactly as it is, and a note tells the operator the
        -- money is still outstanding — the same shape as the cash `cash_not_received` flag.
        update public.orders set status = new_status where id = o.id returning * into o;
        if o.payment_status not in ('paid', 'refunded') then
          insert into public.order_events (order_id, type, actor_type, actor_id, payload)
          values (o.id, 'note', 'staff', v_uid,
                  jsonb_build_object('text', 'Completed without a confirmed payment',
                                     'code', 'payment_not_confirmed',
                                     'payment_method', o.payment_method,
                                     'payment_status', o.payment_status,
                                     'amount_cents', o.total_cents));
        end if;
      end if;

    when 'cancelled' then
      if o.payment_provider = 'stripe' and o.payment_status in ('authorized', 'pending') and o.payment_intent_id is not null then
        perform public.enqueue_payment_job(o.id, 'void');
        update public.orders
           set status = 'cancelled', cancel_reason = v_reason
         where id = o.id returning * into o;
      else
        update public.orders
           set status = 'cancelled',
               cancel_reason = v_reason,
               payment_status = case when payment_status = 'authorized' then 'pending'::public.payment_status else payment_status end
         where id = o.id returning * into o;
      end if;

    when 'refunded' then
      v_refund := nullif((payload->>'amount_cents')::integer, 0);
      if v_refund is not null and (v_refund < 0 or v_refund > o.total_cents - o.payment_refunded_cents) then
        raise exception 'invalid_input' using errcode = 'P0001',
          detail = format('amount_cents must be between 1 and %s', o.total_cents - o.payment_refunded_cents);
      end if;
      -- §1.4 refunded {amount_cents}: absent = the whole remaining total
      perform set_config('shosho.status_payload',
        jsonb_build_object('amount_cents', coalesce(v_refund, o.total_cents - o.payment_refunded_cents))::text, true);
      if o.payment_provider = 'stripe' and o.payment_intent_id is not null then
        perform public.enqueue_payment_job(o.id, 'refund', v_refund);
        -- payment_status flips to `refunded` when charge.refunded arrives (full refund)
        update public.orders set status = 'refunded' where id = o.id returning * into o;
      else
        update public.orders
           set status = 'refunded',
               payment_status = case when v_refund is null or v_refund >= total_cents - payment_refunded_cents
                                     then 'refunded'::public.payment_status else payment_status end,
               payment_refunded_cents = case when v_refund is null then total_cents
                                             else least(total_cents, payment_refunded_cents + v_refund) end
         where id = o.id returning * into o;
      end if;

    else
      raise exception 'illegal_transition' using errcode = 'P0001';
  end case;

  if nullif(trim(coalesce(payload->>'note', '')), '') is not null then
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (o.id, 'note', 'staff', v_uid, jsonb_build_object('text', trim(payload->>'note')));
    if o.customer_id is not null then
      insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
      values (o.customer_id, 'note', 'staff', v_uid,
              jsonb_build_object('text', trim(payload->>'note'), 'order_id', o.id, 'number', o.number, 'status', o.status));
    end if;
  end if;

  return to_jsonb(o);
end;
$$;
revoke execute on function public.set_order_status(uuid, public.order_status, jsonb) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, jsonb) to authenticated, service_role;
