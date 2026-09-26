# BOOT: S2-03 (Backend) — close the §6 contract gaps, add `order_attempts`, build the reports views

## Role
You are session S2 (Backend) of SHOSHO. S4 built the back-office against §6 and hit eight gaps; S0 has decided all eight (see `/docs/api-contracts.md` **§6.9**). This boot implements those decisions, adds the rejected-checkout feed that both the operator states and the Berichte funnel need, and ships the report views S4's Berichte screen will read. Campaigns / automations / CMS move to S2-04.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -b s2-03 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s2-03` → `main`. Repo language English.
Read FIRST: `/memory/state.md`, `/memory/decisions.md`, `/docs/api-contracts.md` — **§6.9 is your specification**, plus the amended §1.3 (`customer_stats` intent), §1.4 (`order_events` payload per type) and §6.1 (`reason`). Then `/memory/boots/proposed/S4-contract-request.md` for S4's reasoning and the workarounds currently shipping, and your own `/memory/boots/proposed/S2-03-reports-campaigns-cms.md` (its reports part is task 4 here; its campaigns/CMS part becomes S2-04 — leave that file, S0 renames it).

**Standing rule from S2-02, now mandatory:** every new function must explicitly revoke the default `anon`/`authenticated` EXECUTE grants and pin `search_path`; every role gate must handle a NULL role. S7-01 is adding a regression test for exactly this — do not be the one who fails it.

## Tasks
1. **Role access (§6.9 rows 1–2).**
   - `settings`: authenticated staff of any role may read the public key set **plus `ops`** and `kitchen.status`. `payments` (private), credential-bearing keys and the private half of `business` stay owner/operator. Update `settings_public_keys()` / the RLS policies accordingly, and say in the README which keys are which.
   - `staff_directory` view: `id, name, role, active`, readable by every authenticated staff role; base table policy unchanged. Make sure the view does not leak `phone` or anything added later (select an explicit column list, not `*`).
2. **Event payloads (§1.4, §6.9 row 3).** Align the status trigger and the RPCs so every event type writes the documented payload; `handed_to_driver` gains `driver_id` + `driver_name`, `cancelled` writes `{reason}`, `note` writes `{text, code?}`, `created` `{channel}`, `payment_authorized` `{payment_ref, provider, amount_cents}`. Backfill is NOT required — consumers tolerate missing keys — but say so in the log.
3. **`set_order_status` reason key (§6.9 row 4).** Accept `payload.reason` (canonical) and `payload.cancel_reason` (legacy) for one release; write `{reason}` into the event and `orders.cancel_reason`. Signature and return shape unchanged.
4. **Kitchen capacity (§6.9 row 6).** `settings.kitchen.capacity` (int, default 8) in the ops/public key set. No RPC needed — the UI computes the percentage.
5. **`order_attempts` (§6.9 row 5).** New table: `id`, `at`, `source` (`website` | `phone` | other channels later), `type`, `postal_code null`, `zone_id null`, `subtotal_cents`, `items jsonb` (item ids + qty only — no free text, no contact data), `problems jsonb` (the `problems[]` array), `promo_code null`, `session_hash null` (opaque client-side id, not a cookie, for de-duplication). Written by: (a) `place_order` when it refuses, automatically; (b) a new RPC `record_order_attempt(payload)` callable by `anon` for guest abandonment at a `problems[]` state — rate-limit it cheaply (reject more than N per `session_hash` per minute, N configurable, default 20). RLS: `anon` may insert through the RPC only, never select; owner/operator may select. **No PII**: never store name, phone, email, street or comments here.
6. **Reports views (Berichte).** Views (or security-definer functions if RLS makes views awkward), all staff-readable, all parameterised by a date range where it makes sense:
   - `report_revenue_by_day(from, to)` — revenue split delivery / pickup / upsell (options), order count, avg basket, per day.
   - `report_top_items(from, to, limit)` — quantity, revenue, margin (`price − cost`) per item.
   - `report_funnel(from, to)` — from `order_attempts` + `orders`: attempts → carts with problems → placed → paid, so the design's "MENÜ → WARENKORB / WARENKORB → BEZAHLT / ZUSATZVERKAUF" tiles have real numbers. State plainly in the README which of the three the data can honestly support today and which needs S3 to emit more attempt rows.
   - `report_delivery_times(from, to)` — avg accepted→delivered, promised vs actual, overdue share, per zone.
   - `customer_stats` — rebuild per §1.3: completed orders only (`delivered`, `picked_up`), plus a separate `cancelled_count`. Check every existing consumer (`§6.4`, the CRM list, the detail screen's "14. Bestellung") still gets sane numbers.
7. **Types + tests.** Regenerate `types/database.ts`. Tests: role matrix for the new settings/staff access (kitchen and driver can read ops and the directory, cannot read `payments` or `staff.phone`), event payload shape per transition, `reason`/`cancel_reason` both accepted, `order_attempts` written on refusal + the anon RPC path + the rate limit + that no PII column exists, each report view against seeded data with known expected numbers, and `customer_stats` excluding cancelled. Keep `backend` CI green.
8. **Fix the flaky test.** `tests/guest_realtime.test.ts` failed on `main` on 2026-09-26 with `no broadcast received … partitions_created: []` and passed on re-run (S0 hit it on PR #26). Make it deterministic — ensure the partition exists before subscribing, wait on a real signal rather than a fixed timeout, or mark it as an explicitly skipped integration test with a documented manual recipe. A flaky test on the required check blocks every other session.
9. **Contract.** Update §6.9 rows to "implemented", document the new views in a new **§6.10 Reports** and `order_attempts` in §1.5, and note the `staff_directory` view in §4. Do not rewrite other sections. README: the key sets, the new views, the attempt table's privacy rules.

## Boundaries
- Do NOT build campaigns, automations, banners or site-publish (S2-04). Do NOT build UI.
- Do NOT touch `apps/web`, `apps/backoffice`, `apps/infra` (workflows included).
- Do NOT edit applied migrations — new files only. Do NOT edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`, or §1–§6 beyond the sections named in task 9.
- Do NOT put PII into `order_attempts`, and do NOT make it readable by `anon`.
- No secrets in the repo.

## Done when
- [ ] Kitchen and driver can read `ops` + `kitchen.status` + `staff_directory`; cannot read `payments` or `staff.phone` — proven by test
- [ ] Every event type writes its documented payload
- [ ] `reason` canonical, `cancel_reason` still accepted
- [ ] `settings.kitchen.capacity` exists
- [ ] `order_attempts` + `record_order_attempt` with rate limit, no PII, anon-insert-only
- [ ] Five report views/functions return correct numbers on seeded data
- [ ] `guest_realtime` test is deterministic
- [ ] Types regenerated, `backend` CI green, staging migrated by the pipeline
- [ ] §6.9 marked implemented, §6.10 + §1.5 written; PR `s2-03` merged

## Reporting
1. `/memory/log.md`: `## <date> — S2 Backend — S2-03` — what shipped, which funnel numbers are honest and which are placeholders, flaky-test outcome, blockers.
2. `/memory/state.md`: ONLY the S2 row.
3. Commits `[S2-03]`.

## Next step
S2-04 (campaigns, automations, banners/site publish — the rest of your own proposal) and single-customer erasure → proposals in `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
