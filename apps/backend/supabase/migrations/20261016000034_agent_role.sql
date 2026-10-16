-- [S2-09] 34 — the `agent` Postgres role: grants per S7-03's ruling (docs/security.md §9, PR #95,
-- not yet merged to main — proposed/S7-03-S2-agent-role-grants.md is this migration's spec), plus
-- the approval state S7-03 §9.6 found missing from migration 33's shape.
--
-- THE RULING THIS IMPLEMENTS. `apps/automation` connects to Postgres directly via
-- AUTOMATION_DATABASE_URL (no PostgREST in front of it), as a dedicated, non-BYPASSRLS role —
-- never `service_role`. A direct connection carries no JWT, so `auth.uid()` is null and
-- `is_staff()` is false for this role no matter what — see `auth_role()`
-- (20260920000002_settings_staff_zones.sql:48). Every policy below is therefore new, keyed on
-- `current_user = 'agent'`, never layered on an `is_staff()` check. That is deliberate (§9.1): it
-- keeps "is staff" and "is agent" from ever being conflatable by accident.
--
-- NO PASSWORD IS SET OR COMMITTED HERE, ON PURPOSE. `create role ... with login` with no `password`
-- clause produces a role that cannot authenticate until one is set. That is an out-of-band step for
-- S1/the owner at plan.md step C5 (the deploy surface) — see this boot's log entry for the exact
-- command. A migration is a git-tracked file; a credential inside one is a published credential.

---------------------------------------------------------------- the role
create role agent with login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
comment on role agent is
  'D-020''s automation layer (apps/automation), connecting via AUTOMATION_DATABASE_URL directly to '
  'Postgres, never through PostgREST and never as service_role (docs/security.md §9.1, S7-03). No '
  'password is set by any migration — ALTER ROLE agent WITH PASSWORD is an out-of-band step run by '
  'S1/the owner at deploy time (plan.md C5), never committed to this repo. One shared role serves '
  'every D-020 agent (sales/accounting/warehouse/grow/quality) — S7-03 explicitly ruled out '
  'per-agent DB roles "not yet" — so nothing here distinguishes which agent is connected; that '
  'separation is the orchestrator''s own code (S5), not the database''s.';

---------------------------------------------------------------- universal revokes (§9.4)
-- Stated explicitly even where the default is already deny, so the next person reading this file
-- does not have to re-derive "does agent have X" from absence of a grant. agent has never been
-- granted DDL of any kind (CREATEDB/CREATEROLE are off on the role itself, and no `grant create`
-- on any schema is issued anywhere in this file), never DELETE on anything, and never read access
-- to `staff` (PII, owner/operator-only, §9.4).
revoke all on public.staff from agent;

