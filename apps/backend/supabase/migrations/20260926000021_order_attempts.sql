-- [S2-03] 21 — order_attempts: the rejected/abandoned checkout feed (api-contracts §1.5, §6.9 row 5)
--
-- Why it exists (S4-01 request 5 + the Berichte funnel): `quote_order` reports a problem to the
-- **guest** and a rejected checkout creates no order, so the back-office had no signal for the two
-- BO · Zustände states "sold out during checkout" and "address outside the delivery area", and the
-- funnel tiles (MENÜ → WARENKORB → BEZAHLT) had nothing to count. One table serves both.
--
-- PRIVACY — this table is deliberately PII-free. No name, phone, email, street, floor/apt, city,
-- courier comment or comment flags; `items` carries item ids and quantities only (enforced by
-- `order_attempt_items_ok`), `postal_code` is the coarsest location the guest typed and is what the
-- out-of-zone state is about, and `session_hash` is an opaque client-side id (sessionStorage, not a
-- cookie) used only to de-duplicate and rate-limit. `anon` can never SELECT it.
--
-- WRITERS — one: `record_order_attempt(payload)`, callable by `anon` and by staff.
--   §6.9 row 5 asks for `place_order` to record a refusal automatically as well. That is **not
--   implementable while `place_order` rejects by raising**: PostgREST runs one transaction per
--   request, so any row `place_order` inserts before `raise exception 'order_rejected'` is rolled
--   back with it, and Postgres has no autonomous transaction available here (pg_net, pg_cron and
--   pg_notify are all transactional; dblink would need a stored DB password). Rather than ship a
--   code path that provably never persists, `place_order` keeps its contract (§5.3) and its
--   `order_rejected` error now carries `hint = 'record_order_attempt'`, so the client records the
--   attempt with one extra call using the same `problems[]` it just received. Options for S0 if
--   server-side recording must be guaranteed are in /memory/log.md.

---------------------------------------------------------------- shape guard (no PII in `items`)
-- Immutable so a CHECK constraint can use it. Rejects anything but [{item_id, qty}] objects —
-- the constraint, not a convention, is what keeps free text and contact data out of this table.
create or replace function public.order_attempt_items_ok(items jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(items) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(items) e
       where jsonb_typeof(e) <> 'object'
          or exists (select 1 from jsonb_object_keys(e) k where k not in ('item_id', 'qty'))
     )
$$;
revoke execute on function public.order_attempt_items_ok(jsonb) from public;
grant execute on function public.order_attempt_items_ok(jsonb) to anon, authenticated, service_role;

---------------------------------------------------------------- table
create table public.order_attempts (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  source         public.order_channel not null default 'website',
  type           public.order_type not null,
  postal_code    text,
  zone_id        uuid references public.delivery_zones (id) on delete set null,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  items          jsonb not null default '[]'::jsonb
                   constraint order_attempts_items_shape check (public.order_attempt_items_ok(items)),
  problems       jsonb not null default '[]'::jsonb
                   constraint order_attempts_problems_array check (jsonb_typeof(problems) = 'array'),
  promo_code     text,
  session_hash   text
);

comment on table public.order_attempts is
  'api-contracts §1.5 — rejected / abandoned checkouts: the operator signal for the sold-out and '
  'out-of-zone states and the only source of the Berichte funnel. PII-free by construction: no '
  'name, phone, email, street, city, comment. Written only by record_order_attempt(); readable by '
  'owner/operator, never by anon.';
comment on column public.order_attempts.source is 'Channel the attempt came from; `website` in v1, `phone` for a staff-side refusal.';
comment on column public.order_attempts.items is 'Item ids + quantities only — enforced by order_attempt_items_ok().';
comment on column public.order_attempts.problems is 'The quote_order problems[] array: [{code, item_id?, reason?, field?}].';
comment on column public.order_attempts.session_hash is 'Opaque client-side id (sessionStorage, not a cookie) for de-duplication and rate limiting. Never a customer identifier.';

create index order_attempts_at_idx on public.order_attempts (at desc);
create index order_attempts_session_idx on public.order_attempts (session_hash, at desc);

-- Append-only: no updated_at, no set_updated_at trigger. An attempt is a fact at a point in time.

---------------------------------------------------------------- RLS
alter table public.order_attempts enable row level security;

-- owner / operator read. No insert / update / delete policy at all: the only writer is the
-- security-definer RPC below (and service_role, which bypasses RLS).
create policy order_attempts_staff_read on public.order_attempts
  for select to authenticated
  using (public.is_staff('owner', 'operator'));

-- Supabase's default privileges grant table access to anon/authenticated on creation — take the
-- anon grant away entirely so the anon key cannot even attempt a select (§6.9 row 5: anon inserts
-- through the RPC only, never selects).
revoke all on table public.order_attempts from anon;
grant select on table public.order_attempts to authenticated;
grant all on table public.order_attempts to service_role;

