-- [S2-07] 35 — customer accounts: the identity link, the linking rule, the self-service surface
-- (api-contracts §9). ROADMAP phase A. D-016 (accounts optional, guest checkout unchanged),
-- D-017 (no channel work here), finding 5 (the recycled-number rule).
--
-- Channel-agnostic by construction: nothing below names SMS or email as a *transport*. The
-- functions read the identifiers Supabase Auth has already marked confirmed on `auth.users`
-- (`phone_confirmed_at` / `email_confirmed_at`), whichever channel produced them. No provider,
-- no SMTP, no dashboard setting is touched or required by this migration.

---------------------------------------------------------------- 1. the identity column

-- Nullable is the whole point: every customer row `place_order` has ever created is a guest row
-- with no account, and must keep working untouched. `on delete set null` orphans the link rather
-- than cascading away a customer's order history (GoBD retention) when an auth user is deleted.
--
-- `unique` creates `customers_auth_user_id_key`, a unique btree index on exactly this column —
-- which is the index every lookup below (`auth_user_id = auth.uid()`) needs. A second
-- `create index` on the same column would be dead weight that only slows writes, so there is
-- deliberately none; see S2-07's report.
alter table public.customers
  add column auth_user_id uuid unique references auth.users (id) on delete set null;

comment on column public.customers.auth_user_id is
  'Optional Supabase Auth account (D-016). NULL = guest-created profile, the default and a '
  'first-class path. Set only by link_my_account() under the finding-5 rule, or deliberately by '
  'staff. Never set from a client-supplied value.';

---------------------------------------------------------------- 2. at most one default address

-- The rule has to live in the database: the boot's requirement, and `place_order` already writes
-- `is_default` itself (migration 10), so "the UI will keep it to one" was never going to hold.
-- Repair before constraining — a project that has been taking real orders on staging since
-- September may already have rows the index would reject, and a migration that fails on live
-- data is worse than one that collapses a duplicate deterministically (oldest address wins).
update public.customer_addresses a
   set is_default = false
 where a.is_default
   and exists (
     select 1 from public.customer_addresses b
      where b.customer_id = a.customer_id
        and b.is_default
        and (b.created_at, b.id) < (a.created_at, a.id));

create unique index customer_addresses_one_default_idx
  on public.customer_addresses (customer_id)
  where is_default;

---------------------------------------------------------------- 3. resolving the caller

-- The only way any function below learns which customer is calling. No client-supplied customer
-- id exists anywhere in this migration's signatures — that is the invariant the cross-customer
-- tests assert.
--
-- `security definer` is not optional here: this reads `public.customers`, which has RLS, and it is
-- used by `customer_addresses`' own policy. Reading the table as the caller would make the address
-- policy depend on the customers policy and (once customers gains a self policy) recurse.
--
-- `anonymised_at is null`: `anonymise_silent_customers` (migration 17) scrubs name / phone / email /
-- kitchen_note and sets `anonymised_at`, but does **not** clear `auth_user_id` — it predates this
-- column. So an erased customer whose account still exists would otherwise resolve to their own
-- scrubbed row. Excluding them here is the belt; the braces (teaching migration 17 to null the
-- column) is a separate change with a cron blast radius and is reported, not done.
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.customers c
   where auth.uid() is not null
     and c.auth_user_id = auth.uid()
     and c.anonymised_at is null
$$;

comment on function public.current_customer_id() is
  'The calling customer''s id, or NULL for anon / staff / an unlinked or anonymised account. '
  'Used by customer_addresses RLS and by every *_my_* RPC. Never takes an argument: a customer id '
  'is never accepted from a client.';

-- Raises instead of returning NULL, for the RPCs whose only correct answer to "no account" is a
-- refusal the client can distinguish from an empty result (the silent-no-op lesson, S2-07 task 5).
create or replace function public.require_customer_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := public.current_customer_id();
begin
  if v_id is null then
    raise exception 'no_customer_account' using errcode = '42501',
      detail = 'This JWT has no linked customer profile. Call link_my_account() first.';
  end if;
  return v_id;
end;
$$;

---------------------------------------------------------------- 4. the linking rule (finding 5)

