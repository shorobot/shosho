-- [S2-06] 32 — settings.draft, site_publications, publish_site(); the report_funnel window fix
--             (api-contracts §7 / §6.10; proposal S2-03-reports-campaigns-cms.md §3; task 8)

---------------------------------------------------------------- A. settings.draft (task 7)
alter table public.settings add column draft jsonb;
comment on column public.settings.draft is
  'A complete candidate replacement for `value` (not a partial patch — unlike banners.draft, which '
  'merges). publish_site() copies draft → value and clears draft. Must never reach `anon` — see the '
  'column-level grant narrowing immediately below; settings_public_read''s ROW policy alone does not '
  'hide this COLUMN from a publicly-readable row.';

-- [S2-06] THE PITFALL THIS BOOT NAMED EXPLICITLY: RLS is row-level, not column-level. The existing
-- `settings_public_read` policy admits `anon` to the business/opening_hours/site/payments.enabled/
-- kitchen.status ROWS — adding a plain `draft` column to the same table would, with no further
-- change, hand `anon` every pending unpublished edit on those same rows (`select *` returns every
-- column RLS lets the ROW through for, regardless of which columns are "meant" to be public).
-- Postgres column-level privileges are the correct, standard tool for narrowing WITHIN an
-- RLS-admitted row — PostgREST reads them from information_schema and will not expose a column a
-- role lacks SELECT on. This revokes the default blanket table grant from `anon` and re-grants
-- exactly the columns anon could already see before this migration — `draft` is pointedly absent.
-- `authenticated` keeps its existing (unchanged) table-level grant, so owner/operator continue to
-- see `draft` on the rows their existing ROW policies already admit them to.
revoke all on table public.settings from anon;
grant select (key, value, created_at, updated_at) on public.settings to anon;

---------------------------------------------------------------- B. site_publications
create table public.site_publications (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  actor_id   uuid references public.staff (id) on delete set null,
  summary    jsonb not null default '{}'::jsonb,   -- {settings_keys: text[], banner_ids: uuid[]}
  snapshot   jsonb not null default '{}'::jsonb     -- {settings: {key: {from, to}}, banners: [{id, from, to}]}
);
comment on table public.site_publications is
  'One row per publish_site() call — the CMS "unpublished changes" counter''s history. Written only '
  'by publish_site(); staff read-only, same shape as payment_events/customer_events.';

alter table public.site_publications enable row level security;
create policy site_publications_staff_read on public.site_publications
  for select to authenticated using (public.is_staff('owner', 'operator'));
revoke all on table public.site_publications from anon;

---------------------------------------------------------------- C. publish_site()
-- Owner only (per this boot's task 7), additive, no existing signature touched. Copies every
-- pending `settings.draft` straight to `value` (a settings draft is a full replacement value, see
-- the column comment above) and merges every pending `banners.draft` onto its row's live columns
-- (a banners draft is a partial patch — a key absent or JSON null keeps the current value), clears
-- both, and logs exactly what changed, snapshotted BEFORE the update, into site_publications.
create or replace function public.publish_site()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings_keys jsonb;
  v_banner_ids    jsonb;
  v_snapshot      jsonb;
  v_pub_id        uuid;
begin
  if public.auth_role() is null or public.auth_role() <> 'owner' then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(key), '[]'::jsonb) into v_settings_keys
    from public.settings where draft is not null;
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_banner_ids
    from public.banners where draft is not null;

  -- snapshot BEFORE either update runs, so site_publications records what actually changed
  select jsonb_build_object(
    'settings', (select coalesce(jsonb_object_agg(key, jsonb_build_object('from', value, 'to', draft)), '{}'::jsonb)
                   from public.settings where draft is not null),
    'banners',  (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', to_jsonb(b) - 'draft', 'to', draft)), '[]'::jsonb)
                   from public.banners b where draft is not null)
  ) into v_snapshot;

  update public.settings set value = draft, draft = null where draft is not null;

  update public.banners
     set slot         = coalesce((draft->>'slot')::public.banner_slot, slot),
         image_path   = coalesce(draft->>'image_path', image_path),
         title_de     = coalesce(draft->>'title_de', title_de),
         title_en     = coalesce(draft->>'title_en', title_en),
         subtitle_de  = coalesce(draft->>'subtitle_de', subtitle_de),
         subtitle_en  = coalesce(draft->>'subtitle_en', subtitle_en),
         cta_label_de = coalesce(draft->>'cta_label_de', cta_label_de),
         cta_label_en = coalesce(draft->>'cta_label_en', cta_label_en),
         cta_href     = coalesce(draft->>'cta_href', cta_href),
         valid_from   = coalesce((draft->>'valid_from')::timestamptz, valid_from),
         valid_to     = coalesce((draft->>'valid_to')::timestamptz, valid_to),
         sort         = coalesce((draft->>'sort')::integer, sort),
         active       = coalesce((draft->>'active')::boolean, active),
         draft        = null
   where draft is not null;

  insert into public.site_publications (actor_id, summary, snapshot)
  values (auth.uid(), jsonb_build_object('settings_keys', v_settings_keys, 'banner_ids', v_banner_ids), v_snapshot)
  returning id into v_pub_id;

  return jsonb_build_object('id', v_pub_id, 'settings_keys', v_settings_keys, 'banner_ids', v_banner_ids);
end;
$$;
revoke execute on function public.publish_site() from public, anon;
grant execute on function public.publish_site() to authenticated, service_role;

