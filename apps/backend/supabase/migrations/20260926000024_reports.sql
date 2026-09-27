-- [S2-03] 24 — Berichte: customer_stats rebuilt + four report functions (api-contracts §1.3, §6.10)
--
-- Shape: security-definer set-returning functions, not views. A `security_invoker` view would be
-- read through the caller's RLS, and `orders` RLS is per-role (kitchen sees every order, a driver
-- sees only their own) — a driver would silently get a partial revenue figure instead of an error.
-- A definer function with one explicit role gate gives every staff role the same numbers.
--
-- Access: every **active staff role** (`auth_role() is not null`), per the S2-03 boot. The Berichte
-- screen itself is owner/operator in the back-office, so nothing but the DB grant is widened here;
-- narrowing these to owner/operator later is a one-line change per gate (`is_staff('owner','operator')`).
--
-- Date range: `from_date` / `to_date` are **Europe/Berlin calendar dates, both ends inclusive**
-- (`from` and `to` are reserved words and cannot be parameter names). Defaults: the last 30 days.
-- Every function buckets `created_at` as `(created_at at time zone 'Europe/Berlin')::date`.
--
-- Money: integer cents everywhere. Percentages are numeric with 1 decimal.

---------------------------------------------------------------- customer_stats (§1.3, §6.9 row 8)
-- S0's intent: **completed orders only** — `delivered` + `picked_up`. Before this, every status but
-- `cancelled`/`refunded` counted, so a `new` order already raised "14. Bestellung" and a cancelled
-- one was invisible. `cancelled_count` is added at the end (a new column, existing consumers —
-- §6.4, the CRM list, the detail screen's n-th order — keep reading the same five).
create or replace view public.customer_stats
with (security_invoker = true)
as
select
  c.id as customer_id,
  (count(o.id) filter (where o.status in ('delivered', 'picked_up')))::integer as orders_count,
  coalesce(sum(o.total_cents) filter (where o.status in ('delivered', 'picked_up')), 0)::integer as spent_cents,
  coalesce(avg(o.total_cents) filter (where o.status in ('delivered', 'picked_up')), 0)::integer as avg_cents,
  max(o.created_at) filter (where o.status in ('delivered', 'picked_up')) as last_order_at,
  case
    when max(o.created_at) filter (where o.status in ('delivered', 'picked_up')) is null then null
    else extract(day from now() - max(o.created_at) filter (where o.status in ('delivered', 'picked_up')))::integer
  end as days_silent,
  (count(o.id) filter (where o.status = 'cancelled'))::integer as cancelled_count
from public.customers c
left join public.orders o on o.customer_id = c.id
group by c.id;

comment on view public.customer_stats is
  'api-contracts §1.3 — per customer, **completed orders only** (delivered, picked_up): '
  'orders_count, spent_cents, avg_cents, last_order_at, days_silent. cancelled_count is counted '
  'separately for the CRM PROBLEM tag; refunded orders count in neither.';

---------------------------------------------------------------- shared helper
-- One place for the report role gate, so all four read the same and a NULL role is always a denial.
create or replace function public.reports_guard()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_role() is null then
    raise exception 'forbidden_for_role' using errcode = '42501',
      detail = 'reports are readable by active staff only';
  end if;
end;
$$;
revoke execute on function public.reports_guard() from public, anon;
grant execute on function public.reports_guard() to authenticated, service_role;

---------------------------------------------------------------- report_revenue_by_day
-- One row per Berlin calendar day that has at least one order. Revenue is **completed orders
-- only** (delivered, picked_up) so the figures match what was actually served; `cancelled_count`
-- and `refunded_cents` are reported next to it so a sum row reconciles against the bank.
-- `upsell_cents` = the option half of every completed line (`line_total - unit_price * qty`) — the
-- design's ZUSATZVERKAUF tile.
create or replace function public.report_revenue_by_day(
  from_date date default ((now() at time zone 'Europe/Berlin')::date - 29),
  to_date   date default  (now() at time zone 'Europe/Berlin')::date
)
returns table (
  day                    date,
  orders_count           integer,
  revenue_cents          integer,
  delivery_revenue_cents integer,
  pickup_revenue_cents   integer,
  upsell_cents           integer,
  delivery_fee_cents     integer,
  tip_cents              integer,
  discount_cents         integer,
  vat_cents              integer,
  avg_basket_cents       integer,
  cancelled_count        integer,
  refunded_cents         integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.reports_guard();
  return query
  with
  o as (
    select ord.*,
           (ord.created_at at time zone 'Europe/Berlin')::date as day,
           ord.status in ('delivered', 'picked_up') as completed
    from public.orders ord
    where (ord.created_at at time zone 'Europe/Berlin')::date between from_date and to_date
  ),
  upsell as (
    select o.id as order_id,
           sum(greatest(i.line_total_cents - i.unit_price_cents * i.qty, 0))::integer as cents
    from o join public.order_items i on i.order_id = o.id
    where o.completed
    group by o.id
  )
  select
    o.day,
    (count(*) filter (where o.completed))::integer,
    coalesce(sum(o.total_cents)        filter (where o.completed), 0)::integer,
    coalesce(sum(o.total_cents)        filter (where o.completed and o.type = 'delivery'), 0)::integer,
    coalesce(sum(o.total_cents)        filter (where o.completed and o.type = 'pickup'), 0)::integer,
    coalesce(sum(u.cents), 0)::integer,
    coalesce(sum(o.delivery_fee_cents) filter (where o.completed), 0)::integer,
    coalesce(sum(o.tip_cents)          filter (where o.completed), 0)::integer,
    coalesce(sum(o.discount_cents)     filter (where o.completed), 0)::integer,
    coalesce(sum(o.vat_cents)          filter (where o.completed), 0)::integer,
    case when count(*) filter (where o.completed) = 0 then 0
         else (sum(o.total_cents) filter (where o.completed) / count(*) filter (where o.completed))::integer end,
    (count(*) filter (where o.status = 'cancelled'))::integer,
    coalesce(sum(o.payment_refunded_cents), 0)::integer
  from o left join upsell u on u.order_id = o.id
  group by o.day
  order by o.day;
end;
$$;
revoke execute on function public.report_revenue_by_day(date, date) from public, anon;
grant execute on function public.report_revenue_by_day(date, date) to authenticated, service_role;

---------------------------------------------------------------- report_top_items
-- Completed orders only. `revenue_cents` is the gross line revenue (item + its options, before the
-- order-level promo / pickup discount, which is not attributable to a line). `cost_cents` is
-- `menu_items.cost_cents * qty`; options have no cost in the schema, so `margin_cents` treats their
-- revenue as pure margin. Rows are keyed by `item_id`; a deleted item keeps its `order_items.name`
-- snapshot and gets a null sku / cost.
create or replace function public.report_top_items(
  from_date   date default ((now() at time zone 'Europe/Berlin')::date - 29),
  to_date     date default  (now() at time zone 'Europe/Berlin')::date,
  limit_count integer default 20
)
returns table (
  item_id       uuid,
  sku           text,
  name          text,
  name_de       text,
  qty           integer,
  orders_count  integer,
  revenue_cents integer,
  cost_cents    integer,
  margin_cents  integer,
  share_pct     numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.reports_guard();
  return query
  with
  lines as (
    select i.item_id, i.name, i.qty, i.line_total_cents, i.order_id,
           mi.sku, mi.name_de, mi.cost_cents
    from public.order_items i
    join public.orders o on o.id = i.order_id
    left join public.menu_items mi on mi.id = i.item_id
    where o.status in ('delivered', 'picked_up')
      and (o.created_at at time zone 'Europe/Berlin')::date between from_date and to_date
  ),
  total as (select nullif(sum(line_total_cents), 0) as cents from lines)
  select
    l.item_id,
    max(l.sku),
    max(l.name),
    max(l.name_de),
    sum(l.qty)::integer,
    count(distinct l.order_id)::integer,
    sum(l.line_total_cents)::integer,
    coalesce(sum(l.cost_cents * l.qty), 0)::integer,
    (sum(l.line_total_cents) - coalesce(sum(l.cost_cents * l.qty), 0))::integer,
    round(100.0 * sum(l.line_total_cents) / (select coalesce(cents, 1) from total), 1)
  from lines l
  group by l.item_id
  order by sum(l.line_total_cents) desc, sum(l.qty) desc
  limit greatest(coalesce(limit_count, 20), 1);
end;
$$;
revoke execute on function public.report_top_items(date, date, integer) from public, anon;
grant execute on function public.report_top_items(date, date, integer) to authenticated, service_role;

---------------------------------------------------------------- report_funnel
-- HONESTY (see README "Reports"): of the design's three funnel tiles only part is real today.
--   · `placed`, `paid`, `placed_to_paid_pct`  — real, straight from `orders`.
--   · `upsell_orders`, `upsell_cents`         — real, the ZUSATZVERKAUF tile.
--   · `attempts`, `attempts_with_problems`, `attempts_to_placed_pct` — real **only to the extent
--     that S3 emits `record_order_attempt` rows**. S3 does not emit any yet (S3-03), so these read
--     0 / null on staging today. They are not estimates: a zero means "nothing recorded".
--   · MENÜ → WARENKORB cannot be computed at all — it needs menu impressions / add-to-cart events,
--     which no table holds (the `site_events` proposal in S2-03's own file). Deliberately absent
--     rather than faked.
create or replace function public.report_funnel(
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
  upsell_cents            integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.reports_guard();
  return query
  with
  a as (
    select count(*)::integer as n,
           count(*) filter (where jsonb_array_length(problems) > 0)::integer as with_problems
    from public.order_attempts
    where (at at time zone 'Europe/Berlin')::date between from_date and to_date
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
  select a.n, a.with_problems, o.placed, o.paid, o.cancelled,
         case when a.n = 0 then null else round(100.0 * o.placed / a.n, 1) end,
         case when o.placed = 0 then null else round(100.0 * o.paid / o.placed, 1) end,
         up.orders_with_upsell, up.cents
  from a, o, up;
end;
$$;
revoke execute on function public.report_funnel(date, date) from public, anon;
grant execute on function public.report_funnel(date, date) to authenticated, service_role;

---------------------------------------------------------------- report_delivery_times
-- One row per delivery zone plus one row with `zone_id = null` for pickup / unzoned orders, so the
-- screen can show "Abholung" next to A/B/C. Completed orders only.
--   actual   = completed_at − coalesce(accepted_at, created_at)  (accepted → delivered)
--   promised = orders.promised_minutes as stamped when the order went to `preparing`
--   overdue  = actual > promised
create or replace function public.report_delivery_times(
  from_date date default ((now() at time zone 'Europe/Berlin')::date - 29),
  to_date   date default  (now() at time zone 'Europe/Berlin')::date
)
returns table (
  zone_id              uuid,
  zone_code            text,
  zone_name            text,
  orders_count         integer,
  avg_actual_minutes   numeric,
  avg_promised_minutes numeric,
  delta_minutes        numeric,
  overdue_count        integer,
  overdue_share_pct    numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.reports_guard();
  return query
  with
  o as (
    select ord.zone_id,
           ord.promised_minutes,
           extract(epoch from (ord.completed_at - coalesce(ord.accepted_at, ord.created_at))) / 60.0 as actual_min
    from public.orders ord
    where ord.status in ('delivered', 'picked_up')
      and ord.completed_at is not null
      and (ord.created_at at time zone 'Europe/Berlin')::date between from_date and to_date
  )
  select
    o.zone_id,
    z.code,
    z.name,
    count(*)::integer,
    round(avg(o.actual_min)::numeric, 1),
    round(avg(o.promised_minutes)::numeric, 1),
    round((avg(o.actual_min) - avg(o.promised_minutes))::numeric, 1),
    count(*) filter (where o.promised_minutes is not null and o.actual_min > o.promised_minutes)::integer,
    round(100.0 * count(*) filter (where o.promised_minutes is not null and o.actual_min > o.promised_minutes)
          / count(*), 1)
  from o left join public.delivery_zones z on z.id = o.zone_id
  group by o.zone_id, z.code, z.name
  order by z.code nulls last;
end;
$$;
revoke execute on function public.report_delivery_times(date, date) from public, anon;
grant execute on function public.report_delivery_times(date, date) to authenticated, service_role;
