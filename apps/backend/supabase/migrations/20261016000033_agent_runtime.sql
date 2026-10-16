-- [S2-08] 33 — agent runtime schema: registry (`agents`), a claimable task queue
-- (`agent_tasks`), one run row per invocation (`agent_runs`), ordered log lines
-- (`agent_run_logs`). D-020's automation layer; api-contracts §8.8. Schema and contract only —
-- nothing in `apps/automation` exists yet (plan.md C1); S5's orchestrator (C3) and S4's
-- dashboards (C4) both block on this and build against the contract this file's comments plus
-- §8.8 describe, not against guesses.
--
-- This is deliberately NOT automations/automation_runs (migration 28). That pair is the
-- marketing half — four fixed `automation_kind` values, one row per customer considered. D-020's
-- agents (Sales, Accounting, Warehouse, Grow, Quality) are wider: most runs are not about a
-- customer at all, and the agent set grows over time rather than being a fixed enum of four
-- message kinds — so `agents.key` below is `text`, not an enum, on purpose. See §8.8's "marketing
-- runner" ruling for why automations/automation_runs stay exactly as they are rather than being
-- folded into this.

---------------------------------------------------------------- agents (registry)
create table public.agents (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,                 -- 'sales' | 'accounting' | 'warehouse' | 'grow' | 'quality' — free text, see header
  active      boolean not null default false,
  config      jsonb not null default '{}'::jsonb,    -- agent-specific tuning; S5's vocabulary, not specified here
  last_run_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.agents is
  'One row per agent (D-020: sales, accounting, warehouse, grow, quality — seeded inactive, same '
  'reasoning automations gives for seeding its four kinds: a config screen with no row for a kind '
  'the UI expects is a worse first-run experience than an inactive one). `key` is text, not an '
  'enum: unlike automation_kind this set is expected to grow. S5''s orchestrator reads '
  'active+config and writes last_run_at; it does not create rows.';

create trigger agents_set_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

---------------------------------------------------------------- agent_tasks (claimable queue)
create type public.agent_task_status as enum ('queued', 'processing', 'done', 'failed');

create table public.agent_tasks (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents (id),              -- no ON DELETE: a registry row is not expected to be removed while tasks reference it
  customer_id uuid references public.customers (id) on delete set null, -- nullable: most agents (accounting, warehouse) are not about a customer at all
  payload     jsonb not null default '{}'::jsonb,    -- what to do; S5's vocabulary per agent
  status      public.agent_task_status not null default 'queued',
  attempts    integer not null default 0,
  last_error  text,
  started_at  timestamptz,       -- set by claim_agent_tasks; the stale-reclaim clock
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.agent_tasks is
  'The claimable queue. One row per unit of work an agent will attempt — not per customer and not '
  'per run: a task retried after failure keeps its row (attempts increments) but gets a new '
  '`agent_runs` row per attempt. `customer_id` is nullable, on delete set null — same reasoning '
  'automation_runs.customer_id gives: a GDPR anonymisation never needs to touch this table.';

create index agent_tasks_queue_idx on public.agent_tasks (status, created_at) where status in ('queued', 'processing');
create index agent_tasks_agent_idx on public.agent_tasks (agent_id, created_at desc);
create index agent_tasks_customer_idx on public.agent_tasks (customer_id) where customer_id is not null;
create trigger agent_tasks_set_updated_at before update on public.agent_tasks
  for each row execute function public.set_updated_at();

---------------------------------------------------------------- agent_runs (one row per invocation)
create table public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references public.agent_tasks (id) on delete set null, -- nullable so the run audit survives even if the task row is ever removed
  agent_id      uuid not null references public.agents (id),
  customer_id   uuid references public.customers (id) on delete set null,   -- denormalised from the task at claim time; same GDPR nullability
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  conclusion    text,          -- free text, S5's vocabulary (same choice as automation_runs.outcome) — null while running
  error         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12, 6),
  result        jsonb,
  created_at    timestamptz not null default now()
);
comment on table public.agent_runs is
  'One row per agent invocation — not per customer (contrast automation_runs). Answers which '
  'agent, start, end, conclusion, failure and cost (D-020: an agent that loops spends real money '
  'against the owner''s Anthropic account, with no rate limiter in front — this table is what '
  'makes a runaway visible in the dashboard and in a report; a spend CEILING is not built here, '
  'that is S7''s call at plan.md C2). `conclusion` is free text, not an enum, for the same reason '
  'automation_runs.outcome is: S5 owns the vocabulary, not this migration. `customer_id` carries '
  'the same nullable / on-delete-set-null GDPR shape as agent_tasks and automation_runs — see '
  'agent_tasks'' comment. NOT carried here: redacting customer PII that may appear inside `result` '
  'or a log line''s free-text `message` (model prompts/outputs). That content is unbounded free '
  'text; scrubbing it safely without destroying the audit trail is not attempted in this boot.';