-- The verified identifiers of the calling auth user, read from `auth.users` and nowhere else.
-- This is the load-bearing half of the safety rule: because the identifier is never a parameter,
-- a caller cannot assert "my phone is the stranger's phone" and be believed. An identifier that
-- Supabase Auth has not stamped confirmed is treated as absent.
create or replace function public.my_verified_identifiers()
returns table (phone text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when u.phone_confirmed_at is not null then nullif(trim(u.phone), '') end,
    case when u.email_confirmed_at is not null then lower(nullif(trim(u.email), '')) end
  from auth.users u
  where u.id = auth.uid()
$$;

-- Audit of every link decision on the customer timeline. `customer_events.type` is a CHECK'd
-- enumeration and migration 35 adds nothing structural, so these ride on `note` with a typed
-- payload rather than a new type — `payload->>'event' = 'account_link'` is the selector the
-- back-office filters on. A new `account_link` event type is a better long-term shape and is a
-- numbered request in memory/boots/proposed/S2-contract-request.md, not a change made here.
create or replace function public.log_account_link(
  p_customer_id uuid, p_outcome text, p_reason text, p_uid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
  values (p_customer_id, 'note', 'customer', p_customer_id,
          jsonb_strip_nulls(jsonb_build_object(
            'event', 'account_link',
            'outcome', p_outcome,
            'reason', p_reason,
            'auth_user_id', p_uid,
            'text', 'Account link: ' || p_outcome || coalesce(' (' || p_reason || ')', ''))));
$$;

-- link_my_account() — finding 5 plus the email tie-break the boot attributes to "D-021"
-- (which is NOT in memory/decisions.md — see S2-07's report; the rule below is the boot's text).
--
-- Chosen as an explicit RPC rather than a trigger on `auth.users`, per S0's ruling and confirmed
-- while writing it: the rule must be able to *refuse* and leave an account deliberately unlinked,
-- and a trigger has no channel to tell the client that happened — `staff_merge_required` is an
-- outcome the login screen has to render, not a log line.
--
-- Outcomes (all of them audited on the customer timeline where a customer row exists):
--   already_linked        this auth user already has a profile — idempotent, safe to call on every login
--   linked_by_phone       verified phone matched exactly one eligible row
--   linked_by_email       verified email matched exactly one eligible row
--   created               no eligible candidate — a fresh profile, deliberately empty
--   staff_merge_required  a candidate existed but is not safe to take, and a fresh row is
--                         impossible because it would need the candidate's phone (unique).
--                         reason `concurrent_conflict` is the same answer reached by a race:
--                         something took the phone between the check and the insert
--   needs_verified_identifier   nothing confirmed on the account yet (no channel has run)
--   needs_phone           a fresh row is required but the account has no verified phone, and
--                         `customers.phone` is `not null` — the structural gap in S2-07's report
--
-- Eligibility of a candidate row, all three required:
--   (a) `auth_user_id is null`        — never take an account someone else already holds
--   (b) `anonymised_at is null`       — an erased row is never a candidate
--   (c) `kitchen_note is null`        — S2-07's addition, strictly tightening the boot's rule.
--       Finding 5's stated remedy ("link when the identifier matches and the row has no other
--       account attached") does not actually prevent the disaster finding 5 describes: a guest row
--       is unlinked *by definition*, so a recycled number matches one and is taken, and
--       `kitchen_note` is copied to `orders.allergy_note` on every order. The column that makes
--       mis-linking a food-safety defect rather than a privacy one is exactly `kitchen_note`, so
--       automatic linking is gated on it being absent. Rows without one carry order history and
--       addresses only — the risk the product already accepts, since guest checkout has matched
--       profiles by phone since S2-01. See S2-07's report; S0 to rule.
create or replace function public.link_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_phone     text;
  v_email     text;
  v_existing  public.customers;
  v_cand      public.customers;
  v_n         integer;
  v_outcome   text;
  v_reason    text;
  v_cust      public.customers;
  v_name      text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- staff are not customers; a staff member calling this must not acquire a customer profile
  if exists (select 1 from public.staff s where s.id = v_uid) then
    raise exception 'staff_cannot_link' using errcode = '42501',
      detail = 'This uid belongs to a staff account. Customer profiles are a separate identity.';
  end if;

  -- idempotent: every login can call this
  select * into v_existing from public.customers c where c.auth_user_id = v_uid;
  if found then
    return jsonb_build_object('linked', true, 'outcome', 'already_linked',
                              'customer_id', v_existing.id,
                              'anonymised', v_existing.anonymised_at is not null);
  end if;

  select i.phone, i.email into v_phone, v_email from public.my_verified_identifiers() i;

  if v_phone is null and v_email is null then
    return jsonb_build_object('linked', false, 'outcome', 'needs_verified_identifier',
                              'customer_id', null);
  end if;

  ------------------------------------------------------------ phone first
  -- `customers.phone` is `text not null unique`, so a phone match is zero rows or exactly one.
  -- It is also the stronger proof: the customer demonstrated possession of the number.
  if v_phone is not null then
    -- `for update`: this is a login endpoint, so two concurrent calls are normal (a client
    -- retrying, or a second device). Without the lock both could see the same candidate unlinked
    -- and both claim it, and the loser would get a raw 23505 instead of an outcome.
    select * into v_cand from public.customers c where c.phone = v_phone for update;
    if found then
      if v_cand.auth_user_id is not null then
        v_reason := 'identifier_claimed';
      elsif v_cand.anonymised_at is not null then
        v_reason := 'profile_anonymised';
      elsif v_cand.kitchen_note is not null then
        v_reason := 'profile_has_kitchen_note';
      else
        update public.customers
           set auth_user_id = v_uid,
               email = coalesce(email, v_email)
         where id = v_cand.id
         returning * into v_cust;
        perform public.log_account_link(v_cust.id, 'linked_by_phone', null, v_uid);
        return jsonb_build_object('linked', true, 'outcome', 'linked_by_phone',
                                  'customer_id', v_cust.id);
      end if;

      -- A candidate exists on this phone and is not safe to take. A fresh row cannot be created
      -- either: it would need this same phone, which is UNIQUE and already held. Refusing is the
      -- only outcome that neither hands over the stranger's row nor fails a constraint — and it is
      -- what finding 5's "let staff merge deliberately from the back-office" is for.
      perform public.log_account_link(v_cand.id, 'staff_merge_required', v_reason, v_uid);
      return jsonb_build_object('linked', false, 'outcome', 'staff_merge_required',
                                'reason', v_reason, 'customer_id', null);
    end if;
  end if;

  ------------------------------------------------------------ then email
  -- `customers.email` is nullable with NO unique constraint or index (measured, migration 4), so
  -- an email match can be zero, one or many rows. Link only on exactly one eligible candidate.
  -- A NULL verified email matches nothing — guarded by the `v_email is not null` test, because
  -- `where lower(email) = null` would quietly return zero rows and look like "no candidate"
  -- instead of "not asked".
  if v_email is not null then
    select count(*) into v_n
      from public.customers c
     where lower(c.email) = v_email
       and c.anonymised_at is null;

    if v_n = 1 then
      select * into v_cand
        from public.customers c
       where lower(c.email) = v_email
         and c.anonymised_at is null
         for update;

      if v_cand.auth_user_id is null and v_cand.kitchen_note is null then
        update public.customers
           set auth_user_id = v_uid
         where id = v_cand.id
         returning * into v_cust;
        perform public.log_account_link(v_cust.id, 'linked_by_email', null, v_uid);
        return jsonb_build_object('linked', true, 'outcome', 'linked_by_email',
                                  'customer_id', v_cust.id);
      end if;
      -- not eligible — fall through to a fresh row. Unlike the phone branch this is possible,
      -- because the email is not unique and the fresh row carries the verified phone instead.
      v_reason := case
        when v_cand.auth_user_id is not null then 'identifier_claimed'
        else 'profile_has_kitchen_note'
      end;
    elsif v_n > 1 then
      -- two or more rows carry this email: never a guess (the boot's tie-break)
      v_reason := 'ambiguous_email';
    end if;
  end if;

  ------------------------------------------------------------ fresh row
  if v_phone is null then
    -- `customers.phone` is `not null`, so an email-only account cannot get a profile at all.
    -- Refused explicitly rather than invented: a placeholder phone would collide on the unique
    -- index and would poison the guest-checkout upsert key. Reported as the structural gap that
    -- blocks phase B's email-only login.
    return jsonb_build_object('linked', false, 'outcome', 'needs_phone',
                              'reason', coalesce(v_reason, 'no_candidate'));
  end if;

  select coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), '')
    into v_name
    from auth.users u where u.id = v_uid;

  -- The checks above are not in the same statement as this insert, so two things can change
  -- underneath them: a concurrent call for this same uid, or a concurrent GUEST ORDER that creates
  -- a customer on this phone (`place_order` upserts by phone and is the busiest path in the
  -- system). Both surface as a unique violation, and both must resolve to a safe answer rather
  -- than a raw 23505 on a login screen.
  begin
    insert into public.customers (name, phone, email, auth_user_id)
    values (coalesce(v_name, ''), v_phone, v_email, v_uid)
    returning * into v_cust;
  exception when unique_violation then
    -- did this uid get a profile in the meantime?
    select * into v_existing from public.customers c where c.auth_user_id = v_uid;
    if found then
      return jsonb_build_object('linked', true, 'outcome', 'already_linked',
                                'customer_id', v_existing.id,
                                'anonymised', v_existing.anonymised_at is not null);
    end if;
    -- otherwise something else took the phone between the check and the insert. Refuse rather
    -- than retry into a row whose eligibility was never evaluated.
    return jsonb_build_object('linked', false, 'outcome', 'staff_merge_required',
                              'reason', 'concurrent_conflict', 'customer_id', null);
  end;

  perform public.log_account_link(v_cust.id, 'created', v_reason, v_uid);
  return jsonb_strip_nulls(jsonb_build_object('linked', true, 'outcome', 'created',
                            'reason', v_reason, 'customer_id', v_cust.id));
end;
$$;


---------------------------------------------------------------- 5. the self-service surface

-- get_my_profile() — the customer's own profile, as an explicit field list.
--
-- `kitchen_note` is deliberately absent. It is staff-authored internal text about the customer
-- ("copied to orders.allergy_note on every order"), and whether a customer should be shown what
-- the kitchen and the operators have written about them is an owner's decision, not a session's.
-- Omitting it also means a column added to `customers` later cannot leak through a `select *`.
-- This is why there is no self SELECT policy on `customers` — see section 6.
create or replace function public.get_my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = public.require_customer_id();
  return jsonb_build_object(
    'customer_id', c.id,
    'name', c.name,
    'phone', c.phone,
    'email', c.email,
    'birthday', c.birthday,
    'is_company', c.is_company,
    'consent', jsonb_build_object(
      'email', c.consent_email is not null,
      'push',  c.consent_push  is not null,
      'phone', c.consent_phone is not null),
    'created_at', c.created_at,
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'label', a.label, 'street', a.street, 'floor_apt', a.floor_apt,
        'postal_code', a.postal_code, 'city', a.city, 'is_default', a.is_default)
        order by a.is_default desc, a.created_at)
      from public.customer_addresses a where a.customer_id = c.id), '[]'::jsonb)
  );
