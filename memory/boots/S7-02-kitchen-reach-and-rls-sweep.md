# BOOT: S7-02 (Security) — how far does `kitchen` actually reach, and does the matrix hold for a non-staff login?

## Role
You are session S7 (Security) of SHOSHO, idle since S7-01 merged on 2026-09-27. Two findings have been filed to you in the meantime and they turn out to be the **same underlying question**: what can a `kitchen` login actually see and do, and is the authorisation matrix enforced by the database or only by the app? Plus one forward-looking check that is cheap now and expensive later. **This boot audits and proposes; it changes no policy.**

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** `git fetch origin && git worktree add .worktrees/s7 -b s7-02 origin/main` from the root checkout if `.worktrees/s7` does not already exist, else `cd .worktrees/s7 && git fetch origin && git checkout -b s7-02 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s7-02` → `main`.
Read FIRST: `/memory/state.md`, `/memory/decisions.md` — **D-012** (findings route straight to you; that is why these two are waiting), **D-016**/**D-017** (customer accounts are coming, which is what task 3 is about), then:
1. `/memory/boots/proposed/S7-report-view-rls-sweep.md`
2. `/memory/boots/proposed/S7-S4-03-kitchen-rls-silent-noop.md`
3. `/docs/security.md` — your own file from S7-01, and the place any conclusion belongs.
4. Your S7-01 log entry, for the `security_audit_policies` / `security_audit_table_grants` / `security_audit_function_grants` helpers you built. They are the instrument for this boot.

**⚠️ Two sessions are live and this boot must not disturb either.** S4-04 is building `/website` and `/marketing` in `apps/backoffice`; S6-01 has an unlanded e2e suite in `apps/e2e` whose specs include an auth-matrix spot-check. So: **do not change any RLS policy, grant, or function in this boot.** Audit, conclude, propose. If you find something that must be fixed immediately, say so to S0 with the measurement and stop — do not fix it under two running sessions.

## The two findings, and why they are one question
Both come from the same place: **`orders_kitchen_read` is role-only with no row restriction.**
```sql
-- apps/backend/supabase/migrations/20260920000009_rls.sql:119
create policy orders_kitchen_read on public.orders
  for select to authenticated
  using (public.is_staff('kitchen'));          -- every order, for all time
```
Contrast `orders_driver_read` two lines below, correctly bounded by `driver_id = auth.uid()`.
- **Finding A (S0, from reviewing S2-06):** a `security_invoker` view is only as tight as the **loosest** policy on anything it joins. S0's S2-06 boot specified `report_payments` as such a view; S2 refused and was right, because a view joining `orders` would have handed kitchen every order's payment data however correct `payment_events`' own RLS is. **The leak never shipped** — S2 built a function with an owner/operator guard instead.
- **Finding B (S4, from S4-03):** a `kitchen` tag `PATCH` on `customers` returns **`[]` with no error**. RLS matches zero rows silently, so the **route guard in the app** is what actually keeps kitchen out of the CRM, not the database.

## Tasks
1. **Sweep for Finding A's pattern.** Enumerate every view and `security_invoker` object and the tables each joins. For each join, name the loosest policy that applies and whether it bounds **rows** or only **roles**. The four report functions from S2-03 (`report_revenue_by_day`, `report_top_items`, `report_delivery_times`, `report_funnel`) plus S2-06's `report_payments` are the priority, but do not stop there — anything joining `orders`, `order_items` or `customers` qualifies. Say "checked" where it holds, not just where it fails; an audit that only lists problems cannot be trusted to have looked everywhere.
2. **Spot-check with a real `kitchen` JWT, not by reading policies.** Kitchen is the interesting role precisely because its order policy is role-only. Confirm what a kitchen session can actually read across `orders`, `order_items`, `customers`, the reports and the storage buckets. Reading the SQL is how both of these findings were *missed* for weeks; a session with a token is how they were found.
3. **The forward-looking check, cheap now and expensive later.** Per D-016 customers will soon have `auth.users` rows, so **`authenticated` will stop being a synonym for "staff"**. S0 measured that the backend is already safe by construction — `auth_role()` is a lookup in `staff` so a non-staff login yields `null`, every `to authenticated` policy carries an explicit `is_staff(...)` predicate, and the two functions granted to `authenticated` without one (`set_order_status`, `add_customer_event`) both raise `42501` internally. **Nothing tests it.** Re-run your `security_audit_*` matrix with a **non-staff authenticated JWT** as a new column — any signed-up user with no `staff` row will do, you do not need the customer-accounts feature to exist. The expectation is that everything refuses; a pass that *confirms* it is a cheap, high-value result, and it becomes a regression test S2-07 must not break.
4. **Rule on the judgements, because these are calls rather than defects.** (a) Should `orders_kitchen_read` be bounded — to open/active orders, or a time window — rather than every order for all time? Kitchen needs today's tickets, not last year's. (b) Should a kitchen/driver write **raise** rather than no-op, given the same codebase already raises `42501` for a direct `customer_events` insert even for an operator? (c) Is "the route guard is the real control" acceptable to write down as the design, or should `/docs/security.md` §5 require a DB-level refusal at every staff-role boundary? Your call to make and justify; S0 schedules whatever implementation follows.
5. **Write the rule down so the next report is specified correctly the first time.** Fold Finding A's lesson into `/docs/security.md` §5 — a `security_invoker` view inherits the caller's RLS on every join, so a report built as a view is only as tight as its loosest join. That one sentence would have prevented S0's wrong instruction.
6. **Note the silent-no-op hazard in its own right.** A PostgREST write matching no rows returns `200` with `[]`, so a caller cannot distinguish "refused" from "nothing matched". Any future code that treats 2xx as "it worked" is wrong in a way no test catches — the same class as S2-04's "a test said it worked" finding. Decide whether that deserves a standing rule.

## Boundaries
- Do NOT change any RLS policy, grant, trigger or function. **Audit and propose only** — two sessions are live in the surfaces you are auditing.
- Do NOT touch `apps/backoffice` (S4-04 live), `apps/web`, `apps/e2e` (S6-01 unlanded), or `apps/infra`.
- Do NOT add migrations. If a schema change is the right answer, propose it with the SQL in the proposal.
- Do NOT use the service-role key for anything except, if you must, reading a policy catalogue — never to test an access boundary, since that proves nothing about a real session.
- Do NOT edit `/docs/api-contracts.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`. `/docs/security.md` **is** yours.
- **Credentials changed:** the seed passwords were rotated by the owner on 2026-10-09; the published `shosho-test-2026` no longer works. Ask the owner for the current value — it exists only in a gitignored file on their machine. Never print or commit it.
- Do not reseed, truncate or reset `shosho-staging`; prefer a local stack for anything destructive.

## Done when
- [ ] Every view / `security_invoker` object enumerated with its joins and each join's loosest applicable policy, including the ones that are fine
- [ ] Kitchen's real reach measured with a **kitchen JWT**, not inferred from policy text
- [ ] The `security_audit_*` matrix re-run with a **non-staff authenticated JWT**, with the result stated either way
- [ ] Rulings on (a) bounding `orders_kitchen_read`, (b) raise-vs-no-op, (c) whether a route guard may be the real control — each justified
- [ ] Finding A's rule written into `/docs/security.md` §5
- [ ] One proposal per owning session for anything needing implementation, in `/memory/boots/proposed/`
- [ ] No policy, grant or migration changed by this boot
- [ ] PR `s7-02` merged

## Reporting
1. `/memory/log.md`: `## <date> — S7 Security — S7-02` — ranked as in S7-01 (critical/high/medium/low), each with what, where (`file:line`), how to reproduce, and which session owns the fix. **Report agreement as plainly as disagreement** — "checked with a kitchen token, holds" is a result.
2. `/memory/state.md`: ONLY the S7 row.
3. Commits `[S7-02]`.

## Next step
Proposals → `/memory/boots/proposed/`. Do not execute them. After reporting — stop and wait for S0.
