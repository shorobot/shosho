# Proposal → S7 Security: sweep for the `security_invoker`-view-over-loose-RLS pattern

Filed by S0 2026-10-07, out of S2-06's review. Not a boot; S0 schedules it.

## The pattern
A `security_invoker` view runs with the **caller's** RLS on every table it joins, so such a view is only
as tight as the **loosest** policy among its joins — regardless of how correct the policies on the view's
"main" table are.

## The concrete instance, which was caught before shipping
S0's S2-06 boot specified `report_payments` as a `security_invoker` view "like your other reports". S2
declined and built it as a function with an owner/operator guard instead. S0 verified the reasoning rather
than taking it: `apps/backend/supabase/migrations/20260920000009_rls.sql:119` —

```sql
create policy orders_kitchen_read on public.orders
  for select to authenticated
  using (public.is_staff('kitchen'));          -- no row restriction at all
```

Kitchen can read **every** order row. (Contrast `orders_driver_read` on line 122, correctly scoped with
`driver_id = auth.uid()`.) A `security_invoker` view joining `orders` would therefore have exposed every
order's payment data to a kitchen login, no matter how right `payment_events` / `payment_jobs` RLS is.
S2 was right and S0's instruction would have created the leak.

## Why this is worth a sweep rather than a one-line fix
The instance is fixed. The question is whether the same shape already exists in the four report functions
shipped in S2-03 (`report_revenue_by_day`, `report_top_items`, `report_delivery_times`, `report_funnel`)
or anywhere else that joins `orders`, `order_items` or `customers` — and whether `reports_guard()` is
doing the work that was assumed of it in each case. S2 extended `security.test.ts`'s allow-lists in
S2-06, which is the right place for the regression, but a deliberate pass by the session that owns the
authorisation matrix is the thing that would say "checked" rather than "probably fine".

## Suggested scope
1. Enumerate every view and `security_invoker` object and the tables each joins; for each join, name the
   loosest policy that applies and whether it bounds rows or only roles.
2. Spot-check with a real **kitchen** and **driver** JWT, not by inspection — kitchen is the interesting
   role precisely because its order policy is role-only.
3. Say whether `orders_kitchen_read` should itself be bounded (e.g. to open/active orders) rather than
   every order for all time. That is a schema change and S2's to make, but the judgement is S7's.
4. Fold the rule into `/docs/security.md` §5 so the next report is specified correctly the first time.

Nothing here is urgent: the one known instance never shipped.