end;
$$;

-- update_my_profile() — the customer-writable field list, and only it.
--
-- Writable: name, birthday, email.
--   `email` is safe to let a customer set *because* only a linked customer can call this, and a
--   linked row has `auth_user_id is not null`, which link_my_account()'s eligibility rule (a)
--   permanently excludes from being an email candidate. So a customer cannot poison the email
--   match by writing a stranger's address into their own row. (The same is NOT true of the
--   `contact.email` a guest passes to `place_order`, which lands on an *unlinked* row — a real
--   email-poisoning vector that predates this migration and is reported for S7-04, not fixed here.)
--
-- Not writable, each for its own reason:
--   `phone`        the verified login identifier AND `place_order`'s guest-checkout upsert key; it
--                  is UNIQUE, so an update is an attempt to claim an identifier. Changing it
--                  belongs with re-verification, which is a channel operation — phase B/C.
--   `kitchen_note` allergy text the kitchen cooks against. A customer-writable path into the
--                  kitchen card is the food-safety surface this whole phase exists to protect.
--   `tags`         staff segmentation; drives campaign reach (resolve_segment, S2-06).
--   `is_company`   invoicing and VAT consequences (D-019 territory).
--   `consent_*`    a legal record. The consent trigger (migration 13) fires on any update and
--                  would write a `consent_changed` event with no `source`, which is worse than no
--                  path at all. Consent gets its own RPC with an explicit source in phase B.
--   `anonymised_at`, `auth_user_id`, `id`, `created_at`, `updated_at` — not data, mechanism.
--
-- NULL means "leave unchanged" for every parameter; clearing a field is not expressible, which is
-- deliberate for `name` (`not null`) and accepted for the other two in this phase.
create or replace function public.update_my_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := public.require_customer_id();
  v_keys  text[] := array['name', 'birthday', 'email'];
  v_bad   text[];
  v_name  text;
  v_email text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'payload must be a JSON object';
  end if;

  -- Reject unknown/forbidden keys loudly. Silently ignoring `kitchen_note` would let a client
  -- believe it had written one — the same failure class as a silent RLS no-op.
  select array_agg(k) into v_bad
    from jsonb_object_keys(payload) k
   where k <> all (v_keys);
  if v_bad is not null then
    raise exception 'field_not_writable' using errcode = '42501',
      detail = 'not customer-writable: ' || array_to_string(v_bad, ', '),
      hint = 'writable: ' || array_to_string(v_keys, ', ');
  end if;

  if payload ? 'name' then
    v_name := nullif(trim(payload->>'name'), '');
    if v_name is null then
      raise exception 'invalid_input' using errcode = 'P0001', detail = 'name must not be empty';
    end if;
  end if;

  if payload ? 'email' then
    v_email := lower(nullif(trim(payload->>'email'), ''));
    if v_email is not null and v_email not like '%_@_%.__%' then
      raise exception 'invalid_input' using errcode = 'P0001', detail = 'email is not an address';
    end if;
  end if;

  update public.customers
     set name     = coalesce(v_name, name),
         email    = case when payload ? 'email' then v_email else email end,
         birthday = case when payload ? 'birthday' then (payload->>'birthday')::date else birthday end
   where id = v_id;

  return public.get_my_profile();
