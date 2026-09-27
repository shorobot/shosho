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
| `settings` | public keys only (`settings_public_keys()`) | public keys only | public keys + `ops`/private read (`settings_staff_read`); no write | full read/write | all |
| `staff` | none | own row only | own row + staff list read | full read/write | all |
| `customers`, `customer_addresses` | none (only via `place_order`/`get_order_by_token`) | none | full | full | all |
| `orders`, `order_items`, `order_events` | none directly | kitchen: read all; driver: read own (`driver_id = auth.uid()`) only | full | full | all |
| `promo_codes` | none | none | full | full | all |
| `payment_events`, `payment_jobs`, `customer_events` | none | none | read-only (no write policy exists for anyone — writes are trigger/RPC/service-role only) | read-only | all |
| `storage.objects` (bucket `menu`) | public read | public read | read + write (`is_staff('owner','operator')`) | read + write | all |
| `realtime.messages` (topic `order:%`) | read, scoped to the exact topic the client subscribes to — see §3 | same | same | same | all |

No table in `public` is missing `ENABLE ROW LEVEL SECURITY`; `storage.objects` and
`realtime.messages` (owned by Supabase's own extensions, not our migrations) are asserted — not
assumed — to have RLS on, by `security.test.ts`.

### RPCs / Edge Functions (EXECUTE grants, verified live via `pg_proc`/`has_function_privilege`)

| Function | anon | authenticated (staff) | service_role |
|---|---|---|---|
| `quote_order`, `place_order`, `get_order_by_token`, `shop_open_at`, `normalize_phone`, `auth_role`, `is_staff`, `settings_public_keys`, `menu_item_on_sale` | ✅ | ✅ | ✅ |
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

## 5. Findings needing another session (see `/memory/log.md` S7-01 for the ranked list; proposals in `/memory/boots/proposed/`)

- **CRITICAL — `place_order` accepts a client-supplied `payment_status` of `authorized` with no
  relationship to `payment_method` or any real Stripe event.** An anonymous caller can place an order
  with `payment_method: 'card', payment_status: 'authorized'` and have it marked `paid` at delivery
  with zero real payment (`apps/backend/supabase/migrations/20260920000010_rpc.sql:435-442,533-547`;
  `20260921000015_set_order_status_payments.sql:110-116`, the "v1 client-reported payment" branch).
  This is contract-level (documented in `api-contracts.md` §5.3 as v1 behaviour, superseded in intent
  but not enforcement by §5.6/D-011) and touches a large, actively-tested S2-owned function — filed to
  S2, not fixed here. See `/memory/boots/proposed/S7-02-S2-payment-security-fixes.md`.
- **Medium/High — a `payment-worker` refund job can be duplicated** if the process crashes between a
  successful `stripe.refunds.create()` call and `finish_payment_job` recording it: the retry gets a
  new idempotency key (`job:<id>:<attempt>`), and unlike `capture`/`void`, `refund` never re-checks
  Stripe for "did this already happen" before acting again
  (`apps/backend/supabase/functions/payment-worker/index.ts:52-58`). Filed to S2.
- **Low — `payment-worker` accepts any valid project JWT** (including the public anon key) with no
  in-function service-role check; by design (cron calls it via a Vault-stored anon key) but widens the
  callable surface further than necessary. Filed to S2.
- **Low — `tracking_token` compared with `!==`** in `create-payment-intent`, not constant-time
  (`apps/backend/supabase/functions/create-payment-intent/index.ts:57`); low practical risk given 128
  bits of entropy. Filed to S2.
- **Medium — security headers (CSP, HSTS beyond Cloudflare's 1-day default, X-Frame-Options,
  Referrer-Policy, Permissions-Policy) are not set by either Next.js app**; the back-office in
  particular is clickjacking-able with no CSP. Filed to S3 (web) / S4 (backoffice).
- **Medium — back-office open redirect**: `LoginForm.tsx`'s `?next=` handling accepts
  `//evil.example` (passes a bare `startsWith("/")` check, which a protocol-relative URL also
  satisfies). Filed to S4.
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
- **High — the four staff seed accounts share one password, published in a public repo's
  README** (`apps/backend/README.md`), and will soon sit behind a public URL
  (`bo.shos.hellfiresol.com`, S1-04). Rotate before that URL is announced; see S1-04's own
  pre-conditions list and the coordination note in S7-01's log entry.
- **Low — six `SECURITY INVOKER` functions don't pin `search_path`** (`set_updated_at`,
  `current_actor`, `orders_before_status_change`, `settings_public_keys`, `normalize_phone`,
  `order_transition_allowed`). Not an active privilege-escalation vector (invoker functions run with
  the caller's own privileges), but inconsistent hygiene — low priority for S2 whenever these
  functions are next touched.

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
