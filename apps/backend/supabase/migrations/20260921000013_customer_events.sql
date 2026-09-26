-- [S2-02] 13 — customer timeline (api-contracts §1.3 customer_events, §6.8 add_customer_event)
-- Types: order | complaint | compensation | note | push_opened | consent_changed | anonymised
-- Written by: trigger on orders insert (order), set_order_status payload.note (note, via the
-- order's customer), trigger on customers consent_* change (consent_changed), the staff RPC
-- add_customer_event (complaint / compensation / note), anonymise_silent_customers (anonymised).

create table public.customer_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null check (type in ('order', 'complaint', 'compensation', 'note', 'push_opened', 'consent_changed', 'anonymised')),
  payload     jsonb not null default '{}'::jsonb,
  actor_type  public.actor_type not null default 'system',
  actor_id    uuid
);
comment on table public.customer_events is 'Profile timeline (Profil → Verlauf): orders, complaints, compensations, staff notes, push opens, consent changes.';
create index customer_events_customer_idx on public.customer_events (customer_id, at desc);

alter table public.customer_events enable row level security;
create policy customer_events_staff_read on public.customer_events
  for select to authenticated using (public.is_staff('owner', 'operator'));
-- writes only via RPC / triggers / service role

alter publication supabase_realtime add table public.customer_events;

---------------------------------------------------------------- triggers

-- new order → `order` event on the customer's timeline
create or replace function public.orders_customer_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null then
    insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
    values (new.customer_id, 'order', 'customer', new.customer_id,
            jsonb_build_object('order_id', new.id, 'number', new.number, 'type', new.type,
                               'channel', new.channel, 'total_cents', new.total_cents,
                               'payment_method', new.payment_method));
  end if;
  return new;
end;
$$;
create trigger orders_customer_event
  after insert on public.orders
  for each row execute function public.orders_customer_event();

-- consent_* changed → `consent_changed` (who, which channel, granted/revoked, source)
create or replace function public.customers_consent_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  ch text;
  before_v jsonb;
  after_v jsonb;
begin
  select * into a from public.current_actor();
  foreach ch in array array['email', 'push', 'phone'] loop
    before_v := case ch when 'email' then old.consent_email when 'push' then old.consent_push else old.consent_phone end;
    after_v  := case ch when 'email' then new.consent_email when 'push' then new.consent_push else new.consent_phone end;
    if before_v is distinct from after_v then
      insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
      values (new.id, 'consent_changed', a.actor_type, a.actor_id,
              jsonb_strip_nulls(jsonb_build_object(
                'channel', ch,
                'granted', after_v is not null,
                'source', after_v->>'source',
                'granted_at', after_v->>'granted_at',
                'previous', before_v)));
    end if;
  end loop;
  return new;
end;
$$;
create trigger customers_consent_changed
  after update of consent_email, consent_push, consent_phone on public.customers
  for each row execute function public.customers_consent_changed();

---------------------------------------------------------------- RPC add_customer_event (staff)

-- complaint / compensation / note from the back-office. payload is free jsonb; conventions:
--   complaint:    {text, order_id?}      compensation: {text?, order_id?, amount_cents?, kind: voucher|refund|free_item}
--   note:         {text}
create or replace function public.add_customer_event(customer_id uuid, type text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.staff_role := public.auth_role();
  e public.customer_events;
begin
  -- v_role is null for anon / non-staff — `not in` would evaluate to NULL, so test it explicitly
  if v_role is null or v_role not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;
  if type not in ('complaint', 'compensation', 'note', 'push_opened') then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'type must be complaint | compensation | note | push_opened';
  end if;
  if not exists (select 1 from public.customers c where c.id = add_customer_event.customer_id) then
    raise exception 'customer_not_found' using errcode = 'P0002';
  end if;
  if type in ('complaint', 'note') and nullif(trim(coalesce(payload->>'text', '')), '') is null then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'payload.text is required';
  end if;

  insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
  values (add_customer_event.customer_id, add_customer_event.type, 'staff', auth.uid(), coalesce(payload, '{}'::jsonb))
  returning * into e;
  return to_jsonb(e);
end;
$$;

revoke execute on function public.add_customer_event(uuid, text, jsonb) from public;
grant execute on function public.add_customer_event(uuid, text, jsonb) to authenticated, service_role;