end;
$$;

-- get_my_orders() — the caller's own orders, newest first.
--
-- A function rather than a policy on `orders`, on purpose. Policies are OR-ed, and `orders`
-- already carries `orders_kitchen_read using (public.is_staff('kitchen'))` with no row
-- restriction (open item B4, observed here and deliberately not fixed). Adding another permissive
-- policy to that table widens a surface that is already the loosest in the schema, and the
-- `report_payments` lesson (D-012 era) is that a view or policy is only as tight as the loosest
-- thing it touches. This function's guard is its own.
--
-- Field list mirrors get_order_by_token (migration 10) so S3 can reuse the tracking renderer.
create or replace function public.get_my_orders(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := public.require_customer_id();
  v_l  integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_o  integer := greatest(coalesce(p_offset, 0), 0);
begin
  -- `created_at desc` alone is NOT a stable sort, and this function paginates: `now()` is
  -- transaction-stable, so two orders placed in one transaction (or merely in the same instant)
  -- tie, the tie-break is whatever the plan happens to produce, and a row can then appear on two
  -- pages or on none. `number` is a unique sequence, so adding it makes the order total.
  return jsonb_build_object(
    'total', (select count(*) from public.orders o where o.customer_id = v_id),
    'orders', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc, x.number desc)
      from (
        select o.id as order_id, o.number, o.status, o.type, o.payment_status, o.payment_method,
               o.tracking_token, o.scheduled_for, o.promised_minutes, o.created_at, o.completed_at,
               o.cancelled_at, o.contact_name, o.address, o.courier_comment, o.allergy_note,
               o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.tip_cents,
               o.total_cents, o.vat_cents, o.promo_code,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'name', i.name, 'qty', i.qty, 'unit_price_cents', i.unit_price_cents,
                   'options', i.options, 'line_total_cents', i.line_total_cents) order by i.created_at)
                 from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
        from public.orders o
        where o.customer_id = v_id
        order by o.created_at desc, o.number desc
        limit v_l offset v_o
      ) x), '[]'::jsonb)
  );