---------------------------------------------------------------- record_order_attempt (anon)
-- Input (everything optional except `type`):
--   { type, source?, postal_code?, subtotal_cents?, items?: [{item_id, qty}], problems?: [...],
--     promo_code?, session_hash }
-- `session_hash` is required for anon callers — it is what the rate limit counts.
-- Rate limit: at most `settings.ops.attempt_rate_limit_per_min` (default 20) rows per
-- session_hash per minute; over that the call raises `rate_limited` and writes nothing.
-- Returns {recorded: true} — never the row id, which the caller has no business reading.
create or replace function public.record_order_attempt(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     public.staff_role := public.auth_role();
  v_session  text := nullif(trim(coalesce(payload->>'session_hash', '')), '');
  v_type     public.order_type;
  v_source   public.order_channel;
  v_postal   text := nullif(trim(coalesce(payload->>'postal_code', '')), '');
  v_items    jsonb := '[]'::jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_zone     uuid;
  v_limit    integer;
  v_recent   integer;
  e          jsonb;
begin
  -- `type` is the one required field: an attempt with no type tells the operator nothing
  begin
    v_type := (payload->>'type')::public.order_type;
  exception when others then
    v_type := null;
  end;
  if v_type is null then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'type must be delivery or pickup';
  end if;

  -- staff may state the channel (a phone order refused at the counter); guests are always `website`
  if v_role is not null and v_role in ('owner', 'operator') then
    begin
      v_source := coalesce(nullif(payload->>'source', ''), 'website')::public.order_channel;
    exception when others then
      v_source := 'website';
    end;
  else
    v_source := 'website';
    if v_session is null then
      raise exception 'invalid_input' using errcode = 'P0001',
        detail = 'session_hash is required', hint = 'an opaque sessionStorage id, not a cookie';
    end if;
  end if;

  -- rate limit, counted per session and cheap (index order_attempts_session_idx)
  if v_session is not null then
    select coalesce((value->>'attempt_rate_limit_per_min')::integer, 20) into v_limit
      from public.settings where key = 'ops';
    v_limit := coalesce(v_limit, 20);
    select count(*) into v_recent
      from public.order_attempts
     where session_hash = v_session and at > now() - interval '1 minute';
    if v_recent >= v_limit then
      raise exception 'rate_limited' using errcode = 'P0001',
        detail = format('%s attempts per minute per session', v_limit);
    end if;
  end if;

  -- items: item ids + quantities only, whatever else the client sent is dropped here
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', e->>'item_id',
           'qty', greatest(coalesce((e->>'qty')::integer, 1), 1))), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(case when jsonb_typeof(payload->'items') = 'array'
                                   then payload->'items' else '[]'::jsonb end) e
   where nullif(e->>'item_id', '') is not null;
  v_items := coalesce(v_items, '[]'::jsonb);

  -- problems: keep only the keys §5.2 defines, so no free text can ride along
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'code', e->>'code',
           'item_id', e->>'item_id',
           'reason', e->>'reason',
           'field', e->>'field',
           'promo_code', e->>'promo_code'))), '[]'::jsonb)
    into v_problems
    from jsonb_array_elements(case when jsonb_typeof(payload->'problems') = 'array'
                                   then payload->'problems' else '[]'::jsonb end) e
   where nullif(e->>'code', '') is not null;
  v_problems := coalesce(v_problems, '[]'::jsonb);

  if v_postal is not null then
    select id into v_zone from public.delivery_zones
     where active and v_postal = any (postal_codes) limit 1;
  end if;

  insert into public.order_attempts (
    source, type, postal_code, zone_id, subtotal_cents, items, problems, promo_code, session_hash
  ) values (
    v_source, v_type, v_postal, v_zone,
    greatest(coalesce((payload->>'subtotal_cents')::integer, 0), 0),
    v_items, v_problems,
    upper(nullif(trim(coalesce(payload->>'promo_code', '')), '')),
    v_session
  );

  return jsonb_build_object('recorded', true);
end;
$$;
revoke execute on function public.record_order_attempt(jsonb) from public;
grant execute on function public.record_order_attempt(jsonb) to anon, authenticated, service_role;

---------------------------------------------------------------- place_order: hint + event payload
-- Unchanged from migration 10 except two things:
--   · the `order_rejected` hint now names `record_order_attempt`, so a client that is refused knows
--     how to turn the problems[] it just received into the operator's signal (§1.5);
--   · the `payment_authorized` event it writes for a client-reported authorization matches §1.4
--     ({payment_ref, provider, amount_cents}). `provider` is null for the v1 client-reported path
--     and is stripped — Stripe authorizations come from record_payment_event instead.
-- Same signature, same return shape, same behaviour otherwise.
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
    from (select (ln->>'item_id')::uuid as item_id, sum((ln->>'qty')::integer) as qty
            from jsonb_array_elements(v_q->'lines') ln group by 1) s
   where i.id = s.item_id and i.stock_remaining is not null;

  insert into public.order_events (order_id, type, actor_type, actor_id, payload)
  values (v_order.id, 'created', 'customer', v_cust.id,
          jsonb_build_object('channel', v_channel, 'type', v_order.type, 'total_cents', v_order.total_cents,
                             'payment_method', v_pm, 'payment_status', v_ps,
                             'scheduled_for', v_order.scheduled_for, 'promo_code', v_order.promo_code));
  if v_ps = 'authorized' then
    insert into public.order_events (order_id, type, actor_type, actor_id, payload)
    values (v_order.id, 'payment_authorized', 'system', null,
            jsonb_strip_nulls(jsonb_build_object(
              'payment_ref', v_order.payment_ref,
              'provider', v_order.payment_provider,
              'amount_cents', v_order.total_cents,
              'payment_method', v_pm)));
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
revoke execute on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated, service_role;