-- Money columns on `orders` that §5's CRITICAL finding (migration 25, payment_trust_boundary) exists
-- to keep a client from setting directly. An agent is a client too (that finding's own words) — the
-- fix there was "trust nothing payment-shaped from the caller"; this is the same fix enforced
-- structurally; agent gets no UPDATE grant on `orders` at all below, so this revoke is belt-and-
-- braces documentation, not a live hole it closes. One correction to the boot's own column list:
-- there is no `payment_captured_cents` column on `orders` — the capture timestamp is
-- `payment_captured_at` (20260921000011_payments.sql:9); included below since it is as
-- trust-relevant as the four cents columns, even though it is not itself money.
revoke update (payment_status, payment_authorized_cents, payment_captured_at, payment_refunded_cents, total_cents)
  on public.orders from agent;

---------------------------------------------------------------- agents (registry) — §9.1, §9.4
-- SELECT only: an agent reads its own configured ceiling/active flag but can never raise its own
-- ceiling or flip its own `active` — "an agent that can [do that] has defeated the ceiling by
-- construction" (§9.3/§9.4). No UPDATE grant exists for `agent` anywhere in this file.
revoke all on public.agents from agent;
grant select on public.agents to agent;
create policy agents_agent_read on public.agents
  for select to agent using (current_user = 'agent');

---------------------------------------------------------------- agent_tasks — §9.1
-- No direct table grant. The only sanctioned write path is `claim_agent_tasks` below (security
-- definer, already does the INSERT/UPDATE as its owner) — giving `agent` its own table-level grant
-- here would be a second, unaudited way to reach the same rows for no benefit.
revoke all on public.agent_tasks from agent;

---------------------------------------------------------------- agent_runs — §9.1, §9.6
-- INSERT: lets the orchestrator open a run not tied to any queued task (task_id is nullable by
-- design, migration 33) — e.g. a scheduled Accounting run with nothing in the claim queue at all.
-- UPDATE: scoped by column grant to progress/outcome/cost (never task_id/agent_id/customer_id/
-- started_at — identity and audit columns that must never move), and scoped by RLS row policy to
-- `finished_at is null` so a run already closed can never be matched, let alone rewritten (§9.6).
-- `finished_at` itself is deliberately NOT in the column grant: only `finish_agent_run` (security
-- definer, below) closes a run, so the run-to-task reconciliation it performs can never be skipped
-- by a direct UPDATE that sets `finished_at` without also touching `agent_tasks`.
revoke all on public.agent_runs from agent;
grant insert (task_id, agent_id, customer_id) on public.agent_runs to agent;
grant update (conclusion, error, input_tokens, output_tokens, cost_usd, result) on public.agent_runs to agent;
create policy agent_runs_agent_insert on public.agent_runs
  for insert to agent with check (current_user = 'agent');
create policy agent_runs_agent_update on public.agent_runs
  for update to agent using (current_user = 'agent' and finished_at is null) with check (current_user = 'agent');

---------------------------------------------------------------- agent_run_logs — §9.1, §9.4
-- INSERT only, ever. "An append-only log the writer can edit is not an audit trail" (§9.1) — no
-- UPDATE/DELETE grant exists for `agent` here or anywhere else in this file.
revoke all on public.agent_run_logs from agent;
grant insert (run_id, level, message) on public.agent_run_logs to agent;
create policy agent_run_logs_agent_insert on public.agent_run_logs
  for insert to agent with check (current_user = 'agent');

---------------------------------------------------------------- claim_agent_tasks / finish_agent_run — §9.1 task 4
-- RULING (S0's reading, adopted): revoke from service_role, grant to agent only. The only intended
-- caller was always "the orchestrator," which is now `agent` by name — nothing in `apps/automation`
-- exists yet (confirmed: the directory holds only `.env.example` and `.gitkeep`) and no Edge
-- Function or other code calls either RPC, so there is no live caller to break. Leaving the
-- service_role grant in place would keep a second, wider path to the exact same operations — the
-- first time anyone reached for the service-role key instead of the new one (out of habit, or
-- because it was easier to have on hand), S7-03's ruling would be silently defeated. Revoked, not
-- kept-with-a-reason.
revoke execute on function public.claim_agent_tasks(integer) from service_role;
grant execute on function public.claim_agent_tasks(integer) to agent;
revoke execute on function public.finish_agent_run(uuid, boolean, text, text, integer, integer, numeric, jsonb, boolean) from service_role;
grant execute on function public.finish_agent_run(uuid, boolean, text, text, integer, integer, numeric, jsonb, boolean) to agent;

---------------------------------------------------------------- Accounting's reads — §9.1 (agent #1, C3's first)
-- orders / order_items / payment_events / payment_jobs: SELECT only, no write anywhere in the live
-- schema (its output is a report — an agent_outputs row below, not a write to any of these).
revoke all on public.orders         from agent;
revoke all on public.order_items    from agent;
revoke all on public.payment_events from agent;
revoke all on public.payment_jobs   from agent;
grant select on public.orders         to agent;
grant select on public.order_items    to agent;
grant select on public.payment_events to agent;
grant select on public.payment_jobs   to agent;
create policy orders_agent_read on public.orders
  for select to agent using (current_user = 'agent');
create policy order_items_agent_read on public.order_items
  for select to agent using (current_user = 'agent');
create policy payment_events_agent_read on public.payment_events
  for select to agent using (current_user = 'agent');
create policy payment_jobs_agent_read on public.payment_jobs
  for select to agent using (current_user = 'agent');

-- settings: §9.1 says "business/tax keys" — this schema has no separate tax key (VAT lives on
-- `menu_items.vat_onsite_pct`, not `settings`). `business` is the closest real match: it holds
-- imprint data **including `ust_id`** (the VAT ID — 20260926000021_role_access.sql's own comment),
-- and nothing else tax-shaped exists as a settings key. Scoped to exactly that one key, not
-- `settings_staff_keys()` (which also admits `ops` — auto-accept thresholds, irrelevant to
-- Accounting and no narrower reason for an agent to read them). `business` is anon-public already,
-- so this grant adds no new exposure.
revoke all on public.settings from agent;
grant select on public.settings to agent;
create policy settings_agent_read on public.settings
  for select to agent using (current_user = 'agent' and key = 'business');

---------------------------------------------------------------- Grow's reads — §9.1 (agent #2, not yet built)
-- orders / order_items (already granted above) / campaigns / automations: SELECT only, no write.
-- Deliberately NOT granted here: the tables underlying report_revenue_by_day / report_top_items /
-- report_funnel / report_delivery_times (menu_items, order_attempts, delivery_zones, and
-- customer_stats' join to customers) — those RPCs are security definer and already read them under
-- the function owner's own privileges, so `agent` needs no direct table grant to benefit from them
-- once S5 writes Grow to call them; granting direct read on `customers` in particular is not
-- something §9.1's table asked for and is skipped rather than assumed.
revoke all on public.campaigns   from agent;
revoke all on public.automations from agent;
grant select on public.campaigns   to agent;
grant select on public.automations to agent;
create policy campaigns_agent_read on public.campaigns
  for select to agent using (current_user = 'agent');
create policy automations_agent_read on public.automations
  for select to agent using (current_user = 'agent');

---------------------------------------------------------------- agent_outputs — §9.6, the missing approval state
-- C1 (migration 33)'s run/log tables answer "what happened during a run." They do not answer "is
-- this number currently trusted" — a run can finish successfully and log a wrong total, and nothing
-- distinguishes that from a run a human has actually reviewed. This is that status, shipped now
-- rather than deferred: C3's first agent is Accounting and its first output is Steuerberater-shaped
-- — defer this and the very first thing any agent ever produces is a number nothing can tell apart
-- from a reviewed one, which is exactly the failure S7-03 named, arriving on the very next boot
-- rather than a distant one.
--
-- SHAPE CHOSEN: one shared table referencing the run, not a column-per-output-table. Reasoning:
-- C8's stock schema and the Sales drafts table do not exist yet (both out of this boot's
-- boundary), and "adoptable without a rewrite" is easiest to guarantee if adopting it means adding
-- one nullable `agent_output_id uuid references agent_outputs(id)` column to a future table,
-- rather than every future output-shaped table re-declaring its own
-- status/reviewer_id/reviewed_at/review_note trio and the same review RPC's logic again. `kind` is
-- free text (same reasoning as `agents.key`, `agent_tasks.payload`): the set of things an agent can
-- produce is expected to grow, and a fixed enum would need a migration each time.
create type public.agent_output_status as enum ('pending', 'approved', 'rejected');

create table public.agent_outputs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.agent_runs (id) on delete cascade,
  agent_id    uuid not null references public.agents (id),
  kind        text not null,                        -- 'report' | 'draft' | 'stock_adjustment' | … — S5's vocabulary
  payload     jsonb not null default '{}'::jsonb,    -- the produced artifact itself
  status      public.agent_output_status not null default 'pending',
  reviewer_id uuid references public.staff (id),     -- null until reviewed; set only by review_agent_output
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz not null default now()
);
comment on table public.agent_outputs is
  'What an agent produces, separate from the run record that produced it (agent_runs answers "what '
  'happened"; this answers "is it trusted"). Nothing downstream — a Steuerberater export, a '
  'promoted Sales draft, a stock figure feeding a reorder — may treat a row here as live before '
  '`status` = ''approved''. `agent` may only INSERT (always landing as ''pending'' — status is not '
  'in its column grant); only `review_agent_output()` may move status, and only to an '
  'owner/operator staff session, never to `agent` itself (§9.6 asymmetry: the role that produced '
  'the output must have no path to approve it).';

create index agent_outputs_run_idx on public.agent_outputs (run_id);
create index agent_outputs_pending_idx on public.agent_outputs (status) where status = 'pending';

alter table public.agent_outputs enable row level security;

revoke all on public.agent_outputs from anon, agent;
revoke insert, update, delete on public.agent_outputs from authenticated;

create policy agent_outputs_staff_read on public.agent_outputs
  for select to authenticated using (public.is_staff('owner', 'operator'));

-- Column grant excludes status/reviewer_id/reviewed_at/review_note on purpose: an INSERT that
-- tries to name any of them is refused by Postgres at the column-privilege check, before RLS is
-- even evaluated, so `agent` cannot land its own output pre-approved.
grant insert (run_id, agent_id, kind, payload) on public.agent_outputs to agent;
create policy agent_outputs_agent_insert on public.agent_outputs
  for insert to agent with check (current_user = 'agent');

-- The only path that can move status. Security definer so it can write reviewer_id/reviewed_at
-- itself from auth.uid() — the ordinary way a human review gets attributed, same shape
-- place_order's `payment_recorded_by_staff` note uses — rather than trusting a client-supplied
-- reviewer. `agent` gets no EXECUTE grant: the asymmetry §9.6 asked for.
create or replace function public.review_agent_output(
  p_output_id uuid, p_decision public.agent_output_status, p_note text default null
)
returns public.agent_outputs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.staff_role := public.auth_role();
  r      public.agent_outputs;
begin
  if v_role is null or v_role not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;
  if p_decision = 'pending' then
    raise exception 'invalid_input' using errcode = 'P0001', hint = 'decision must be approved or rejected';
  end if;

  update public.agent_outputs
     set status = p_decision, reviewer_id = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_output_id and status = 'pending'
  returning * into r;

  if not found then
    raise exception 'output_not_found_or_already_reviewed' using errcode = 'P0002';
  end if;
  return r;
end;
$$;
revoke execute on function public.review_agent_output(uuid, public.agent_output_status, text) from public, anon, agent;
grant execute on function public.review_agent_output(uuid, public.agent_output_status, text) to authenticated;

-- Realtime: same reasoning as agent_tasks/agent_runs/agent_run_logs in migration 33 — C4's
-- dashboard needs a pending-approvals view to update live, and staff read it with a real per-user
-- JWT so plain postgres_changes replication is correct (no shared-anon-JWT problem here).
alter publication supabase_realtime add table public.agent_outputs;

---------------------------------------------------------------- security_audit_function_grants — extend with agent_execute
-- The live-catalog introspection the test suite's function-grants sweep depends on
-- (20260926000020_security_audit_helpers.sql) could only ever report anon/authenticated/
-- service_role execute, because `agent` did not exist when it was written. Extending its return
-- shape needs `drop function` first — `create or replace` cannot change a `returns table` column
-- list. Dropped and recreated with the identical body plus one column; no behavioural change for
-- the three roles it already reported on.
drop function public.security_audit_function_grants();
create function public.security_audit_function_grants()
returns table (
  proname                text,
  args                    text,
  is_trigger              boolean,
  prosecdef               boolean,
  search_path_pinned      boolean,
  anon_execute            boolean,
  authenticated_execute   boolean,
  service_role_execute    boolean,
  agent_execute           boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.proname::text,
    pg_get_function_identity_arguments(p.oid),
    p.prorettype = 'trigger'::regtype,
    p.prosecdef,
    exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%'),
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    has_function_privilege('service_role', p.oid, 'EXECUTE'),
    has_function_privilege('agent', p.oid, 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';
$$;
revoke all on function public.security_audit_function_grants() from public, anon, authenticated;
grant execute on function public.security_audit_function_grants() to service_role;