end;
$$;

---------------------------------------------------------------- address CRUD (existing table)

-- `customer_addresses` has existed since migration 4. These are CRUD + RLS over it; no table is
-- created here. Writes go through RPCs rather than table grants for two reasons: `zone_id` is
-- derived server-side from the postal code (a client must not pick its own delivery zone, even
-- though `place_order` recomputes the zone from the payload and never trusts a saved row), and the
-- one-default rule is enforced in one place instead of relying on every caller.

create or replace function public.add_my_address(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := public.require_customer_id();
  v_postal  text := nullif(trim(payload->>'postal_code'), '');
  v_street  text := nullif(trim(payload->>'street'), '');
  v_zone    uuid;
  v_default boolean := coalesce((payload->>'is_default')::boolean, false);
  a         public.customer_addresses;
begin
  if v_street is null or v_postal is null then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'street and postal_code are required';
  end if;

  select z.id into v_zone
    from public.delivery_zones z
   where z.active and v_postal = any (z.postal_codes)
   limit 1;

  -- first address is the default whatever the client said; otherwise honour the request
  if not exists (select 1 from public.customer_addresses x where x.customer_id = v_id) then
    v_default := true;
  end if;
  if v_default then
    update public.customer_addresses set is_default = false where customer_id = v_id and is_default;
  end if;

  insert into public.customer_addresses
    (customer_id, label, street, floor_apt, postal_code, city, zone_id, is_default)
  values (v_id, nullif(trim(payload->>'label'), ''), v_street,
          nullif(trim(payload->>'floor_apt'), ''), v_postal,
          coalesce(nullif(trim(payload->>'city'), ''), 'Berlin'), v_zone, v_default)
  returning * into a;

  return to_jsonb(a);
end;
$$;

-- p_id is the *address* id, not a customer id: ownership is still resolved from auth.uid(), and an
-- address belonging to anyone else simply does not match the WHERE clause. The `not found` raise
-- is what makes "someone else's address" distinguishable from "no change" at the client.
create or replace function public.update_my_address(p_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := public.require_customer_id();
  v_zone uuid;
  a      public.customer_addresses;
begin
  select * into a from public.customer_addresses
   where id = p_id and customer_id = v_id;
  if not found then
    raise exception 'address_not_found' using errcode = 'P0002';
  end if;

  if payload ? 'postal_code' then
    select z.id into v_zone
      from public.delivery_zones z
     where z.active and nullif(trim(payload->>'postal_code'), '') = any (z.postal_codes)
     limit 1;
  end if;

  update public.customer_addresses
     set label       = case when payload ? 'label'       then nullif(trim(payload->>'label'), '') else label end,
         street      = coalesce(nullif(trim(payload->>'street'), ''), street),
         floor_apt   = case when payload ? 'floor_apt'   then nullif(trim(payload->>'floor_apt'), '') else floor_apt end,
         postal_code = coalesce(nullif(trim(payload->>'postal_code'), ''), postal_code),
         city        = coalesce(nullif(trim(payload->>'city'), ''), city),
         zone_id     = case when payload ? 'postal_code' then v_zone else zone_id end
   where id = p_id and customer_id = v_id
   returning * into a;

  -- is_default is not settable here: set_my_default_address() is the one path, so the
  -- "exactly one default" invariant has exactly one enforcement point.
  return to_jsonb(a);
end;
$$;

create or replace function public.set_my_default_address(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := public.require_customer_id();
  a    public.customer_addresses;
begin
  if not exists (select 1 from public.customer_addresses x where x.id = p_id and x.customer_id = v_id) then
    raise exception 'address_not_found' using errcode = 'P0002';
  end if;
  -- clear first, then set: the partial unique index is checked per statement, so the reverse
  -- order would transiently hold two defaults and fail.
  update public.customer_addresses set is_default = false where customer_id = v_id and is_default;
  update public.customer_addresses set is_default = true  where id = p_id and customer_id = v_id
    returning * into a;
  return to_jsonb(a);
end;
$$;

create or replace function public.delete_my_address(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid := public.require_customer_id();
  v_was boolean;
begin
  delete from public.customer_addresses
   where id = p_id and customer_id = v_id
   returning is_default into v_was;
  if not found then
    raise exception 'address_not_found' using errcode = 'P0002';
  end if;

  -- never leave a customer with addresses and no default
  if v_was then
    update public.customer_addresses set is_default = true
     where id = (select x.id from public.customer_addresses x
                  where x.customer_id = v_id order by x.created_at limit 1);
  end if;
  return jsonb_build_object('deleted', p_id);
end;
$$;

---------------------------------------------------------------- 6. RLS for a customer

-- `customer_addresses`: read your own rows directly (S3 renders a list), write only through the
-- RPCs above. `for select` only, so the policy cannot become a write path by accident.
create policy customer_addresses_self_read on public.customer_addresses
  for select to authenticated
  using (customer_id = public.current_customer_id());

-- Deliberately NOT created, and each omission is the answer to a question S0's boot asks:
--   * a self SELECT policy on `customers` — it would hand the customer their own `kitchen_note`
--     via `select *`, and whether staff's internal note about a person is shown to that person is
--     the owner's call. `get_my_profile()` serves the field list instead.
--   * any customer policy on `orders` / `order_items` — see get_my_orders()'s comment on B4.
--   * any customer policy on `customer_events` — the timeline holds staff notes, complaints and
--     compensations. Nothing in phase A needs a customer to read it.

---------------------------------------------------------------- 7. grants
--
-- Migration 18's finding, restated because it keeps costing: Supabase's default privileges grant
-- EXECUTE on every new function in `public` to anon, authenticated AND service_role. `revoke …
-- from public` does not remove those. So every function above is explicitly revoked first and
-- then granted only where it belongs, and `security_audit_function_grants()` +
-- tests/security.test.ts assert the result against the live catalog.

-- internal: reachable only from inside the security-definer functions above (which run as the
-- function owner), never over PostgREST. `current_customer_id` is the exception — it is used by
-- `customer_addresses_self_read`, and a policy's expression is evaluated as the querying role, so
-- `authenticated` must hold EXECUTE on it or the policy errors instead of filtering.
revoke all on function public.require_customer_id()                        from public, anon, authenticated;
revoke all on function public.my_verified_identifiers()                    from public, anon, authenticated;
revoke all on function public.log_account_link(uuid, text, text, uuid)     from public, anon, authenticated, service_role;

revoke all on function public.current_customer_id()                        from public, anon;
grant  execute on function public.current_customer_id()                    to authenticated, service_role;
grant  execute on function public.require_customer_id()                    to service_role;
grant  execute on function public.my_verified_identifiers()                to service_role;

-- the customer surface: authenticated only, never anon. A guest has no account to be scoped to,
-- and an anon-callable `get_my_*` would be a function whose guard depends on a NULL uid.
revoke all on function public.link_my_account()                            from public, anon;
revoke all on function public.get_my_profile()                             from public, anon;
revoke all on function public.update_my_profile(jsonb)                     from public, anon;
revoke all on function public.get_my_orders(integer, integer)              from public, anon;
revoke all on function public.add_my_address(jsonb)                        from public, anon;
revoke all on function public.update_my_address(uuid, jsonb)               from public, anon;
revoke all on function public.set_my_default_address(uuid)                 from public, anon;
revoke all on function public.delete_my_address(uuid)                      from public, anon;

grant execute on function public.link_my_account()                         to authenticated, service_role;
grant execute on function public.get_my_profile()                          to authenticated, service_role;
grant execute on function public.update_my_profile(jsonb)                  to authenticated, service_role;
grant execute on function public.get_my_orders(integer, integer)           to authenticated, service_role;
grant execute on function public.add_my_address(jsonb)                     to authenticated, service_role;
grant execute on function public.update_my_address(uuid, jsonb)            to authenticated, service_role;
grant execute on function public.set_my_default_address(uuid)              to authenticated, service_role;
grant execute on function public.delete_my_address(uuid)                   to authenticated, service_role;
