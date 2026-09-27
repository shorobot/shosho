-- [S7-01] 19 — fix NULL-unsafe role guards (security audit finding)
--
-- `kitchen_pause` and `anonymise_silent_customers` guard themselves with
-- `if v_role not in (...)` / `if not (v_role = 'owner' or ...)`. `v_role` is NULL for anon and for
-- any authenticated user who is not in `staff` (public.auth_role() returns NULL in both cases).
-- `NULL NOT IN (...)` and `NOT (NULL OR ...)` both evaluate to NULL, and `IF NULL THEN ... END IF`
-- in plpgsql is treated as false — so the guard silently does not fire and the function proceeds.
-- `update_order_items` and `add_customer_event` already comment on and avoid this exact pitfall
-- (`v_role is null or v_role not in (...)`); this migration applies the same pattern here.
--
-- This was not directly exploitable after migration 18 (which revokes anon's EXECUTE grant on both
-- functions, and neither one is ever granted to plain `authenticated` non-staff by any other path),
-- but the functions' own logic does not defend itself — a future migration that re-grants EXECUTE
-- (or a manual `grant` run by hand against a live project) would silently reopen an anon-callable
-- "pause the kitchen" / "run the GDPR scrub" endpoint with no logic-level guard to catch it. See
-- /docs/security.md.
--
-- No signature, return shape or grant changes — CREATE OR REPLACE keeps the existing ACL.

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

  v_status := jsonb_build_object('paused', paused, 'since', now());
  insert into public.settings (key, value) values ('kitchen.status', v_status)
  on conflict (key) do update set value = excluded.value;

  return v_status;
end;
$$;

create or replace function public.anonymise_silent_customers(months integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.staff_role := public.auth_role();
  v_cutoff timestamptz := now() - make_interval(months => greatest(coalesce(months, 24), 1));
  v_n      integer := 0;
  c        record;
begin
  -- the nightly cron / automation runs as the service role; a human caller must be the owner.
  -- `v_role is distinct from 'owner'` is NULL-safe (unlike `v_role <> 'owner'` / `not (v_role = ...)`):
  -- it is `true` when v_role is NULL (anon / non-staff), so the guard fires instead of silently
  -- passing through.
  if v_role is distinct from 'owner' and not public.is_service_request() then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  perform set_config('shosho.actor_type', 'system', true);
  perform set_config('shosho.actor_id', '', true);

  for c in
    select cu.id
      from public.customers cu
     where cu.anonymised_at is null
       and cu.created_at < v_cutoff
       and not exists (select 1 from public.orders o where o.customer_id = cu.id and o.created_at >= v_cutoff)
     for update of cu skip locked
  loop
    update public.customers
       set name = 'Anonymised',
           phone = 'anon-' || c.id::text,
           email = null,
           kitchen_note = null,
           birthday = null,
           is_company = false,
           consent_email = null,
           consent_push = null,
           consent_phone = null,
           anonymised_at = now()
     where id = c.id;

    delete from public.customer_addresses where customer_id = c.id;

    -- orders: keep number / dates / totals / items (GoBD); drop the personal snapshot
    update public.orders
       set contact_name = 'Anonymised',
           contact_phone = 'anon-' || c.id::text,
           address = case when address is null then null
                          else jsonb_strip_nulls(jsonb_build_object('postal_code', address->>'postal_code', 'city', address->>'city')) end,
           courier_comment = null,
           allergy_note = null,
           payment_ref = null
     where customer_id = c.id;

    insert into public.customer_events (customer_id, type, actor_type, actor_id, payload)
    values (c.id, 'anonymised', 'system', null, jsonb_build_object('months', months, 'cutoff', v_cutoff));

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;