create index agent_runs_task_idx on public.agent_runs (task_id);
create index agent_runs_agent_idx on public.agent_runs (agent_id, started_at desc);
create index agent_runs_customer_idx on public.agent_runs (customer_id) where customer_id is not null;
create index agent_runs_open_idx on public.agent_runs (agent_id) where finished_at is null;

---------------------------------------------------------------- agent_run_logs (ordered log lines)
create table public.agent_run_logs (
  id      uuid primary key default gen_random_uuid(),
  run_id  uuid not null references public.agent_runs (id) on delete cascade,
  seq     bigserial,            -- global monotonic sequence — stable ordering even when two lines share a millisecond
  at      timestamptz not null default now(),
  level   text not null default 'info',   -- free text (info/warn/error expected), S5's vocabulary
  message text not null
);
comment on table public.agent_run_logs is
  'Log lines attached to a run, ordered by `seq` (a bigserial, not `at`, because concurrent '
  'writers can share a millisecond). Readable as they arrive via the realtime publication below. '
  'May contain model prompts/outputs — see agent_runs'' comment on what is and is not scrubbed for '
  'GDPR.';

create index agent_run_logs_run_idx on public.agent_run_logs (run_id, seq);

---------------------------------------------------------------- RLS
alter table public.agents         enable row level security;
alter table public.agent_tasks    enable row level security;
alter table public.agent_runs     enable row level security;
alter table public.agent_run_logs enable row level security;

-- agents: owner/operator CRUD directly, same shape as automations_staff_all — a registry this
-- small needs no RPC to toggle active or tune config.
create policy agents_staff_all on public.agents
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

-- agent_tasks / agent_runs / agent_run_logs: owner/operator READ-ONLY audit, same shape as
-- automation_runs/campaign_recipients/payment_jobs — no insert/update/delete policy for anyone;
-- written only by the orchestrator's service-role connection (not built here). Model prompts and
-- outputs can carry customer data and operational detail, so kitchen and driver get nothing:
-- is_staff('owner','operator') is the only predicate — never the unconditional role-only shape
-- S7-02 found on `orders_kitchen_read` ("every order, for all time"), and the grant is revoked
-- from `anon` outright below rather than left to RLS alone, closing the other S7-02 finding
-- (`settings.draft`: a row policy alone is not enough when a column grant can leak around it —
-- not this schema's shape, since there is no anon-reachable surface on these tables at all, but
-- the belt-and-braces revoke costs nothing and matches `order_attempts`/`banners`).
create policy agent_tasks_staff_read on public.agent_tasks
  for select to authenticated using (public.is_staff('owner', 'operator'));
create policy agent_runs_staff_read on public.agent_runs
  for select to authenticated using (public.is_staff('owner', 'operator'));
create policy agent_run_logs_staff_read on public.agent_run_logs
  for select to authenticated using (public.is_staff('owner', 'operator'));

revoke all on table public.agents         from anon;
revoke all on table public.agent_tasks    from anon;
revoke all on table public.agent_runs     from anon;
revoke all on table public.agent_run_logs from anon;

