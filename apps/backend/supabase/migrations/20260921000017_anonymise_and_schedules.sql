-- [S2-02] 17 — GDPR anonymisation job + schedules (pg_cron / pg_net / Vault, all optional)
--
-- anonymise_silent_customers(months = 24): customers without an order in `months` (and created
-- before that) are scrubbed — name / phone / email / birthday / kitchen_note / consents, addresses
-- deleted, the PII snapshot on their orders (contact, address street, comments, allergy note)
-- removed; order totals, items and dates stay (GoBD, 10 years). Sets anonymised_at, writes
-- customer_events(anonymised). Never called by the seed.
--
-- Schedules (pg_cron, when the extension is available — it is on every hosted Supabase plan and
-- in the CLI stack; the migration degrades to "document the manual path" otherwise):
--   anonymise-silent-customers   01:00 and 02:00 UTC, guarded to run once at 03:00 Europe/Berlin
--   payment-worker               every minute → run_payment_worker() → pg_net POST to the
--                                payment-worker Edge Function (URL + anon key from Vault, written
--                                by schedule_payment_worker(); the anon key is public anyway).
--   + a trigger on payment_jobs insert fires run_payment_worker() immediately, so capture / void
--     normally happen within a second and the minute cron is only the retry path.

---------------------------------------------------------------- extensions (best effort)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
    exception when others then
      raise notice 'pg_cron not enabled: %', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      execute 'create extension if not exists pg_net with schema extensions';
    exception when others then
      raise notice 'pg_net not enabled: %', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    begin
      execute 'create extension if not exists supabase_vault';
    exception when others then
      raise notice 'supabase_vault not enabled: %', sqlerrm;
    end;
  end if;
end
$$;

---------------------------------------------------------------- helpers

-- True for a direct database connection (pg_cron, psql, automation) and for PostgREST requests made
-- with the service-role key; false for anon / a staff session. Used to let the nightly job run
-- unattended while keeping the RPC owner-only for human callers.
create or replace function public.is_service_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    'service_role') = 'service_role'
$$;
revoke execute on function public.is_service_request() from public, anon, authenticated;
grant execute on function public.is_service_request() to service_role;

---------------------------------------------------------------- anonymisation
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
  -- the nightly cron / automation runs as the service role; a human caller must be the owner
  if not (v_role = 'owner' or public.is_service_request()) then
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
revoke execute on function public.anonymise_silent_customers(integer) from public;
grant execute on function public.anonymise_silent_customers(integer) to authenticated, service_role;

---------------------------------------------------------------- payment worker trigger (pg_net + Vault)

-- Reads Vault secrets `payment_worker_url` / `payment_worker_key` (set by schedule_payment_worker);
-- posts to the Edge Function when queued jobs exist. Silent no-op when Vault / pg_net / the
-- secrets are absent (local stack, or before the first deploy).
create or replace function public.run_payment_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
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
  execute 'select net.http_post($1, $2, $3, $4, $5)'
    using v_url,
          jsonb_build_object('source', 'pg', 'at', now()),
          '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json',
                             'Authorization', 'Bearer ' || v_key,
                             'apikey', v_key),
          15000;
exception when others then
  raise warning 'run_payment_worker: %', sqlerrm;
end;
$$;
revoke execute on function public.run_payment_worker() from public;
grant execute on function public.run_payment_worker() to service_role;

create or replace function public.payment_jobs_kick_worker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.run_payment_worker();
  return null;
end;
$$;
create trigger payment_jobs_kick_worker
  after insert on public.payment_jobs
  for each statement execute function public.payment_jobs_kick_worker();

-- Installer (service role; called by the payment-worker Edge Function on `{"action":"install"}`
-- from the deploy pipeline): stores URL + anon key in Vault and (re)creates the cron job.
create or replace function public.schedule_payment_worker(p_url text, p_anon_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vault boolean := to_regclass('vault.secrets') is not null;
  v_cron  boolean := to_regclass('cron.job') is not null;
  v_id    uuid;
  v_jobid bigint;
begin
  if p_url is null or p_anon_key is null then
    raise exception 'invalid_input' using errcode = 'P0001', detail = 'p_url and p_anon_key are required';
  end if;
  if v_vault then
    execute 'select id from vault.secrets where name = $1' into v_id using 'payment_worker_url';
    if v_id is null then
      execute 'select vault.create_secret($1, $2)' using p_url, 'payment_worker_url';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, p_url;
    end if;
    v_id := null;
    execute 'select id from vault.secrets where name = $1' into v_id using 'payment_worker_key';
    if v_id is null then
      execute 'select vault.create_secret($1, $2)' using p_anon_key, 'payment_worker_key';
    else
      execute 'select vault.update_secret($1, $2)' using v_id, p_anon_key;
    end if;
  end if;
  if v_cron then
    execute 'select cron.schedule($1, $2, $3)' into v_jobid
      using 'payment-worker', '* * * * *', 'select public.run_payment_worker()';
  end if;
  return jsonb_build_object('vault', v_vault, 'cron', v_cron, 'cron_job_id', v_jobid);
end;
$$;
revoke execute on function public.schedule_payment_worker(text, text) from public;
grant execute on function public.schedule_payment_worker(text, text) to service_role;

---------------------------------------------------------------- cron schedules (when pg_cron exists)
do $$
begin
  if to_regclass('cron.job') is not null then
    -- 03:00 Europe/Berlin = 01:00 UTC (CEST) or 02:00 UTC (CET); the guard picks the right one.
    perform cron.schedule(
      'anonymise-silent-customers',
      '0 1,2 * * *',
      $j$select public.anonymise_silent_customers(24)
           where extract(hour from now() at time zone 'Europe/Berlin') = 3$j$);
    perform cron.schedule('payment-worker', '* * * * *', 'select public.run_payment_worker()');
  else
    raise notice 'pg_cron unavailable — schedule anonymise_silent_customers() and run_payment_worker() externally (see apps/backend/README.md)';
  end if;
end
$$;
