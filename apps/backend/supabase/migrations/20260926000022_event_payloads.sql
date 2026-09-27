-- [S2-03] 22 — order_events payloads per type + `reason` as the canonical cancel key
--            (api-contracts §1.4, §6.1, §6.9 rows 3 and 4)
--
-- S4-01 had to guess what `order_events.payload` contains. §1.4 now fixes it per type:
--   created            {channel}                              place_order (already did)
--   payment_authorized {payment_ref, provider, amount_cents}   place_order / record_payment_event
--   accepted           {promised_minutes}                      status trigger
--   preparing          {promised_minutes, station?}            status trigger (+ RPC extras)
--   item_changed       {before, after, totals}                 update_order_items (already did)
--   ready              {}                                      status trigger
--   handed_to_driver   {driver_id, driver_name}                status trigger
--   delivered/picked_up {cash_received?}                       status trigger (+ RPC extras)
--   cancelled          {reason}                                status trigger
--   refunded           {amount_cents}                          status trigger (+ RPC extras)
--   note               {text, code?}                           set_order_status / system writers
--
-- How the RPC-only keys reach the trigger: `set_order_status` writes them to the transaction-local
-- GUC `shosho.status_payload` (same mechanism as `shosho.actor_*` in migration 07) and the trigger
-- merges and then clears it, so a second status change in the same transaction cannot inherit them.
--
-- NOT backfilled: rows written before this migration keep their old payloads. §1.4 says consumers
-- must tolerate missing keys, and the back-office already does (it falls back to the order row).
-- `from` / `to` stay on every status event — extra keys, useful, and already consumed.
-- `cancelled` carries both `reason` (canonical) and `cancel_reason` (legacy) for one release.

---------------------------------------------------------------- status trigger
create or replace function public.orders_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a           record;
  ev          text;
  v_base      jsonb;
  v_extra     jsonb := '{}'::jsonb;
  v_raw       text;
  v_driver    text;
begin
  if new.status is distinct from old.status then
    select * into a from public.current_actor();

    -- extras handed over by set_order_status (cash_received, station, amount_cents, …), one-shot
    v_raw := nullif(current_setting('shosho.status_payload', true), '');
    if v_raw is not null then
      begin
        v_extra := v_raw::jsonb;
      exception when others then
        v_extra := '{}'::jsonb;
      end;
      perform set_config('shosho.status_payload', '', true);
    end if;

    ev := case new.status
      when 'out_for_delivery' then 'handed_to_driver'
      else new.status::text
    end;

    v_base := jsonb_build_object('from', old.status, 'to', new.status);

    case new.status
      when 'accepted', 'preparing' then
        v_base := v_base || jsonb_build_object('promised_minutes', new.promised_minutes);

      when 'out_for_delivery' then
        select s.name into v_driver from public.staff s where s.id = new.driver_id;
        v_base := v_base || jsonb_build_object('driver_id', new.driver_id, 'driver_name', v_driver);

      when 'cancelled' then
        -- `reason` is canonical (§6.1); `cancel_reason` stays for one release
        v_base := v_base || jsonb_build_object('reason', new.cancel_reason,
                                               'cancel_reason', new.cancel_reason);

      when 'refunded' then
        -- the RPC passes the partial amount; absent = the whole remaining total
        v_base := v_base || jsonb_build_object(
          'amount_cents', coalesce((v_extra->>'amount_cents')::integer,
                                   new.total_cents - new.payment_refunded_cents,
                                   new.total_cents));

      else null;  -- ready {} · delivered / picked_up {cash_received?} come from v_extra
    end case;

    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (new.id, ev, a.actor_type, a.actor_id, jsonb_strip_nulls(v_base || v_extra));
  end if;
  return new;
end;
$$;

---------------------------------------------------------------- set_order_status v3
-- Identical to migration 15 except: `payload.reason` (canonical) / `payload.cancel_reason` (legacy)
-- are both accepted and land in `orders.cancel_reason` + the event's `reason`; the documented
-- RPC-only event keys are handed to the trigger through `shosho.status_payload`.
-- Signature and return shape unchanged (§2, §6.1).
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
        -- v1 client-reported payment (no provider to ask): completion = paid
        update public.orders
           set status = new_status,
               payment_status = case when payment_status in ('pending', 'authorized') then 'paid'::public.payment_status else payment_status end,
               payment_captured_at = case when payment_status in ('pending', 'authorized') then coalesce(payment_captured_at, now()) else payment_captured_at end
         where id = o.id returning * into o;
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

