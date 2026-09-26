-- [S2-02] 11 — payments (D-011): Stripe columns on orders, payment_events (idempotent webhook log),
--                payment_jobs (capture / void / refund / update_amount queue drained by the
--                `payment-worker` Edge Function). No provider secret ever lives in Postgres.

---------------------------------------------------------------- orders
alter table public.orders
  add column payment_provider       text check (payment_provider in ('stripe')),
  add column payment_intent_id      text unique,
  add column payment_captured_at    timestamptz,
  add column payment_authorized_cents integer check (payment_authorized_cents is null or payment_authorized_cents >= 0),
  add column payment_refunded_cents integer not null default 0 check (payment_refunded_cents >= 0);
comment on column public.orders.payment_provider is 'stripe | null (cash / v1 client-reported). Set by create-payment-intent.';
comment on column public.orders.payment_intent_id is 'Stripe PaymentIntent id (pi_…). Unique: one intent per order.';
comment on column public.orders.payment_captured_at is 'When the provider confirmed the capture (payment_intent.succeeded).';
comment on column public.orders.payment_authorized_cents is 'amount_capturable reported by the provider; the ceiling for operator edits (update_order_items) and the capture amount.';

---------------------------------------------------------------- payment_events
create table public.payment_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders (id) on delete set null,
  provider    text not null default 'stripe',
  event_id    text not null unique,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
comment on table public.payment_events is 'Every provider webhook event, once (event_id unique) — the idempotency log for stripe-webhook.';
create index payment_events_order_idx on public.payment_events (order_id, received_at);

---------------------------------------------------------------- payment_jobs
create type public.payment_job_action as enum ('capture', 'void', 'refund', 'update_amount');
create type public.payment_job_status as enum ('queued', 'processing', 'done', 'failed');

create table public.payment_jobs (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  action       public.payment_job_action not null,
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  status       public.payment_job_status not null default 'queued',
  attempts     integer not null default 0,
  last_error   text,
  result       jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
comment on table public.payment_jobs is 'Provider side effects requested by SQL (set_order_status, update_order_items); executed by the payment-worker Edge Function.';
comment on column public.payment_jobs.amount_cents is 'refund: amount (null = full); update_amount: the new total; capture/void: ignored.';
create index payment_jobs_queue_idx on public.payment_jobs (status, created_at) where status in ('queued', 'processing');
create index payment_jobs_order_idx on public.payment_jobs (order_id, created_at);
create trigger payment_jobs_set_updated_at before update on public.payment_jobs
  for each row execute function public.set_updated_at();

---------------------------------------------------------------- RLS
alter table public.payment_events enable row level security;
alter table public.payment_jobs   enable row level security;

-- Staff read both (Detail view shows the payment trail); writes happen only through
-- security-definer functions and the service role (Edge Functions).
create policy payment_events_staff_read on public.payment_events
  for select to authenticated using (public.is_staff('owner', 'operator'));
create policy payment_jobs_staff_read on public.payment_jobs
  for select to authenticated using (public.is_staff('owner', 'operator'));

---------------------------------------------------------------- queue helpers (service role only)

-- Enqueue a provider action for an order. Called from set_order_status / update_order_items.
-- Coalesces with an identical queued job so a double click never captures twice.
create or replace function public.enqueue_payment_job(
  p_order_id uuid, p_action public.payment_job_action, p_amount_cents integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from public.payment_jobs
   where order_id = p_order_id and action = p_action and status = 'queued'
     and amount_cents is not distinct from p_amount_cents
   limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.payment_jobs (order_id, action, amount_cents)
  values (p_order_id, p_action, p_amount_cents)
  returning id into v_id;
  return v_id;
end;
$$;

-- Worker: atomically claim up to p_limit queued jobs (skip locked → safe with concurrent workers).
-- Jobs stuck in `processing` for more than 10 minutes (worker died) are re-claimed.
create or replace function public.claim_payment_jobs(p_limit integer default 10)
returns setof public.payment_jobs
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id from public.payment_jobs
     where status = 'queued'
        or (status = 'processing' and started_at < now() - interval '10 minutes')
     order by created_at
     limit greatest(coalesce(p_limit, 10), 1)
     for update skip locked
  )
  update public.payment_jobs j
     set status = 'processing', attempts = j.attempts + 1, started_at = now()
    from picked
   where j.id = picked.id
  returning j.*;
$$;

-- Worker: report the outcome. Failure with attempts < 5 → back to `queued` (retried next run),
-- otherwise — or when p_final (the provider said no for good) — `failed` (needs a human; visible
-- in the back-office).
create or replace function public.finish_payment_job(
  p_job_id uuid, p_ok boolean, p_error text default null, p_result jsonb default null, p_final boolean default false
)
returns public.payment_jobs
language plpgsql
security definer
set search_path = public
as $$
declare j public.payment_jobs;
begin
  update public.payment_jobs
     set status = case
                    when p_ok then 'done'::public.payment_job_status
                    when p_final or attempts >= 5 then 'failed'::public.payment_job_status
                    else 'queued'::public.payment_job_status
                  end,
         last_error  = case when p_ok then null else left(p_error, 2000) end,
         result      = coalesce(p_result, result),
         finished_at = case when p_ok or p_final or attempts >= 5 then now() else null end
   where id = p_job_id
  returning * into j;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  return j;
end;
$$;

---------------------------------------------------------------- webhook state machine (service role only)

-- Records one provider event exactly once and applies it to the order.
-- p_payment_ref ("Visa ···4242") / p_payment_method are resolved by the Edge Function from the
-- PaymentMethod object (the PaymentIntent event payload does not carry them).
-- Returns {duplicate, order_id, applied, payment_status, status}.
--   payment_intent.amount_capturable_updated → authorized (+ order_events payment_authorized, auto-accept)
--   payment_intent.payment_failed            → failed
--   payment_intent.succeeded                 → paid + payment_captured_at
--   payment_intent.canceled                  → pending (authorization released)
--   charge.refunded                          → refunded / payment_refunded_cents
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
        insert into public.order_events (order_id, type, actor_type, actor_id, payload)
        values (o.id, 'payment_authorized', 'system', null,
                jsonb_build_object('provider', 'stripe', 'payment_intent_id', v_intent,
                                   'amount_capturable', v_obj->>'amount_capturable', 'event_id', p_event_id));
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

---------------------------------------------------------------- grants
revoke execute on function public.enqueue_payment_job(uuid, public.payment_job_action, integer) from public;
revoke execute on function public.claim_payment_jobs(integer) from public;
revoke execute on function public.finish_payment_job(uuid, boolean, text, jsonb, boolean) from public;
revoke execute on function public.record_payment_event(text, text, text, jsonb, text, uuid, text, public.payment_method) from public;
grant execute on function public.enqueue_payment_job(uuid, public.payment_job_action, integer) to service_role;
grant execute on function public.claim_payment_jobs(integer) to service_role;
grant execute on function public.finish_payment_job(uuid, boolean, text, jsonb, boolean) to service_role;
grant execute on function public.record_payment_event(text, text, text, jsonb, text, uuid, text, public.payment_method) to service_role;
