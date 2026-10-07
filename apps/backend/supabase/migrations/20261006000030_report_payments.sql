-- [S2-06] 30 — report_payments (api-contracts §7; proposal S2-03-reports-campaigns-cms.md §1)
--
-- SHAPE CHOSEN: a SECURITY DEFINER function with its own inline guard, not a `security_invoker`
-- view, and the guard is narrower than the other four report_* functions' reports_guard() (any
-- active staff role) — this one is **owner/operator only**, per this boot's explicit "kitchen/
-- driver see nothing" for payment data specifically (unlike revenue/delivery-time figures, which
-- kitchen and driver already see today by S0's own earlier ruling — tests/reports.test.ts).
--
-- Why not security_invoker: `payment_events`/`payment_jobs` carry no `payment_method` of their
-- own (checked both table definitions — neither has that column), so getting it means joining
-- `orders`. But `orders` RLS lets `kitchen` read every row (`orders_kitchen_read`, unconditional)
-- — a security_invoker view running as a kitchen caller would still see every order's payment_
-- method/status through that join, defeating "kitchen/driver see nothing" even though the view
-- never touches payment_events/payment_jobs' own (correctly restrictive) RLS. A view's invoker-
-- security is only as restrictive as the WEAKEST table it reads, and `orders` is weaker here than
-- `payment_events`/`payment_jobs` are — so this function brings its own explicit gate instead of
-- relying on table RLS to compose into the right answer.
--
-- SOURCE OF TRUTH: the three core numbers (orders_count, total_cents, refunded_cents) come from
-- `orders.payment_method/payment_status/total_cents/payment_refunded_cents` directly, not from
-- `payment_jobs`/`payment_events` — and that is deliberate, not a shortcut. A cash refund settles
-- `orders.payment_refunded_cents` directly and never creates a `payment_jobs` row at all (§6.1 /
-- the S2-04 payment trust boundary); sourcing refunded_cents from the job queue would silently
-- miss every cash refund — the one payment path that can actually be exercised on staging today,
-- with no Stripe account. `orders` reflects both paths; `payment_jobs` alone would not.
-- `failed_jobs_count` is the one figure that genuinely needs the provider trail — how many capture/
-- void/refund attempts a payment_method's orders have had fail outright — and is sourced from
-- `payment_jobs` accordingly, joined back through `orders` for the date filter and method/status
-- grouping.
--
-- UNEXERCISED AGAINST REAL PROVIDER DATA: no Stripe account exists on `shosho-staging` yet
-- (api-contracts §5.6 / memory/state.md) — no `card`/`apple_pay`/`google_pay`/`paypal` row has
-- ever had a real authorization, capture or refund. This function is correct by reading, and its
-- test seeds every row by hand (as every other report's test already does) rather than through a
-- live payment — it is not, and cannot yet be, proven against a real Stripe response.
create or replace function public.report_payments(
  from_date date default ((now() at time zone 'Europe/Berlin')::date - 29),
  to_date   date default  (now() at time zone 'Europe/Berlin')::date
)
returns table (
  payment_method    public.payment_method,
  payment_status    public.payment_status,
  orders_count      integer,
  total_cents       integer,
  refunded_cents    integer,
  failed_jobs_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'operator') then
    raise exception 'forbidden_for_role' using errcode = '42501';
  end if;

  return query
  select
    o.payment_method,
    o.payment_status,
    count(*)::integer,
    coalesce(sum(o.total_cents), 0)::integer,
    coalesce(sum(o.payment_refunded_cents), 0)::integer,
    count(distinct pj.id) filter (where pj.status = 'failed')::integer
  from public.orders o
  left join public.payment_jobs pj on pj.order_id = o.id
  where (o.created_at at time zone 'Europe/Berlin')::date between from_date and to_date
  group by o.payment_method, o.payment_status
  order by o.payment_method, o.payment_status;
end;
$$;
-- Standard AUTHENTICATED_ONLY shape: ACL lets any authenticated session in (owner/operator
-- included — they must reach it), the inline guard above is what actually excludes kitchen/driver
-- (and any non-staff authenticated session) with `forbidden_for_role`. Same pattern as
-- `set_order_status` / `kitchen_pause` / every other role-gated-narrower-than-its-ACL function here.
revoke execute on function public.report_payments(date, date) from public, anon;
grant execute on function public.report_payments(date, date) to authenticated, service_role;