---------------------------------------------------------------- record_payment_event: payload only
-- Unchanged from migration 11 except the `payment_authorized` event payload, which now matches
-- §1.4: {payment_ref, provider, amount_cents} (the ref and the method are resolved by the Edge
-- Function and are already on the order row at this point; `amount_cents` is the authorized
-- ceiling, i.e. Stripe's amount_capturable). `payment_intent_id`, `payment_method` and `event_id`
-- stay as extra keys. Same signature, same return shape.
create or replace function public.record_payment_event(
  p_provider text, p_event_id text, p_type text, p_payload jsonb,
  p_payment_intent_id text default null, p_order_id uuid default null,
  p_payment_ref text default null, p_payment_method public.payment_method default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o         public.orders;
  v_intent  text := coalesce(p_payment_intent_id, p_payload->'data'->'object'->>'id');
  v_obj     jsonb := coalesce(p_payload->'data'->'object', '{}'::jsonb);
  v_ops     jsonb;
  v_kitchen jsonb;
  v_applied boolean := false;
  v_refunded integer;
begin
  if p_event_id is null or p_type is null then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'event_id and type are required';
  end if;

  -- locate the order: explicit id → metadata.order_id → payment_intent_id
  if p_order_id is not null then
    select * into o from public.orders where id = p_order_id for update;
  end if;
  if o.id is null and (v_obj->'metadata'->>'order_id') is not null then
    begin
      select * into o from public.orders where id = (v_obj->'metadata'->>'order_id')::uuid for update;
    exception when others then null;
    end;
  end if;
  if o.id is null and v_intent is not null then
    select * into o from public.orders
     where payment_intent_id = v_intent
        or (p_type like 'charge.%' and payment_intent_id = (v_obj->>'payment_intent'))
     for update;
  end if;

  -- idempotency: one row per provider event id
  begin
    insert into public.payment_events (order_id, provider, event_id, type, payload)
    values (o.id, coalesce(p_provider, 'stripe'), p_event_id, p_type, coalesce(p_payload, '{}'::jsonb));
  exception when unique_violation then
    return jsonb_build_object('duplicate', true, 'order_id', o.id, 'applied', false,
                              'payment_status', o.payment_status, 'status', o.status);
  end;

  if o.id is null then
    return jsonb_build_object('duplicate', false, 'order_id', null, 'applied', false);
  end if;

  perform set_config('shosho.actor_type', 'system', true);
  perform set_config('shosho.actor_id', '', true);

  case p_type
    when 'payment_intent.amount_capturable_updated' then
      if o.payment_status in ('pending', 'failed') then
        update public.orders
           set payment_status = 'authorized',
               payment_authorized_cents = coalesce((v_obj->>'amount_capturable')::integer, total_cents),
               payment_provider = coalesce(payment_provider, 'stripe'),
               payment_intent_id = coalesce(payment_intent_id, v_intent),
               payment_ref = coalesce(p_payment_ref, payment_ref),
               payment_method = coalesce(p_payment_method, payment_method)
         where id = o.id returning * into o;
        -- §1.4 payment_authorized {payment_ref, provider, amount_cents}
        insert into public.order_events (order_id, type, actor_type, actor_id, payload)
        values (o.id, 'payment_authorized', 'system', null,
                jsonb_strip_nulls(jsonb_build_object(
                  'payment_ref', o.payment_ref,
                  'provider', coalesce(o.payment_provider, p_provider, 'stripe'),
                  'amount_cents', o.payment_authorized_cents,
                  'payment_intent_id', v_intent,
                  'payment_method', o.payment_method,
                  'event_id', p_event_id)));
        v_applied := true;

        -- auto-accept (same rule as place_order): ASAP, under the threshold, kitchen not paused
        select value into v_ops     from public.settings where key = 'ops';
        select value into v_kitchen from public.settings where key = 'kitchen';
        v_ops := coalesce(v_ops, '{}'::jsonb); v_kitchen := coalesce(v_kitchen, '{}'::jsonb);
        if o.status = 'new'
           and o.scheduled_for is null
           and not coalesce((v_kitchen->>'paused')::boolean, false)
           and o.total_cents < coalesce((v_ops->>'auto_accept_paid_under_cents')::integer, 0) then
          update public.orders set status = 'accepted' where id = o.id returning * into o;
        end if;
      end if;

    when 'payment_intent.payment_failed' then
      if o.payment_status in ('pending', 'authorized') then
        update public.orders set payment_status = 'failed' where id = o.id returning * into o;
        insert into public.order_events (order_id, type, actor_type, actor_id, payload)
        values (o.id, 'note', 'system', null,
                jsonb_build_object('text', 'Payment failed',
                                   'code', v_obj->'last_payment_error'->>'code',
                                   'message', v_obj->'last_payment_error'->>'message', 'event_id', p_event_id));
        v_applied := true;
      end if;

    when 'payment_intent.succeeded' then
      if o.payment_status <> 'refunded' then
        update public.orders
           set payment_status = 'paid',
               payment_captured_at = coalesce(payment_captured_at, now()),
               payment_provider = coalesce(payment_provider, 'stripe'),
               payment_intent_id = coalesce(payment_intent_id, v_intent)
         where id = o.id returning * into o;
        v_applied := true;
      end if;

    when 'payment_intent.canceled' then
      if o.payment_status = 'authorized' then
        update public.orders set payment_status = 'pending' where id = o.id returning * into o;
        v_applied := true;
      end if;

    when 'charge.refunded' then
      v_refunded := coalesce((v_obj->>'amount_refunded')::integer, o.total_cents);
      update public.orders
         set payment_refunded_cents = greatest(payment_refunded_cents, v_refunded),
             payment_status = case when v_refunded >= total_cents then 'refunded'::public.payment_status
                                   else payment_status end
       where id = o.id returning * into o;
      v_applied := true;

    else
      null; -- unknown event types are logged only
  end case;

  return jsonb_build_object('duplicate', false, 'order_id', o.id, 'applied', v_applied,
                            'payment_status', o.payment_status, 'status', o.status);
end;
$$;
revoke execute on function public.record_payment_event(text, text, text, jsonb, text, uuid, text, public.payment_method) from public, anon, authenticated;
grant execute on function public.record_payment_event(text, text, text, jsonb, text, uuid, text, public.payment_method) to service_role;
