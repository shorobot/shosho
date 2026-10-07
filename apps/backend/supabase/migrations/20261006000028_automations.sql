-- [S2-06] 28 — automations, automation_runs (api-contracts §7; proposal S2-03-reports-campaigns-cms.md §2)
--
-- Deciding WHEN an automation fires and actually sending anything is S5's. This delivers the
-- config table an owner/operator toggles and tunes, and the audit trail S5's runner writes to.

create type public.automation_kind as enum ('welcome', 'win_back_45d', 'birthday', 'review_after_delivery');

create table public.automations (
  id           uuid primary key default gen_random_uuid(),
  kind         public.automation_kind not null unique,
  active       boolean not null default false,
  config       jsonb not null default '{}'::jsonb,   -- {delay_hours?, message_de?, message_en?, discount?}
  last_run_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.automations is
  'One row per automation kind (unique on kind — there is exactly one "win_back_45d" config, not '
  'many). S5''s runner reads active + config and writes last_run_at; it does not create rows.';

create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references public.automations (id) on delete cascade,
  customer_id    uuid references public.customers (id) on delete set null,
  at             timestamptz not null default now(),
  outcome        text not null,         -- 'sent' | 'skipped' | 'failed' — free text, S5's vocabulary
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
comment on table public.automation_runs is
  'Audit trail only — one row per customer S5''s runner considered, whether or not it acted. '
  '`customer_id` is nullable (set null on delete) so a later GDPR anonymisation does not need to '
  'touch this table the way it touches customer_events.';

create trigger automations_set_updated_at before update on public.automations
  for each row execute function public.set_updated_at();

create index automation_runs_automation_idx on public.automation_runs (automation_id, at desc);
create index automation_runs_customer_idx   on public.automation_runs (customer_id) where customer_id is not null;

---------------------------------------------------------------- RLS
alter table public.automations     enable row level security;
alter table public.automation_runs enable row level security;

-- automations: owner/operator can see and toggle/tune every automation directly — same shape as
-- promo_codes / campaigns, no RPC needed for a config table this small.
create policy automations_staff_all on public.automations
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

-- automation_runs: staff read-only audit trail, like payment_jobs/customer_events/campaign_recipients
-- — no direct write policy. Written only by S5's service-role connection.
create policy automation_runs_staff_read on public.automation_runs
  for select to authenticated using (public.is_staff('owner', 'operator'));

revoke all on table public.automations     from anon;
revoke all on table public.automation_runs from anon;

-- Seed rows for the four kinds the design names, inactive by default — a config table with no row
-- for a kind the UI expects is a worse first-run experience than an inactive one.
insert into public.automations (kind, active, config) values
  ('welcome',               false, '{}'::jsonb),
  ('win_back_45d',          false, '{}'::jsonb),
  ('birthday',              false, '{}'::jsonb),
  ('review_after_delivery', false, '{}'::jsonb)
on conflict (kind) do nothing;
