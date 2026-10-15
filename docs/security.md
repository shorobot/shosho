# SECURITY — SHOSHO

First security pass (S7-01), 2026-09-26. Read alongside `/memory/infra-access.md` (co-tenant terms,
binding) and `/docs/api-contracts.md` §4/§6 (the authorisation contract this document verifies).
Findings are ranked in `/memory/log.md`'s S7-01 entry; this file is the standing reference —
the authorisation matrix, the threat model, the controls in place, and the rules every future
migration/PR must follow. Update it (don't replace it) when a later security pass changes any of this.

## 1. Threat model, in one page

**What we're protecting.** A public-repo, public-storefront sushi-delivery app: guest orders and
payments (Stripe, manual capture), a staff back-office (orders, CRM, menu), and the data behind both
— customer PII, order history, staff accounts, and (once the owner's Stripe account exists) real
money moving on delivery confirmation.

**Who can reach it.**
- **Anonymous internet users** — the guest site and its Supabase `anon` key are public by
  construction. This is normal: the anon key is *meant* to be public (it's shipped in every page
  load); RLS and function grants are the actual boundary, not key secrecy.
- **Staff** — four roles (`owner`/`operator`/`kitchen`/`driver`) via Supabase Auth. Currently a
  shared, published test password (see §6) — the one control this document flags as most urgent to
  change before the back-office gets a public URL.
- **Anyone who can read this public GitHub repo** — i.e. everyone. No code, migration, or CI
  secret-handling pattern may assume the repo itself is confidential.
- **The co-tenant host** (`/memory/infra-access.md`) — TETA+PI administers the box we run on; we are
  isolated by uid/ports/cgroup, not by trust.

**What would actually hurt.** In order: (1) money moving incorrectly (an order marked paid with no
real payment, a double capture/refund); (2) customer PII leaking beyond what RLS intends (phone,
address, allergy notes — health-adjacent data under GDPR); (3) a guest or a low-privilege staff role
(kitchen/driver) reaching an owner/operator action (pausing intake, editing orders, refunding); (4)
service disruption on the shared 512M co-tenant box (OOM affects nothing outside our own cgroup, but
is still an outage for us).

**The recurring failure mode this project has already hit once.** Supabase grants EXECUTE on every
new `public` function to `anon`/`authenticated` by default, independent of the PUBLIC pseudo-role —
so `revoke execute … from public` does *not* lock a function down, and a role-check written as
`if v_role not in (...)` silently passes for `anon` because `v_role` is `NULL` and `NULL NOT IN (...)`
is `NULL`, which plpgsql treats as false. S2-02 found and fixed the first instance (migration 18);
this audit found the same NULL-guard pattern still live in two more functions (migration 19) and adds
a permanent regression test (§2) so the *next* instance is caught in CI, not in production.

## 2. Authorisation matrix (verified against a live Supabase instance, not just migration text)

Proven by `apps/backend/tests/security.test.ts` (function-grants sweep, RLS sweep, per-role spot
checks) plus the existing feature test files (`rls.test.ts`, `status.test.ts`, `webhook.test.ts`,
`payment_jobs.test.ts`, `update_order_items.test.ts`, `customer_events.test.ts`, `anonymise.test.ts`,
`storage.test.ts`, `guest_realtime.test.ts`).

### Tables (RLS, all enabled — verified live, no gaps)

| Table | anon | kitchen / driver | operator | owner | service_role |
|---|---|---|---|---|---|
| `menu_categories`/`items`/`option_groups`/`options`/`menu_item_option_groups` | read on-sale/active rows only | same as anon (+ staff-read for full catalogue: `items_staff_read` etc.) | full read + write | full read + write | all |
| `delivery_zones` | read active zones | read active zones (+ staff read) | read + write | read + write | all |
| `settings` | public keys only (`settings_public_keys()`) | public keys + `ops` (`settings_staff_keys()` — S2-03, api-contracts §6.9 row 1); private `payments` / `kitchen` invisible | read every key (`settings_staff_read`); no write | full read/write | all |
| `staff` | none | own row only | own row + staff list read | full read/write | all |
| view `staff_directory` (S2-03) | none (grant revoked) | read `id, name, role, active` for the team | same | same | all |
| `order_attempts` (S2-03) | none — insert via `record_order_attempt()` only, never select (grant revoked, no insert policy) | none | read | read | all |
| `customers`, `customer_addresses` | none (only via `place_order`/`get_order_by_token`) | none | full | full | all |
| `orders`, `order_items`, `order_events` | none directly | kitchen: read all; driver: read own (`driver_id = auth.uid()`) only | full | full | all |
| `promo_codes` | none | none | full | full | all |
| `payment_events`, `payment_jobs`, `customer_events` | none | none | read-only (no write policy exists for anyone — writes are trigger/RPC/service-role only) | read-only | all |
| `storage.objects` (bucket `menu`) | public read | public read | read + write (`is_staff('owner','operator')`) | read + write | all |
| `realtime.messages` (topic `order:%`) | read, scoped to the exact topic the client subscribes to — see §3 | same | same | same | all |

No table in `public` is missing `ENABLE ROW LEVEL SECURITY`; `storage.objects` and
`realtime.messages` (owned by Supabase's own extensions, not our migrations) are asserted — not
assumed — to have RLS on, by `security.test.ts`.

### 2.1 Views and other `security_invoker` objects (S7-02 sweep)

**The rule (see §4.7): a `security_invoker` view is only as tight as the loosest policy among
every table it joins — not as tight as its own "main" table.** The instance that was caught
before shipping (`report_payments` specified as a view, built as a function instead) is in
`memory/boots/proposed/S7-report-view-rls-sweep.md`. This table is the full sweep the proposal
asked for — every view/`security_invoker` object in `public`, what it joins, and the loosest
policy on each join.

| Object | `security_invoker` | Joins | Loosest join policy | Verdict |
|---|---|---|---|---|
| `customer_stats` (migration 24) | `true` | `customers` (driving table, `left join orders`) | `customers_staff_all` — owner/operator only, **no kitchen/driver read policy exists at all** | **Safe.** The driving table's own restriction means kitchen/driver get zero `customers` rows before the join to `orders` ever runs — an empty left-hand side cannot be widened by what it's joined to. Confirmed structurally; not yet confirmed with a live kitchen JWT this boot (§8). |
| `menu_items_on_sale` (migration 8) | `true` | `menu_items` only | `items_staff_read` (owner/operator/kitchen full catalogue) / `items_public_read` (anon/driver: on-sale only) | **Safe.** Single-table view over non-PII menu data; the join concern doesn't apply (nothing to compose against). |
| `staff_directory` (migration 21) | `false` (security definer, `security_barrier`) | none — queries `staff` as its own owner | n/a — the view's own `where auth_role() is not null` is the only gate, by design | **Safe, and correctly not `security_invoker`**: the comment explains why (the view must see rows the caller's own `staff` RLS would hide). Explicit 4-column list keeps `staff.phone` (and anything added later) behind the base table's owner/operator policy. |
| `banners_live` (migration 31) | `false` (security definer, `security_barrier`) | none — queries `banners` as its own owner | n/a — the view's own `where active and in-window` is the gate | **Safe**, same reasoning as `staff_directory`. Explicit column list excludes `draft`. |
| `report_payments` (migration 30) | n/a — not a view | function reads `orders` (kitchen: role-only, no row bound) `left join payment_jobs` | — | **Safe, and the file's own comment names exactly this sweep's rule as the reason**: a `security_invoker` view here would have let kitchen see every order's payment method/status through the `orders` join. Built as a `security definer` function with an explicit owner/operator-only guard instead. |
| `resolve_segment` (migration 29) | n/a — not a view | function reads `customers left join customer_stats` | — | **Safe.** `security definer` with an explicit `auth_role() not in ('owner','operator')` guard checked *before* the query runs; kitchen/driver never reach the query regardless of what the inner join could see. |
| `report_revenue_by_day` / `report_top_items` / `report_delivery_times` / `report_funnel` (migration 24, 32) | n/a — not views | functions read `orders`/`order_items`/`delivery_zones`/`order_attempts` directly | — | **Safe, by a different and deliberate design**: these are `security definer` functions gated by `reports_guard()` (any active staff role — **including kitchen/driver**, by S2-03's explicit ruling, not an oversight, documented in migration 24's own comment). Being functions, not views, Finding A's join-composition risk doesn't apply to them at all; every caller gets the same numbers from the same guard. |

**Audit-tooling gap found while doing this sweep, not a live leak:** `security_audit_table_grants()`
(migration 20) filters `c.relkind in ('r', 'p')` — ordinary and partitioned tables only. A view
(`relkind = 'v'`) never matches, so `customer_stats`/`menu_items_on_sale`/`staff_directory`/
`banners_live` have **no automated grant or RLS-applicability check at all** — `security.test.ts`'s
"every table in `public` has RLS enabled" sweep silently says nothing about any of them. All four
were hand-verified safe above, but the next view added to this schema gets the same blind spot
unless the helper is widened. Proposed to S2 in `boots/proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md (task 3)`.

### RPCs / Edge Functions (EXECUTE grants, verified live via `pg_proc`/`has_function_privilege`)

| Function | anon | authenticated (staff) | service_role |
|---|---|---|---|
| `quote_order`, `place_order`, `get_order_by_token`, `shop_open_at`, `normalize_phone`, `auth_role`, `is_staff`, `settings_public_keys`, `settings_staff_keys`, `menu_item_on_sale`, `record_order_attempt`, `order_attempt_items_ok` | ✅ | ✅ | ✅ |
| `set_order_status`, `kitchen_pause`, `update_order_items`, `add_customer_event`, `anonymise_silent_customers`, `order_transition_allowed` | ❌ | ✅ (role-gated inside the function) | ✅ |
| `current_actor`, `enqueue_payment_job`, `claim_payment_jobs`, `finish_payment_job`, `record_payment_event`, `schedule_payment_worker`, `run_payment_worker`, `ensure_menu_bucket_policies`, `ensure_guest_realtime_policy`, `is_service_request` | ❌ | ❌ | ✅ |
| Edge Function `create-payment-intent` | ✅ (with a matching `tracking_token`) | ✅ (owner/operator, no token needed) | n/a (not called by staff/guest sessions) |
| Edge Function `stripe-webhook` | n/a — `verify_jwt = false`; the `Stripe-Signature` header is the authentication | | |
| Edge Function `payment-worker` | reachable with any valid project JWT incl. the public anon key (`verify_jwt = true` only checks *a* JWT exists) — see finding in §5 | | intended caller (cron/trigger, via Vault-stored anon key) |

Trigger functions (`set_updated_at`, `orders_before_status_change`, `orders_after_status_change`,
`orders_count_promo_use`, `orders_customer_event`, `customers_consent_changed`,
`orders_broadcast_tracking`, `payment_jobs_kick_worker`) are excluded from the table above: Postgres
refuses to invoke a `returns trigger` function outside trigger context regardless of its grants, so
their default (unrevoked) EXECUTE grants are not a live vulnerability — `security.test.ts` still
tracks them explicitly so a refactor that changes one's return type doesn't fall through unnoticed.

## 3. Guest tracking realtime — what the token actually protects

`orders.tracking_token` is `encode(gen_random_bytes(16), 'hex')` — 128 bits from Postgres's
cryptographically-secure RNG. Both `get_order_by_token(token)` (RPC) and the realtime broadcast
(`realtime.messages` policy `"guest order topics read"`, `using (realtime.topic() like 'order:%')`)
use **possession of this token as the entire authorisation** — there is no per-guest identity check
because Realtime evaluates RLS with only the subscriber's JWT, and every guest shares the same anon
JWT (documented in migration 16). This is a deliberate, sound design given the constraint, with one
consequence worth stating plainly: **the token is now a bearer secret**, like a password reset link.
Anyone who obtains it (a forwarded tracking URL, a browser-history leak, a server access log) can read
that order's live status. Today nothing in the web app leaks it (no third-party requests, no
analytics, on the tracking page — verified) but this is a standing constraint on any future change to
that page, not a one-time check.

## 4. Standing rules for future migrations (read this before writing a new `security definer` function)

1. **Every new `public` function needs an explicit grant/revoke decision, not just a comment.**
   Supabase grants EXECUTE to `anon`/`authenticated`/`service_role` by default at creation time,
   *separately* from the PUBLIC pseudo-role. `revoke execute on function … from public;` is not
   enough — you must `revoke … from anon` and/or `authenticated` explicitly for anything that is not
   meant to be callable by that role. `apps/backend/tests/security.test.ts`'s "every function in
   `public` is accounted for" test will fail CI the moment you add a function without updating its
   allow-lists — treat that failure as the prompt to make the grant decision, not as a test to patch
   around.
2. **Every `security definer` function pins `search_path`** (`set search_path = public` or
   `pg_catalog, public` when it needs system catalogs). This is enforced by
   `security.test.ts`.
3. **Never write a role guard as `if v_role not in (...)` or `if not (v_role = 'x' or ...)`.**
   `v_role` (from `auth_role()`) is `NULL` for `anon` and for any authenticated user with no active
   `staff` row — `NULL NOT IN (...)` and `NOT (NULL OR ...)` are both `NULL`, and plpgsql's `IF`
   treats `NULL` as false, so the guard silently does not fire. Always write `if v_role is null or
   v_role not in (...)` (see `update_order_items`, `add_customer_event`, and — since migration 19 —
   `kitchen_pause`), or, when a function must also allow a genuine service-role/cron caller regardless
   of role, `if v_role is distinct from 'owner' and not is_service_request() then ...`
   (`anonymise_silent_customers`'s pattern — `IS DISTINCT FROM` is NULL-safe by construction).
4. **Never trust a client-supplied payment/authorization field.** `total_cents` and friends are
   already safe everywhere (always re-derived from `quote_order` server-side) — but see the CRITICAL
   finding in §5: `payment_status` is not currently held to the same standard in `place_order`. Any
   new payment-adjacent field must be treated the same way `payment_authorized_cents` is: settable
   only from a verified Stripe webhook event, never from RPC input.
5. **A new table needs RLS enabled in the same migration that creates it**, with at least one policy
   — `security.test.ts` fails on either gap (no RLS, or RLS with zero policies).
6. **A new bucket or a new `realtime`-adjacent feature needs its own policy, asserted against the
   live catalog** (see `security_audit_table_grants()`/`security_audit_policies()` in migration 20) —
   don't assume Supabase's own schemas (`storage`, `realtime`) come pre-configured the way you want.
7. **A `security_invoker` view inherits the caller's RLS on every table it joins — it is only as
   tight as the loosest policy among them, never as tight as its "main" table's policy alone**
   (S7-02, sweep in §2.1). `orders_kitchen_read` is role-only with no row bound, so any
   `security_invoker` view that joins `orders` hands kitchen every order it touches, however
   correct the *other* joined tables' own RLS is — this is what `report_payments` avoided by
   becoming a `security definer` function with its own explicit guard instead of a view. Before
   specifying a new report/summary as a view: name every table it joins and the loosest policy on
   each, the same way §2.1 does; if any join is role-only rather than row-bound, build a function
   with an explicit guard instead, or bound that join's own policy first.
8. **Row-Level Security is row-level, not column-level** (first named by S2-06, migration 32,
   §8.7): a `using (...)` policy that admits a row admits every column in it unless a column-level
   `GRANT`/`REVOKE` narrows it separately — and a column grant is per **database role**
   (`anon`/`authenticated`/`service_role`), never per `staff.role`. There is no SQL mechanism that
   grants `authenticated` a column on some RLS-admitted rows but not others; narrowing by
   `staff.role` within a column needs either a separate `security definer` accessor (the
   `staff_directory`/`banners_live` pattern) or keeping the sensitive column out of any row a wider
   staff audience can already read. See §5's `settings.draft` finding for the case this rule would
   have prevented.
9. **A `200` with an empty array from PostgREST is not evidence anything was refused** — a direct
   table write whose RLS `USING`/`WITH CHECK` admits zero rows returns success with no rows changed,
   indistinguishable from "nothing matched." This project's accepted position (S7-02, ruling in §5):
   this is fine for a role that has read access but no write policy at all on a table (kitchen/driver
   on `customers`/`orders`/`banners`) **as long as** (a) every state-changing action for that role
   goes through a `security definer` RPC that raises explicitly on a role violation — true today for
   every status/payment-affecting path — and (b) any UI that performs a direct table write checks
   rows-affected rather than trusting the response code (`apps/backoffice/lib/write.ts`'s `wrote()`,
   S4-03). A future direct table write exposed to a limited-privilege role that skips (b), or a new
   state-changing RPC that can silently no-op instead of raising, is the regression to watch for —
   not the existing `customers`/`orders` shape, which is intentional and documented here precisely so
   the next person doesn't have to re-derive it from reading RLS text the way this boot did.

## 5. Findings needing another session (see `/memory/log.md` S7-01/S7-02 for the ranked lists; proposals in `/memory/boots/proposed/`)

- **Medium/High — `orders_kitchen_read` (and the matching `order_items`/`order_events` kitchen
  policies) are role-only with no row bound, so a kitchen login can read every order ever placed —
  including `contact_name`, `contact_phone`, `address` and `allergy_note` on orders from months ago
  that kitchen has no operational reason to see** (`apps/backend/supabase/migrations/
  20260920000009_rls.sql:119-121,129-131,140-142`). This is the question S0's two filed findings
  (`proposed/S7-report-view-rls-sweep.md`, `proposed/S7-S4-03-kitchen-rls-silent-noop.md`) both
  pointed at. **Ruling (task 4a of S7-02): bound it.** Kitchen needs today's/active tickets, not a
  PII-bearing historical archive — recommend bounding by order *status* (the open-pipeline states),
  not a wall-clock window, since a scheduled future order or an order stuck in `ready` for two days
  must stay visible regardless of when it was created. Concrete SQL and the three-policy change are
  in `proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md (task 2)`. Filed to S2 (schema owner); not changed here
  per this boot's boundary (two sessions live in this surface).
- **Medium — any staff role (not just owner/operator) can read `settings.draft` — the staged,
  unpublished CMS/ops content — for every row in `settings_staff_keys()` (`business`,
  `opening_hours`, `site`, `payments.enabled`, `kitchen.status`, `ops`).** Migration 32's
  column-level `GRANT`/`REVOKE` (§4.8, §8.7) narrowed only `anon`'s column grant on `settings`;
  `authenticated`'s table-wide grant — which includes `draft`, added by the same migration — was
  never narrowed, and `settings_staff_common_read` (migration 21,
  `20260926000021_role_access.sql:45-47`) admits **kitchen and driver**, not just owner/operator, to
  exactly these rows. `api-contracts.md` §8.7's own stated intent — "`authenticated` keeps its
  existing table-level grant unchanged, so **owner/operator** continue to see `draft`" — is therefore
  not what the grants actually enforce: kitchen/driver see it too. The data at risk is staged
  marketing copy, business/legal fields and `ops` tuning values — `payments` and `kitchen` (the two
  genuinely sensitive private keys) correctly stay out of `settings_staff_keys()` and are
  unaffected — which is why this is Medium, not High. Not yet confirmed with a live kitchen JWT
  this boot (§8); confirmed by direct policy/grant tracing (§4.8). Fix sketch (a `security
  definer` accessor for `draft`, matching the `staff_directory`/`banners_live` pattern, since a
  plain column `GRANT` cannot be scoped to a subset of `staff.role` values) in
  `proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md (task 1)`. Filed to S2.
- **Low — the CI "every table in `public` has RLS enabled" sweep silently excludes views.**
  `security_audit_table_grants()` (`20260926000020_security_audit_helpers.sql:79-81`) filters
  `c.relkind in ('r', 'p')`, which never matches `relkind = 'v'` — so `customer_stats`,
  `menu_items_on_sale`, `staff_directory` and `banners_live` have no automated grant check at all
  (§2.1). All four were hand-verified safe this boot; the gap is in the tooling, not a live leak.
  Widen the filter (or add a parallel view-inventory helper) in
  `proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md (task 3)`. Filed to S2 — small, low-risk, folds into
  the same migration as the `settings.draft` fix above.
- **Low — the regression test D-016/S7-02 task 3 asked for does not exist, though the code it would
  test already holds.** `tests/status.test.ts:107` ("anon and non-staff cannot change status") and
  `tests/role_access.test.ts:123` ("kitchen_pause refuses a non-staff caller") both call `anon()`
  only — neither exercises a genuinely signed-up `authenticated` user with no `staff` row, which is
  the exact shape a future customer-account login (D-016) will be. Static re-check this boot (every
  `to authenticated` RLS policy and every staff-gated function either carries an explicit
  `is_staff(...)`/`auth_role() is not null`/`is distinct from` guard, or is revoked from
  `authenticated` outright; migration 19 already closed the one NULL-unsafe guard class that would
  have mattered) says **the matrix holds** — but nothing in CI proves it with a live token, so a
  regression here would ship silently. Recommend a `signUpNonStaff()` test helper (plain
  `admin().auth.admin.createUser()`, no `staff` row) plus one assertion per staff-gated surface.
  Could not run this live myself this boot — no local Supabase stack was reachable in this
  environment (§8) — so this is a recommendation, not a fresh pass/fail. Filed to S2 in
  `proposed/S7-02-S2-kitchen-driver-reach-and-rls-fixes.md (task 4)`.
- ~~CRITICAL — `place_order` accepts a client-supplied `payment_status` of `authorized` with no
  relationship to `payment_method` or any real Stripe event~~ — **fixed and merged, S2-04 (PR #41,
  migration `20260928000025_payment_trust_boundary.sql`), confirmed by re-reading the live function
  this boot (S7-02):** a guest/anon caller may now only ever create `pending`; `authorized` is
  reachable from exactly one place (`record_payment_event`, fed by the signature-verified Stripe
  webhook); staff may record `paid` only (audited with an `order_events` note), never `authorized`.
  This entry was still live/unstruck in this file as of S7-02's read — corrected here so this
  standing reference matches `/memory/state.md` and `/memory/decisions.md` D-011 instead of lagging
  them. The four entries below it in this list were *also* stale for the same reason — all fixed,
  all re-verified live by S7-02 this boot. Full detail and the fix-by-fix trace:
  `/memory/boots/proposed/S7-02-S2-payment-security-fixes.md`, now annotated resolved (only its
  task 6, a process recommendation, stays open).
- ~~Medium/High — a `payment-worker` refund job can be duplicated~~ — **fixed.**
  `refund` now uses a **stable** idempotency key across attempts (`refund:job:<id>`, not
  `job:<id>:<attempt>`) and asks Stripe what refunds already exist on the intent before acting
  (`apps/backend/supabase/functions/payment-worker/index.ts:63-72`, `_shared/refund-plan.ts`) — the
  same "ask the provider first" shape `capture`/`void` already had.
- ~~Low — `payment-worker` accepts any valid project JWT~~ — **fixed.** It now requires either the
  service-role key or `x-worker-secret` (`public.payment_worker_secret()`, a 32-byte DB-owned
  secret only this function and `run_payment_worker()`'s cron call can present) —
  `payment-worker/index.ts:4-10`, migration `20260928000026_search_path_and_worker_secret.sql`.
  `{"action":"install"}` is still anon-reachable on purpose (its parameters are server-side
  constants; the swap to a dedicated token is its own filed item, `S2-04-S1-payment-worker-install-
  token.md`, S1's).
- ~~Low — `tracking_token` compared with `!==`~~ — **fixed.** `create-payment-intent/index.ts:60`
  now calls `timingSafeEqual` (`_shared/secure-compare.ts`).
- ~~Medium — security headers are not set by either Next.js app~~ — **fixed.** Both
  `apps/web/middleware.ts` and `apps/backoffice/middleware.ts` now set a nonce-based CSP (with
  `frame-ancestors 'none'`), re-verified live over the deployed back-office container by S0
  2026-10-07 (`/memory/state.md`'s "What exists now" section has the full header list).
- ~~Medium — back-office open redirect~~ — **fixed.** `LoginForm.tsx` now resolves `?next=` through
  `apps/backoffice/lib/safeRedirect.ts`'s `safeNextPath()` — an explicit allow-list of same-origin
  relative paths, not the old bare `startsWith("/")` check a protocol-relative `//evil.example`
  also satisfied. S4 re-verified live: `?next=//evil.example/phish` no longer escapes the origin.
- **Medium/High — no rate limiting anywhere** on `place_order`, `quote_order`,
  `create-payment-intent`, or back-office `/login` beyond Supabase Auth's generic default. The only
  place this can live given our co-tenant terms (no nginx access) is a Cloudflare rule. Filed to S1.
- ~~GitHub branch protection on `main` is off~~ — **false positive, corrected 2026-09-27.** The
  classic `/branches/main/protection` endpoint 404s for repos protected via the newer Rulesets API,
  which this repo uses: `gh api repos/shorobot/shosho/rulesets` shows ruleset `main-protection`
  (id `23652140`, `enforcement: active`, `bypass_actors: []`) enforcing `pull_request` +
  `required_status_checks: [CI]` + `deletion` + `non_fast_forward` on the default branch —
  confirmed independently (an earlier finding here was corrected after a peer session pointed at
  the right endpoint; verified against the live ruleset, not taken on trust). `/memory/state.md`'s
  description was correct all along. Check `/rulesets`, not `/branches/<b>/protection`, when
  re-verifying this later.
- ~~High — the four staff seed accounts share one password, published in a public repo's
  README~~ — **fixed.** The owner ran `rotate-staging-passwords.mjs` 2026-10-09; the published
  `shosho-test-2026` now returns `invalid_credentials` for all four accounts (verified against the
  live project by S4, not inferred from the script's exit code). The new values exist only on the
  owner's machine (`apps/backend/.staff-credentials.local`, gitignored) — see `/memory/state.md`
  owner-action 1a for the one still-open half (confirming the *new* values authenticate, not just
  that the old one is dead).
- ~~Low — six `SECURITY INVOKER` functions don't pin `search_path`~~ — **fixed.** All six
  (`set_updated_at`, `current_actor`, `orders_before_status_change`, `settings_public_keys`,
  `normalize_phone`, `order_transition_allowed`) now carry `set search_path = public` (or
  `public, auth` for the two needing `auth.uid()`) — migration
  `20260928000026_search_path_and_worker_secret.sql`, re-verified live by S7-02.

## 6. GDPR / legal (Germany) — findings, not legal advice

- **Erasure**: only the nightly `anonymise_silent_customers(24)` job exists; there is no path to
  fulfil a single-customer erasure request today on demand (confirmed: the RPC takes a `months`
  cutoff, not a `customer_id`). Filed as a product gap already known to S2 (`S2-03` proposal); flagged
  here as a live GDPR compliance gap, not just a feature request.
- **Retention**: order rows are deliberately kept forever (GoBD 10-year bookkeeping retention) with
  PII stripped by the anonymisation job — the design correctly separates "delete personal data" from
  "delete the fiscal record," which is what German law actually requires. No issue found.
- **Consent**: `consent_email`/`_push`/`_phone` changes are captured with `granted_at`/`source` and
  logged to `customer_events` automatically (trigger `customers_consent_changed`) — a reasonable audit
  trail. No issue found.
- **Cookie banner / pre-consent loading**: verified — `apps/web` ships no analytics SDK at all (grep
  for common providers returned nothing); the cookie banner's copy matches reality. No issue found.
- **Legal pages**: Impressum/AGB/Datenschutz/Widerruf exist (S3-01) with real business data from
  `settings.business`. Not reviewed for legal *correctness* of the text itself (out of scope — that is
  a legal-advice question, not a security one).

## 7. Co-tenant hygiene (re-verified against `/memory/infra-access.md`)

Reviewed `apps/infra/docker-compose*.yml` and `.github/workflows/ci.yml`'s own
"Staging compose respects co-tenant terms" check (greps the rendered compose for `0.0.0.0` binds and
out-of-range published ports, fails the build otherwise): every published port is in `8200-8299` and
bound to `127.0.0.1`; nothing in the repo attempts to write outside `/home/shos` (deploy paths in
`_deploy.yml` are all under the ssh user's home) or to invoke `sudo`. The ssh key
(`STAGING_SSH_KEY`) is used only by `_deploy.yml` (CI), never referenced elsewhere, matching
"deploy key used only by CI." **This review only inspected our own repo/config — it did not probe the
shared host, TETA+PI's ports, or hellfire's services, per boundary.**

## 8. What this pass did not cover

- No live Stripe test payment exists yet (no Stripe account — D-011/S2-02 status unchanged); the
  money-path review in §5 is static-code review plus the existing recorded-event-fixture test suite,
  not a live financial walkthrough.
- The back-office is not yet on a public host (`bo.shos.hellfiresol.com` DNS not yet live) — its
  public-facing posture (TLS, access gate) is S1-04's job, not re-verified here beyond the findings
  above.
- No penetration test of the deployed staging site's network/TLS layer was performed beyond reading
  response headers over HTTPS from this machine (§5 web-surface findings) — this is a code/config
  review, not a live external pentest.

**S7-02 (2026-10-15) could not reach a live Supabase instance in its environment** — no Docker
daemon was running, `colima start` needed `qemu-img` (not installed), and building `qemu` from
source via Homebrew (no bottle for this host's macOS version) was abandoned after ~25 minutes with
no realistic finish time; the owner's rotated staging credentials are deliberately out of this
session's reach per this boot's own boundary. Every conclusion in §2.1/§5 that says "confirmed" or
"checked" is a **static trace** — the actual grant/policy/function text, read against the live
migration order (`create or replace` supersedes, so a few findings in old proposal files turned out
to already be fixed by a later migration the filer hadn't re-checked) — not a fresh request against
a running project with a role's JWT. Two places this matters most, both already flagged inline:
the `customer_stats`/kitchen-JWT check in §2.1, and the non-staff-authenticated regression test in
§5, which this boot recommends rather than runs. The existing test suite (`rls.test.ts`,
`security.test.ts`) already *does* this kind of live-JWT checking in CI and its assertions are
cited by file:line throughout this pass — that is real evidence, just not evidence this boot
produced fresh.