---------------------------------------------------------------- claim_agent_tasks (service role only)
-- Locking mechanism reused as-is from claim_campaign_recipients / claim_payment_jobs: `for update
-- skip locked` so concurrent pollers never claim the same row, plus a stale-claim timeout so a
-- worker that died mid-task does not strand it forever. The STATUS SHAPE deliberately diverges
-- from claim_campaign_recipients (which has no `processing` state — a recipient stays `queued`
-- through a claim because its real outcome is set later by the send) and instead follows
-- claim_payment_jobs (status enum with a `processing` state + a started_at clock): an agent task
-- can run for a while — an LLM call, not a queue hop — and the dashboard needs "in flight" visibly
-- distinct from "waiting", which campaign_recipients' claimed_at-only shape cannot express.
--
-- Claiming a task IS starting its run: both happen in the one transaction, so there is no gap
-- between "claimed" and "has a run row to log against". Returns the run, not the task, so the
-- caller gets everything it needs — run_id to log/finish against, the task's own payload to act
-- on — in one round trip.
create or replace function public.claim_agent_tasks(p_limit integer default 10)
returns table (
  run_id      uuid,
  task_id     uuid,
  agent_id    uuid,
  customer_id uuid,
  payload     jsonb,
  attempts    integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_run_id uuid;
begin
  for v_task in
    with picked as (
      select id from public.agent_tasks
       where status = 'queued'
          or (status = 'processing' and started_at < now() - interval '10 minutes')
       order by created_at
       limit greatest(coalesce(p_limit, 10), 1)
       for update skip locked
    )
    update public.agent_tasks t
       set status = 'processing', attempts = t.attempts + 1, started_at = now()
      from picked
     where t.id = picked.id
    returning t.*
  loop
    insert into public.agent_runs (task_id, agent_id, customer_id)
    values (v_task.id, v_task.agent_id, v_task.customer_id)
    returning id into v_run_id;

    run_id := v_run_id;
    task_id := v_task.id;
    agent_id := v_task.agent_id;
    customer_id := v_task.customer_id;
    payload := v_task.payload;
    attempts := v_task.attempts;
    return next;
  end loop;
end;
$$;
revoke execute on function public.claim_agent_tasks(integer) from public, anon, authenticated;
grant execute on function public.claim_agent_tasks(integer) to service_role;

---------------------------------------------------------------- finish_agent_run (service role only)
-- Closes a run and reconciles its task, mirroring finish_payment_job's retry shape: failure with
-- attempts < 5 requeues the task (back to `queued`); attempts >= 5 or an explicit p_final marks it
-- `failed` for a human. Success marks the task `done`. Cost is written in the same statement as
-- the conclusion, not appended separately, so a run's outcome and its cost always land together.
create or replace function public.finish_agent_run(
  p_run_id        uuid,
  p_ok            boolean,
  p_conclusion    text default null,
  p_error         text default null,
  p_input_tokens  integer default null,
  p_output_tokens integer default null,
  p_cost_usd      numeric default null,
  p_result        jsonb default null,
  p_final         boolean default false
)
returns public.agent_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.agent_runs;
begin
  update public.agent_runs
     set finished_at   = now(),
         conclusion     = coalesce(p_conclusion, case when p_ok then 'success' else 'failure' end),
         error          = case when p_ok then null else left(p_error, 2000) end,
         input_tokens   = p_input_tokens,
         output_tokens  = p_output_tokens,
         cost_usd       = p_cost_usd,
         result         = coalesce(p_result, result)
   where id = p_run_id
  returning * into r;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0002';
  end if;

  if r.task_id is not null then
    update public.agent_tasks
       set status = case
                       when p_ok then 'done'::public.agent_task_status
                       when p_final or attempts >= 5 then 'failed'::public.agent_task_status
                       else 'queued'::public.agent_task_status
                     end,
           last_error = case when p_ok then null else left(p_error, 2000) end
     where id = r.task_id;
  end if;

  return r;
end;
$$;
revoke execute on function public.finish_agent_run(uuid, boolean, text, text, integer, integer, numeric, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.finish_agent_run(uuid, boolean, text, text, integer, integer, numeric, jsonb, boolean) to service_role;

---------------------------------------------------------------- realtime
-- S4's agent dashboards (C4) are Next.js + Supabase Realtime, reading these as a staff session
-- with a real per-user JWT — is_staff() RLS applies exactly as it does to orders/order_items/
-- order_events/customer_events (migrations 5, 13), so plain `postgres_changes` table replication
-- is correct here. Contrast guest order tracking (migration 16): broadcast-from-DB exists only
-- because the anon JWT is shared across every guest and RLS cannot be scoped to one tracking
-- token — neither limitation applies to a logged-in staff session, so there is no reason to reach
-- for broadcast here.
--
-- Added: agent_tasks (queue + status), agent_runs (status/conclusion/cost), agent_run_logs (log
-- lines, "readable as they arrive" per the boot) — the three surfaces the dashboard watches live.
-- Deliberately NOT added: `agents` (the registry). It mutates rarely — toggling active, editing
-- config — and, like automations and campaigns (neither of which is in this publication either),
-- a refetch after save is enough; there is no existing precedent in this repo for replicating a
-- config table and this boot sees no reason to start one.
alter publication supabase_realtime add table public.agent_tasks, public.agent_runs, public.agent_run_logs;

---------------------------------------------------------------- seed (D-020's five planned agents, inactive)
insert into public.agents (key, active, config) values
  ('sales',      false, '{}'::jsonb),
  ('accounting', false, '{}'::jsonb),
  ('warehouse',  false, '{}'::jsonb),
  ('grow',       false, '{}'::jsonb),
  ('quality',    false, '{}'::jsonb)
on conflict (key) do nothing;
