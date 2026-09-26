-- [S2-02] 15 — set_order_status v2: real payment flow (D-011) replaces the v1 stub.
-- Same signature and return shape as S2-01 (§2 / §6.1) — only behaviour changes:
--   delivered / picked_up:
--     stripe            → payment_jobs(capture, amount = total_cents); status stays `authorized`
--                         until the webhook payment_intent.succeeded flips it to `paid`
--     cash              → payload.cash_received = true → `paid`; false / absent → stays `pending`
--                         + a `note` event ("cash not received") so the operator sees it
--     other (v1 client) → `paid` as before (no provider to ask)
--   cancelled: stripe & authorized → payment_jobs(void) — the webhook payment_intent.canceled
--              releases it to `pending`; non-stripe authorized → `pending` immediately (v1)
--   refunded:  stripe & paid → payment_jobs(refund, payload.amount_cents | null = full); the webhook
--              charge.refunded settles payment_status / payment_refunded_cents. Non-stripe → `refunded`.
--   payload.note → order_events(note) (as before) + customer_events(note) on the order's customer.

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
      if o.payment_provider = 'stripe' then
        -- capture on completion; the amount is the current total (≤ authorized — update_order_items enforces it)
        if o.payment_status = 'authorized' then
          perform public.enqueue_payment_job(o.id, 'capture', o.total_cents);
        end if;
        update public.orders set status = new_status where id = o.id returning * into o;
      elsif o.payment_method = 'cash' then
        v_cash := coalesce((payload->>'cash_received')::boolean, false);
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
           set status = 'cancelled',
               cancel_reason = nullif(trim(coalesce(payload->>'cancel_reason', '')), '')
         where id = o.id returning * into o;
      else
        update public.orders
           set status = 'cancelled',
               cancel_reason = nullif(trim(coalesce(payload->>'cancel_reason', '')), ''),
               payment_status = case when payment_status = 'authorized' then 'pending'::public.payment_status else payment_status end
         where id = o.id returning * into o;
      end if;

    when 'refunded' then
      v_refund := nullif((payload->>'amount_cents')::integer, 0);
      if v_refund is not null and (v_refund < 0 or v_refund > o.total_cents - o.payment_refunded_cents) then
        raise exception 'invalid_input' using errcode = 'P0001',
          detail = format('amount_cents must be between 1 and %s', o.total_cents - o.payment_refunded_cents);
      end if;
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
