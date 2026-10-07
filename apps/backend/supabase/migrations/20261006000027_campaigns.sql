-- [S2-06] 27 — campaigns, campaign_recipients (api-contracts §7; proposal S2-03-reports-campaigns-cms.md §2)
--
-- Sending itself is S5's (Claude Agent SDK / FastAPI). This migration delivers the tables only —
-- no push/email is sent by anything in this file.

create type public.campaign_channel as enum ('push', 'email', 'both');
create type public.campaign_status  as enum ('draft', 'scheduled', 'sending', 'sent', 'cancelled');
create type public.campaign_recipient_state as enum ('queued', 'sent', 'failed', 'opened');

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  channel       public.campaign_channel not null,
  segment       jsonb not null default '{}'::jsonb,
  message_de    jsonb not null default '{}'::jsonb,   -- {title, body, deep_link}
  message_en    jsonb not null default '{}'::jsonb,
  status        public.campaign_status not null default 'draft',
  scheduled_for timestamptz,
  sent_at       timestamptz,
  stats         jsonb not null default '{}'::jsonb,   -- {recipients, delivered, opened, orders, revenue_cents}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.campaigns.segment is
  'The CRM filter as saved, resolved by resolve_segment(segment) — see §7. Shape: {tags?: text[], '
  'is_company?: boolean, min_orders?: int, max_orders?: int, min_days_silent?: int, '
  'max_days_silent?: int, created_within_days?: int, customer_ids?: uuid[]}. The segment itself '
  'never encodes consent — resolve_segment enforces that unconditionally from campaigns.channel.';
comment on column public.campaigns.message_de is 'Shape: {title, body, deep_link}. message_en the same, for the EN channel copy.';

create table public.campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  state       public.campaign_recipient_state not null default 'queued',
  sent_at     timestamptz,
  opened_at   timestamptz,
  error       text,
  -- [S2-06] not in the original proposal's column list — added so claim_campaign_recipients (§7)
  -- can recover a claim a worker died holding, the same "stale claim" shape payment_jobs uses
  -- (started_at there, claimed_at here). Nothing here is about *when* a campaign fires — that is S5.
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
comment on table public.campaign_recipients is
  'One row per (campaign, customer) the campaign will or did contact. The unique constraint is '
  'what makes "never message the same customer twice for the same campaign" a schema guarantee '
  'rather than a client habit. It does NOT by itself cap contact frequency *across* different '
  'campaigns in a week — see campaign_recipients_enforce_weekly_cap() below for that half.';

create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();
create trigger campaign_recipients_set_updated_at before update on public.campaign_recipients
  for each row execute function public.set_updated_at();

create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index campaign_recipients_customer_idx on public.campaign_recipients (customer_id, created_at desc);
-- what claim_campaign_recipients (§7, migration 29) scans
create index campaign_recipients_queued_idx on public.campaign_recipients (created_at) where state = 'queued';

---------------------------------------------------------------- weekly cap (task 1)
-- THE DESIGN RULE: "max one automated action per customer per week." The unique constraint above
-- gives exactly one thing — a customer cannot appear twice *in the same campaign*. It says nothing
-- about two *different* campaigns both reaching the same customer three days apart, which is the
-- actual rule the design means. That needs to look across campaign_id values, which a per-row CHECK
-- or a two-column UNIQUE index cannot express — so it is a BEFORE INSERT trigger instead: inserting
-- a new campaign_recipients row is refused if the same customer already has a non-failed row
-- (any campaign) created in the last 7 days. `failed` is exempt — a bounced send should not spend
-- the customer's weekly slot.
--
-- This makes the cap a property of the table itself: whoever eventually writes these rows (S5's
-- orchestration — not built here) gets it for free and cannot forget to check, the same reasoning
-- that makes the unique constraint "load-bearing" rather than a habit.
create or replace function public.campaign_recipients_enforce_weekly_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.campaign_recipients
     where customer_id = new.customer_id
       and campaign_id <> new.campaign_id
       and state <> 'failed'
       and created_at > now() - interval '7 days'
  ) then
    raise exception 'weekly_cap_exceeded' using errcode = 'P0001',
      detail = format('customer %s already has a non-failed campaign contact within the last 7 days', new.customer_id);
  end if;
  return new;
end;
$$;
create trigger campaign_recipients_weekly_cap
  before insert on public.campaign_recipients
  for each row execute function public.campaign_recipients_enforce_weekly_cap();

---------------------------------------------------------------- RLS
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;

-- campaigns: a small content table, same shape as promo_codes — owner/operator CRUD directly from
-- the back-office; drafting a campaign needs no RPC. Sending (status → 'sending'/'sent') is S5's.
create policy campaigns_staff_all on public.campaigns
  for all to authenticated
  using (public.is_staff('owner', 'operator')) with check (public.is_staff('owner', 'operator'));

-- campaign_recipients: staff read-only, like payment_jobs/customer_events — no direct write policy
-- exists at all. Rows are written only by whatever (S5) calls the service-role connection, and
-- claimed only through claim_campaign_recipients (migration 29, service_role-only).
create policy campaign_recipients_staff_read on public.campaign_recipients
  for select to authenticated using (public.is_staff('owner', 'operator'));

revoke all on table public.campaigns           from anon;
revoke all on table public.campaign_recipients from anon;