---------------------------------------------------------------- D. report_funnel: the window fix (task 8)
-- THE DEFECT (S3-02 found attempts_to_placed_pct: 200.0). `order_attempts` exists only from
-- migration 23 (2026-09-26); `orders` goes back to S2-01 (2026-09-20). The old function compared
-- `count(orders in [from,to])` against `count(order_attempts in [from,to])` using the SAME window
-- for both — correct SQL, wrong meaning whenever that window reaches before recording began:
-- every pre-recording order is real and placed, but no attempt row could possibly exist for it, so
-- the ratio is comparing two populations measured over spans of different actual length. That is
-- not an arithmetic bug and clamping with `greatest(0, …)` or similar would not fix it — the fix is
-- to stop blending a sub-window where recording did not exist yet into a ratio that claims to
-- cover the whole requested range.
--
-- FIX: compute attempts_to_placed_pct only over the SUB-window where order_attempts has actually
-- been live — `[greatest(from_date, earliest order_attempts date), to_date]` — and report that
-- sub-window back explicitly (`attempts_window_from/_to`) so a caller never has to guess whether a
-- figure is comparable to what it asked for. `placed`/`paid`/`cancelled`/upsell are unaffected:
-- they are pure `orders` queries, honest over the full requested range on their own, and stay that
-- way — only the attempts-dependent figures move. When the ENTIRE requested range predates
-- recording (no overlap at all), attempts/attempts_with_problems/attempts_to_placed_pct and both
-- window columns come back null — "not yet measurable", never a number that looks plausible and
-- is not. A genuinely >100 ratio over a fully-comparable window is not suppressed: the two counts
-- are independent populations (order_attempts records only rejected/abandoned checkouts, per §1.7
-- — it is not "total checkout starts") and a store with far more successes than failures would
-- honestly produce one; what this fixes is the window mismatch, not the arithmetic.
--
-- Signature is unchanged (from_date date, to_date date) — only the RETURNS TABLE shape grows by
-- two columns, which Postgres does not allow via CREATE OR REPLACE (`cannot change return type of
-- existing function`), hence the explicit DROP first.
drop function if exists public.report_funnel(date, date);

create function public.report_funnel(
  from_date date default ((now() at time zone 'Europe/Berlin')::date - 29),
  to_date   date default  (now() at time zone 'Europe/Berlin')::date
)
returns table (
  attempts                integer,
  attempts_with_problems  integer,
  placed                  integer,
  paid                    integer,
  cancelled               integer,
  attempts_to_placed_pct  numeric,
  placed_to_paid_pct      numeric,
  upsell_orders           integer,
  upsell_cents            integer,
  attempts_window_from    date,   -- [S2-06] the sub-window attempts_to_placed_pct actually covers;
  attempts_window_to      date    -- null/null when no part of [from_date, to_date] is comparable.
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_earliest date;    -- earliest order_attempts.at, Europe/Berlin calendar date; null if the table is empty
  v_win_from date;     -- effective lower bound for the attempts-comparable sub-window, or null if none
begin
  perform public.reports_guard();

  select min((at at time zone 'Europe/Berlin')::date) into v_earliest from public.order_attempts;
  v_win_from := case when v_earliest is null then null else greatest(from_date, v_earliest) end;
  if v_win_from is null or v_win_from > to_date then
    v_win_from := null;
  end if;

  return query
  with
  a as (
    select count(*)::integer as n,
           count(*) filter (where jsonb_array_length(problems) > 0)::integer as with_problems
    from public.order_attempts
    where v_win_from is not null
      and (at at time zone 'Europe/Berlin')::date between v_win_from and to_date
  ),
  placed_in_window as (
    -- same sub-window as `a`, so the ratio compares two counts measured over the same span —
    -- deliberately separate from `o.placed` below, which stays honest over the full requested range.
    select count(*)::integer as n
    from public.orders
    where v_win_from is not null
      and (created_at at time zone 'Europe/Berlin')::date between v_win_from and to_date
  ),
  o as (
    select count(*)::integer as placed,
           count(*) filter (where payment_status = 'paid')::integer as paid,
           count(*) filter (where status = 'cancelled')::integer as cancelled
    from public.orders
    where (created_at at time zone 'Europe/Berlin')::date between from_date and to_date
  ),
  up as (
    select count(distinct ord.id)::integer as orders_with_upsell,
           coalesce(sum(greatest(i.line_total_cents - i.unit_price_cents * i.qty, 0)), 0)::integer as cents
    from public.orders ord
    join public.order_items i on i.order_id = ord.id
    where ord.status in ('delivered', 'picked_up')
      and (ord.created_at at time zone 'Europe/Berlin')::date between from_date and to_date
      and i.line_total_cents > i.unit_price_cents * i.qty
  )
  select
    case when v_win_from is null then null else a.n end,
    case when v_win_from is null then null else a.with_problems end,
    o.placed, o.paid, o.cancelled,
    case when v_win_from is null or a.n = 0 then null else round(100.0 * pw.n / a.n, 1) end,
    case when o.placed = 0 then null else round(100.0 * o.paid / o.placed, 1) end,
    up.orders_with_upsell, up.cents,
    v_win_from, case when v_win_from is null then null else to_date end
  from a, o, up, placed_in_window pw;
end;
$$;
revoke execute on function public.report_funnel(date, date) from public, anon;
grant execute on function public.report_funnel(date, date) to authenticated, service_role;
