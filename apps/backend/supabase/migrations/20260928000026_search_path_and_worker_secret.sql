-- [S2-04] 26 — hygiene + the payment-worker caller check (S7-01 findings 5 and 3/7 DB side)
--
-- A. `search_path` pinned on the six SECURITY INVOKER functions S7 listed (finding 5). These run
--    with the caller's privileges, so this is not a privilege-escalation fix — it is consistency:
--    every SECURITY DEFINER function in the schema already pins it, and a function that resolves
--    `regexp_replace` or an enum through a caller-controlled search_path is a footgun waiting for
--    the next person. `current_actor` and `orders_before_status_change` need `auth.uid()`, so they
--    get `public, auth`; the rest take `public`.
--    Bodies are otherwise **byte-identical** to the versions on main — only the SET clause is new.
--
-- B. `payment_worker_secret()` — a secret the DB owns, so the `payment-worker` Edge Function can
--    tell "pg_cron called me" from "someone POSTed the public anon key" (findings 3 and 7; S1 hit
--    the same thing in S1-04). See the function and `/memory/boots/proposed/S2-04-S1-payment-worker-install-token.md`
--    for the half that is S1's.

---------------------------------------------------------------- A. search_path on invoker functions
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.current_actor(out actor_type public.actor_type, out actor_id uuid)
language plpgsql
stable
set search_path = public, auth
as $$
declare
  t text := nullif(current_setting('shosho.actor_type', true), '');
  i text := nullif(current_setting('shosho.actor_id', true), '');
begin
  if t is not null then
    actor_type := t::public.actor_type;
    actor_id := i::uuid;
  elsif auth.uid() is not null and exists (select 1 from public.staff where id = auth.uid()) then
    actor_type := 'staff';
    actor_id := auth.uid();
  else
    actor_type := 'system';
    actor_id := null;
  end if;
end;
$$;
revoke execute on function public.current_actor() from public, anon, authenticated;
grant execute on function public.current_actor() to service_role;

create or replace function public.orders_before_status_change()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'accepted'         then new.accepted_at  := coalesce(new.accepted_at, now());
                                   if new.accepted_by is null and auth.uid() is not null
                                      and exists (select 1 from public.staff where id = auth.uid()) then
                                     new.accepted_by := auth.uid();
                                   end if;
      when 'preparing'        then new.preparing_at := coalesce(new.preparing_at, now());
      when 'ready'            then new.ready_at     := coalesce(new.ready_at, now());
      when 'out_for_delivery' then new.out_at       := coalesce(new.out_at, now());
      when 'delivered', 'picked_up'
                              then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled'        then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end;
$$;

-- settings_public_keys() already pins search_path since S2-03 migration 21; restated here only so
-- the six functions S7 listed can be checked in one place. No behaviour change.
create or replace function public.settings_public_keys()
returns text[]
language sql
immutable
set search_path = public
as $$ select array['business', 'opening_hours', 'site', 'payments.enabled', 'kitchen.status'] $$;

create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
set search_path = public
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

create or replace function public.order_transition_allowed(
  from_status public.order_status, to_status public.order_status,
  otype public.order_type, pstatus public.payment_status
)
returns boolean
language sql
immutable
set search_path = public
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
revoke execute on function public.order_transition_allowed(public.order_status, public.order_status, public.order_type, public.payment_status) from public, anon;
grant execute on function public.order_transition_allowed(public.order_status, public.order_status, public.order_type, public.payment_status) to authenticated, service_role;

---------------------------------------------------------------- B. payment-worker caller secret
-- `verify_jwt = true` on the Edge Function is satisfied by the **public** anon key — the one that
-- ships in the guest web bundle — and the function then works with the service role. So anyone
-- could drain the job queue (or re-run the schedule install). The function needs its own notion of
-- "this call came from our cron", and the DB is the only party that can hold one: the function
-- reads it back with its service-role client, and nobody else can read `vault`.
--
-- Returns the secret, generating it on first call. service_role only — an anon or staff session
-- cannot ask for it, which is the entire point.
create or replace function public.payment_worker_secret()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_id     uuid;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    -- local stack without supabase_vault: no secret, and the function falls back to service-role-only
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_secret using 'payment_worker_secret';
  if v_secret is null then
    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
    execute 'select id from vault.secrets where name = $1' into v_id using 'payment_worker_secret';
    if v_id is null then
      execute 'select vault.create_secret($1, $2)' using v_secret, 'payment_worker_secret';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, v_secret;
    end if;
  end if;
  return v_secret;
exception when others then
  raise warning 'payment_worker_secret: %', sqlerrm;
  return null;
end;
$$;
revoke execute on function public.payment_worker_secret() from public, anon, authenticated;
grant execute on function public.payment_worker_secret() to service_role;

-- `run_payment_worker` (migration 17) posts to the function with the key Vault holds under
-- `payment_worker_key`. Two changes, both so cron can prove who it is:
--   · it now also sends `x-worker-secret`, which only the DB and the function can know;
--   · `payment_worker_key` is written by `schedule_payment_worker` from whatever the installer
--     passes — the Edge Function now passes its **service-role** key instead of the anon key, so
--     the gateway JWT is no longer a public value either. (The parameter is still called
--     `p_anon_key`: CREATE OR REPLACE cannot rename a parameter and the function is already on
--     main. See the comment below.)
create or replace function public.run_payment_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_key    text;
  v_secret text;
begin
  if not exists (select 1 from public.payment_jobs where status = 'queued') then
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_url using 'payment_worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v_key using 'payment_worker_key';
  if v_url is null or v_key is null then
    return;
  end if;
  v_secret := public.payment_worker_secret();
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          jsonb_build_object('source', 'pg', 'at', now()),
          '{}'::jsonb,
          jsonb_strip_nulls(jsonb_build_object('Content-Type', 'application/json',
                             'Authorization', 'Bearer ' || v_key,
                             'apikey', v_key,
                             'x-worker-secret', v_secret)),
          15000;
exception when others then
  raise warning 'run_payment_worker: %', sqlerrm;
end;
$$;
revoke execute on function public.run_payment_worker() from public, anon, authenticated;
grant execute on function public.run_payment_worker() to service_role;

comment on function public.schedule_payment_worker(text, text) is
  'Writes the Vault secrets payment_worker_url / payment_worker_key and (re)creates the pg_cron job. '
  'The parameter is historically named p_anon_key; since S2-04 the payment-worker function passes its '
  'SERVICE ROLE key, so the value cron presents is no longer a public one. CREATE OR REPLACE cannot '
  'rename a parameter, hence the stale name.';
