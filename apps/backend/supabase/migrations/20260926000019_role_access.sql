-- [S2-03] 19 — role access: settings key sets, staff_directory, kitchen capacity
--            (api-contracts §6.9 rows 1, 2, 6; §4)
--
-- S4-01 found that `kitchen` and `driver` sessions can read neither `settings.ops` nor any `staff`
-- row but their own, so the kitchen board had no prep time and timelines could not name an actor.
-- S0 granted both, narrowed:
--   · every authenticated staff role reads the public key set **plus `ops`**;
--   · `payments` (private), the `kitchen` key (paused_by / rush) and every future credential-bearing
--     key stay owner/operator;
--   · `staff` keeps its owner/operator policy — the other roles read a view with four columns.
--
-- Three key sets from here on (README "Settings key sets"):
--   settings_public_keys()  anon + everyone   business, opening_hours, site, payments.enabled,
--                                             kitchen.status
--   settings_staff_keys()   any staff role    the public set + `ops`
--   (everything else)       owner / operator   `payments`, `kitchen`, any future secret-bearing key
--
-- `business` holds imprint data only (name, address, phone, email, impressum, ust_id) — all of it
-- legally public, which is why it is in the public set. Billing, payout or credential fields must
-- NOT be added to it: they belong in `payments` (private) or a new private key.

---------------------------------------------------------------- settings key sets
-- Unchanged, restated so the three sets read together.
create or replace function public.settings_public_keys()
returns text[]
language sql
immutable
set search_path = public
as $$ select array['business', 'opening_hours', 'site', 'payments.enabled', 'kitchen.status'] $$;

-- Readable by every authenticated staff role (owner, operator, kitchen, driver).
create or replace function public.settings_staff_keys()
returns text[]
language sql
immutable
set search_path = public
as $$ select public.settings_public_keys() || array['ops'] $$;

revoke execute on function public.settings_staff_keys() from public;
grant execute on function public.settings_staff_keys() to anon, authenticated, service_role;

-- auth_role() is null for anon and for any authenticated user who is not active staff, so the
-- explicit `is not null` is the role gate (a bare `= any(...)` on a null role yields null = deny,
-- but stating it keeps the intent readable and matches the S2-02 standing rule).
create policy settings_staff_common_read on public.settings
  for select to authenticated
  using (public.auth_role() is not null and key = any (public.settings_staff_keys()));

comment on table public.settings is
  'Single-tenant key/value. settings_public_keys() = readable by anon; settings_staff_keys() = '
  '+ `ops`, readable by every staff role; everything else (payments, kitchen, future '
  'credential-bearing keys) is owner/operator. Never put billing or credentials into `business`.';

---------------------------------------------------------------- staff_directory (§6.9 row 2)
-- Four columns, every authenticated staff role. `security_invoker = false` on purpose: the view runs
-- as its owner so it can see rows the caller's RLS on `public.staff` would hide, and the WHERE
-- clause is the access control. The column list is explicit so a column added to `staff` later
-- (phone is already there) is not exposed by accident.
create view public.staff_directory
with (security_invoker = false, security_barrier = true)
as
select s.id, s.name, s.role, s.active
from public.staff s
where public.auth_role() is not null;

comment on view public.staff_directory is
  'api-contracts §4 / §6.9 row 2 — id, name, role, active for every authenticated staff role. '
  'Explicit column list: phone and anything added to `staff` later must stay behind the base '
  'table policy (owner/operator). Empty for anon and for non-staff sessions.';

revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated, service_role;

---------------------------------------------------------------- kitchen capacity (§6.9 row 6)
-- `settings.kitchen.capacity` in S0's shorthand = field `capacity` on the **public** key
-- `kitchen.status`, so the kitchen board can read it (the private `kitchen` key stays
-- owner/operator). Concurrent orders the kitchen can hold; the UI computes
-- count(accepted, preparing) / capacity itself — no RPC.
insert into public.settings (key, value)
values ('kitchen.status', jsonb_build_object('paused', false, 'since', null, 'capacity', 8))
on conflict (key) do update
  set value = settings.value || jsonb_build_object(
    'capacity', coalesce(settings.value->'capacity', to_jsonb(8)));

-- kitchen_pause() used to replace the whole `kitchen.status` value, which would drop `capacity`.
-- It also had a NULL-role hole: `v_role not in ('owner','operator')` evaluates to NULL for a
-- non-staff authenticated caller, so the gate did not raise (migration 18 kept `anon` out, but an
-- authenticated non-staff JWT got through). Both fixed; signature and return shape unchanged.
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
  if v_role is null or v_role not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  insert into public.settings (key, value)
  values ('kitchen', jsonb_build_object('paused', paused, 'paused_by', auth.uid(), 'paused_at', now(), 'rush', false))
  on conflict (key) do update
    set value = settings.value || jsonb_build_object(
      'paused', paused,
      'paused_by', case when paused then auth.uid() else null end,
      'paused_at', case when paused then now() else null end);

  -- merge, never replace: `capacity` lives here too
  insert into public.settings (key, value)
  values ('kitchen.status', jsonb_build_object('paused', paused, 'since', now(), 'capacity', 8))
  on conflict (key) do update
    set value = settings.value || jsonb_build_object('paused', paused, 'since', now())
  returning value into v_status;

  return v_status;
end;
$$;
revoke execute on function public.kitchen_pause(boolean) from public, anon;
grant execute on function public.kitchen_pause(boolean) to authenticated, service_role;
