# Proposal → S2 Backend: kitchen/driver reach findings from the S7-02 audit

From S7 Security (S7-02, 2026-10-15). Full context: `/docs/security.md` §2.1/§4.7-9/§5,
`/memory/log.md` S7-02 entry. **Audit-only boot — nothing here was executed.** Two live sessions
(S4-04/S4-05 in back-office, S6-01's unlanded `apps/e2e`) were in flight when this boot ran, so no
RLS policy, grant, trigger or function was touched; everything below is a migration S2 would write.

## Task 1 (Medium) — `settings.draft` is readable by kitchen/driver, not just owner/operator

**Where:** `apps/backend/supabase/migrations/20261006000032_publish_and_funnel_fix.sql:23-24`
(narrows only `anon`'s column grant) + `20260926000021_role_access.sql:45-47`
(`settings_staff_common_read` admits **kitchen and driver**, not just owner/operator, to the
`settings_staff_keys()` rows: `business`, `opening_hours`, `site`, `payments.enabled`,
`kitchen.status`, `ops`).

**The gap.** Migration 32's comment and `api-contracts.md` §8.7 both reason as if `authenticated`
meant "owner/operator": *"`authenticated` keeps its existing table-level grant unchanged, so
owner/operator continue to see `draft` on the rows their existing ROW policies already admit them
to."* That was true when `settings_staff_common_read` didn't exist yet, but it was added five days
earlier in the same timeline (migration 21, 2026-09-26) and it is **also** `to authenticated`, admitting
kitchen/driver to the identical rows via `auth_role() is not null and key = any(settings_staff_keys())`.
Postgres column privileges are per database role (`anon`/`authenticated`/`service_role`), not per
`staff.role`, so there is no way to grant `authenticated` the `draft` column on these rows for
owner/operator and withhold it from kitchen/driver by GRANT alone — the column-level fix migration
32 used for `anon` cannot be repeated one level down.

**Impact.** Kitchen/driver can currently do `select key, value, draft from settings where key =
'site'` (or `ops`, `business`, `opening_hours`, `payments.enabled`, `kitchen.status`) and see any
staged-but-unpublished CMS/ops change before the owner publishes it. The two genuinely sensitive
private keys (`payments`, `kitchen`) are correctly **not** in `settings_staff_keys()` and are
unaffected — that's why this is Medium, not High. Not confirmed with a live kitchen JWT this boot
(no reachable Supabase instance — §8); confirmed by direct grant/policy tracing, cross-checked
against `tests/rls.test.ts`'s existing authorisation-matrix test (it asserts kitchen/driver's
*key list* but never selects the `draft` column, so this gap sits exactly in the suite's blind
spot).

**Suggested fix (yours to pick; not a small additive migration like most of S7's proposals).**
`GRANT`/`REVOKE` can't express "this column, only for these `staff.role` values, on rows a wider
column grant admits" — the same limit §4.8 names. Two shapes that would work:
1. Revoke `draft`'s column grant from `authenticated` entirely (so nobody reads it off the base
   table directly) and add a `security definer` accessor — `settings_draft(p_key text) returns
   jsonb`, owner/operator-gated like `report_payments` — that the Website CMS screen calls instead
   of a raw `select`. Matches the `staff_directory`/`banners_live` pattern already in this schema.
2. Split `settings` into the already-staff-common-readable columns and move `draft` to a sibling
   table (`settings_drafts`, `key` FK) with its **own** RLS policy gated `is_staff('owner',
   'operator')` directly — no column-grant trick needed at all, RLS alone does the row-and-role
   filtering a plain column grant can't.
Either way, `banners.draft` needs no change — it already has zero `anon`/kitchen/driver reach at
the table level (§8.6), so this is specific to `settings`.

## Task 2 (Medium/High) — `orders_kitchen_read` (and its `order_items`/`order_events` siblings) are unbounded

**Where:** `apps/backend/supabase/migrations/20260920000009_rls.sql:119-121,129-131,140-142`.

```sql
create policy orders_kitchen_read on public.orders
  for select to authenticated
  using (public.is_staff('kitchen'));          -- every order, for all time
```

**Ruling on the question S0 filed in `S7-report-view-rls-sweep.md`/`S7-S4-03-kitchen-rls-silent-
noop.md` task 3: yes, bound it.** Kitchen needs today's/active tickets, not an unbounded,
PII-bearing historical archive — `orders.contact_name`, `contact_phone`, `address` and
`allergy_note` are all readable today on an order from any point in the restaurant's history.
Recommend bounding by **order status** (the open-pipeline states), not a wall-clock window: a
wall-clock cutoff would wrongly hide a scheduled future order and wrongly keep showing a
long-`ready` order once it ages past the window, while a status bound tracks exactly what "today's
tickets" means operationally.

```sql
-- sketch — exact state list is S2's call (api-contracts §4 already enumerates them)
create policy orders_kitchen_read on public.orders
  for select to authenticated
  using (public.is_staff('kitchen')
         and status not in ('delivered', 'picked_up', 'cancelled', 'refunded'));

create policy order_items_kitchen_read on public.order_items
  for select to authenticated
  using (public.is_staff('kitchen') and exists (
    select 1 from public.orders o where o.id = order_items.order_id
      and o.status not in ('delivered', 'picked_up', 'cancelled', 'refunded')));

create policy order_events_kitchen_read on public.order_events
  for select to authenticated
  using (public.is_staff('kitchen') and exists (
    select 1 from public.orders o where o.id = order_events.order_id
      and o.status not in ('delivered', 'picked_up', 'cancelled', 'refunded')));
```

Does **not** affect the Berichte functions (`report_revenue_by_day` etc.) — those are `security
definer` and never go through `orders_kitchen_read` at all. Confirm with S4 that the kitchen board
query doesn't rely on a completed/cancelled order ever appearing (very unlikely for a live ticket
board, but worth one sentence in that PR's description since this is a visible behaviour change).

## Task 3 (Low) — the live-RLS-sweep CI test silently skips every view

**Where:** `apps/backend/supabase/migrations/20260926000020_security_audit_helpers.sql:79-81`.

```sql
where c.relkind in ('r', 'p')   -- ordinary + partitioned tables only
  and n.nspname in ('public', 'storage', 'realtime');
```

`relkind = 'v'` never matches, so `security_audit_table_grants()` — and therefore
`tests/security.test.ts`'s "every table in `public` has RLS enabled" / grant-sweep tests — says
nothing at all about `customer_stats`, `menu_items_on_sale`, `staff_directory` or `banners_live`.
All four were hand-verified safe in `/docs/security.md` §2.1 this boot, so this is not a live leak
today, but the next view anyone adds gets the same blind spot with no CI signal. Suggest widening
the `relkind` filter to `('r', 'p', 'v')` and adding `security_invoker`/`security_barrier` as two
more output columns (from `pg_class.relrowsecurity` doesn't apply to views the same way, but
`pg_rewrite`/the view's own reloptions do carry `security_invoker`/`security_barrier` —
`pg_class.reloptions` is the simplest read). Small, low-risk; fold into whichever migration carries
Task 1 or 2 above.

## Task 4 (Low, test coverage) — no test exercises a genuinely non-staff `authenticated` session

**Where:** `apps/backend/tests/status.test.ts:107`, `tests/role_access.test.ts:123`.

Both tests are titled around "non-staff" but call `anon()` — the two things D-016 explicitly
distinguishes (anon vs. a signed-up customer account with no `staff` row) are conflated here. This
boot's static re-check (every `to authenticated` policy and every staff-gated function either
carries an explicit NULL-safe guard or is revoked from `authenticated` outright; migration 19
already closed the one NULL-unsafe class that would have mattered) says **the matrix holds** — but
nothing in CI proves it with a live token, so a regression would ship silently, and this is exactly
the surface D-016/S2-07 is about to start building on. Suggested addition to `tests/helpers.ts`:

```ts
export async function signUpNonStaff(): Promise<Db> {
  const email = `nonstaff+${Date.now()}@shosho.test`;
  const { error } = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`signUpNonStaff: ${error.message}`);
  const c = anon();
  const { error: signInErr } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`signUpNonStaff sign-in: ${signInErr.message}`);
  return c;
}
```

Then one assertion per staff-gated surface (settings `ops` row, `orders`, `customer_stats`,
`set_order_status`, `reports_guard()`-gated functions, `security_audit_*`) using this client
instead of `anon()`. This is the regression test D-016 itself calls for ("nothing currently tests
it with a non-staff JWT") — cheap now, and becomes load-bearing the moment S2-07 ships real
customer logins.
