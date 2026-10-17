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
  (`bo-shos.hellfiresol.com`, S1-04). Rotate before that URL is announced; see S1-04's own
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
- The back-office is not yet on a public host (`bo-shos.hellfiresol.com` DNS not yet live) — its
  public-facing posture (TLS, access gate) is S1-04's job, not re-verified here beyond the findings
  above.
- No penetration test of the deployed staging site's network/TLS layer was performed beyond reading
  response headers over HTTPS from this machine (§5 web-surface findings) — this is a code/config
  review, not a live external pentest.

## 9. The automation / agent privilege boundary (S7-03, step C2 of `/memory/plan.md`)

Ruling, not implementation — `apps/automation` does not exist yet (D-020). This is the boundary S2
(step C1, schema), S5 (step C3, orchestrator) and S1 (step C5, deploy) build to. Everything SHOSHO has
shipped before this is `anon`-key only; this is the first component to hold a privileged credential on
the host at all, which is why `_deploy.yml:148-155` stopped rendering one in 2026-09-27 (D-013) rather
than carrying an unused one forward.

### 9.1 Database identity — a dedicated non-`BYPASSRLS` role, never `service_role`

**Ruling: a dedicated Postgres role (`agent` below as a working name), not `service_role`, and not
per-agent roles yet.** `service_role` bypasses RLS entirely — every policy S7-02 swept, every
`is_staff()` guard, every column grant (`settings.draft`'s own leak was a column-grant gap, not a
missing policy) stops applying the instant that key is used. Handing an LLM-driven process that key
means its entire blast radius, on a bug or a successful prompt injection (§9.5), is "anything
`service_role` can do" — the whole schema. A role with explicit, enumerated grants and
`rolbypassrls = false` makes the blast radius "whatever was actually granted," which is the only
version of this that stays true after the schema has grown for another year and nobody remembers what
the orchestrator was supposed to be able to touch.

**This is a different connection shape, not just a different key, and the schema side needs to know
that.** `apps/automation/.env.example` asks for both a `SUPABASE_*` key pair and a `DATABASE_URL`. The
existing RLS policies (`is_staff('owner','operator')` and friends) are keyed on `auth_role()`, which
reads `auth.uid()` — a GUC PostgREST sets per-request from the caller's JWT
(`20260920000002_settings_staff_zones.sql:41-49`). **A role connecting over a direct Postgres
connection (`DATABASE_URL`, no PostgREST in front of it) has no JWT and so no `auth.uid()`** — every
`is_staff()` check evaluates `null`, which `coalesce(..., false)` turns into `false` for everyone,
agent included. So the agent role cannot piggy-back on staff policies even if someone wanted it to;
S2 has to write new policies keyed on `current_user = 'agent'` (or `pg_has_role(current_user, 'agent',
'member')` if the role ever gets sub-roles), parallel to the staff ones, not layered on them. That is
a feature, not friction — it keeps "is staff" and "is agent" from ever being conflatable by accident,
which matters once §9.5 asks what an agent may never do regardless of what it was told to do.
Concretely, this also means `SUPABASE_SERVICE_ROLE_KEY` should come out of `.env.example` entirely,
and whether `SUPABASE_ANON_KEY` is still needed (e.g. to call an existing RPC the same way a guest
does) is a question for whoever writes the orchestrator's actual Supabase calls, not assumed here.

**What each D-020 agent actually needs — enumerated, not assumed, since "the orchestrator needs the
service role" was exactly the untested assumption this task exists to check:**

| Agent | Reads | Writes | Notes |
|---|---|---|---|
| **Accounting** (#1, D-020) | `orders`, `order_items`, `payment_events`, `payment_jobs`, `settings` (business/tax keys) | nothing in the live schema — its output is a report, which is an agent-run artifact (§9.6), not a write to `orders`/`payment_*` | D-019 settled the VAT model this agent reports against; it must never be the thing that *decides* a VAT rate, only report what was already charged |
| **Grow** (#2) | `orders`, `order_items`, the `report_*` RPCs' underlying tables, `campaigns`/`automations` | nothing | analytics only; D-015 already forbids building new client-side collection for it — this does not relax that |
| **Warehouse** (#3, blocked on C8 — no ingredient/recipe/stock schema exists) | whatever C8 builds | **stock quantity columns only**, once C8 exists — never price, never the recipe/BOM definition itself | the schema does not exist, so this is a placeholder grant shape for whoever writes C8's RLS, not a present grant |
| **Sales** (#10, blocked on D1/D-017) | nothing from this DB for DM content (that is Meta's API, external) | a **drafts** table only (does not exist yet) — never `orders`, `customers`, or `place_order` directly | see §9.5 — this is the one agent reading attacker-controlled text, and the narrowest agent in the set for exactly that reason |
| **Quality** | — | — | deferred by the owner (D-020); no grant to design |

**Universally revoked for the `agent` role, regardless of which agent is running:** `staff` (PII,
owner/operator-only — see §9.4), any DDL privilege, `DELETE` on anything, and every money-bearing
column on `orders`/`payment_events`/`payment_jobs` (`payment_status`, `payment_authorized_cents`,
`payment_captured_cents`, `payment_refunded_cents`, `total_cents`) — the exact columns §5's CRITICAL
finding was about a client reaching through `place_order`. **An agent is a client too**, and the fix
S2 is about to ship for that finding (trust nothing payment-shaped from the caller) is the same fix
this role's grants enforce structurally: the `agent` role should not be able to write those columns
even if the orchestrator's code has a bug that tries.

**Consequence for S2's C1 schema, flagged now rather than discovered after both land in parallel.**
`automations`/`automation_runs` (migration 28) and whatever C1 adds grant writes to `service_role`
implicitly (RLS doesn't apply to it) and give staff read-only policies. Once the `agent` role exists,
C1's registry/run/queue/log tables need **their own insert/update policies for `agent`**, written
against `current_user`, not inherited from anything already there — S2-08's boot was deliberately
written not to care how the writer authenticates, which was the right call for sequencing but means
this grant work is still outstanding. Proposed to S2 as `proposed/S7-03-S2-agent-role-grants.md`.

### 9.2 Does the secret live in `.env` on that host at all

**Ruling: yes, both the DB credential and the Anthropic key end up in a `.env` on the shared droplet,
because there is no alternative host for a Python/FastAPI process (D-001/D-020) and the control that
actually matters is what's in §9.1 and §9.3 — the role's grants and the key's ceiling — not where the
bytes sit.** Weighed honestly against the alternatives before landing here:

- **Keep the privileged work in a Supabase Edge Function, which already holds its own Vault-stored
  secret** (the exact pattern `payment-worker` uses for its anon key) **— rejected for now, not
  dismissed.** It would take the DB credential off our droplet entirely, onto infrastructure Supabase
  administers rather than TETA+PI. But D-020 is explicit that the orchestrator is a native Python/
  FastAPI service using the Claude Agent SDK, and Edge Functions are Deno/TypeScript — moving the
  privileged half there would split the orchestrator across two runtimes for a security property,
  which is an architecture change outside this boot's boundary (design and rule, not re-litigate
  D-020). If the shared-host terms ever get tighter than `infra-access.md`'s current ones, this is the
  alternative to revisit first.
- **A narrower DB role (§9.1) whose leak is survivable — adopted, and it is the reason "the secret
  lives in `.env`" is an acceptable answer rather than a forced one.** The file disclosure risk is
  unchanged by this ruling; what changes is what disclosure *buys* an attacker. A leaked `agent`
  connection string gets read access to orders and reports and write access to stock quantities. It
  does not get `staff`, does not get DDL, does not get the service role's run of the schema.
- **A secrets manager / Vault on the host — not available.** D-004: no sudo, no root, 512M cap,
  TETA+PI administers the box. Nothing beyond file permissions and uid isolation is ours to add.

**What actually protects the file, unchanged from every other secret `_deploy.yml` has ever rendered:**
`chmod 600`, owned by `shos`, written over an SSH connection authenticated by a key that never leaves
the owner's Mac (`STAGING_SSH_KEY`), never echoed to a log (the heredoc pattern `_deploy.yml` already
uses). **What is new and worth saying plainly: this is the first time that file has held a secret with
a real capability behind it.** Today's rendered `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_*`) is, by design, entirely public-safe values — a stranger could request every line of it
from any browser's dev tools, which is the whole point of the anon key. Adding the `agent` DB
credential and the Anthropic key changes that file from "nothing here is secret" to "this is a real
secret, scoped and capped" — a qualitatively different thing to get right, which is why §9.7 makes it a
checklist rather than a sentence.

**Blast radius if that file is read** (by a bug in our own container, a TETA+PI admin acting in bad
faith, or — the scenario D-004 exists to isolate against — another co-tenant escaping its own cgroup):
read/write per the grants in §9.1's table, and unmetered Anthropic spend until the ceilings in §9.3
catch it or the key is rotated. **Rotate both credentials on any suspected host compromise or
co-tenant incident**, the same trigger `infra-access.md`'s revocation clause already names for the SSH
key — this is not a new process, it is two more credentials added to an existing one.

### 9.3 The Anthropic key — a spend credential, scoped, rotated, and capped before anything calls it

**The failure this prevents, named concretely:** a bug in the orchestrator's retry logic, or a
successful prompt injection (§9.5) that gets an agent to re-invoke itself in a loop, calls the Claude
API with no circuit breaker in front of it, and the owner discovers the cost on next month's Anthropic
invoice — the same shape of exposure D-016 named for SMS pumping, with no OTP-style per-identifier
throttle available because there is no "identifier" here smaller than "the whole automation layer."

- **Scope:** a key created for this host only (D3, owner's action — S7 rules on treatment, never
  provisions or sees the value, per boundary). Not reused from any other Anthropic account/workspace
  the owner holds.
- **Per-run ceiling:** enforced **in the orchestrator's code**, not the database — S2's C1 run record
  gives it somewhere to persist cost *after* a call, but a ceiling that only checks after the money is
  spent is not a ceiling. The orchestrator must track running cost for the current run and refuse to
  issue another model call once the run's configured ceiling (a column on the agent registry row,
  which C1 already has reason to carry) is hit, failing the run closed rather than open.
- **Per-day ceiling:** same placement, summed across all runs/agents for the day before starting a new
  one — a `select sum(cost) from agent_runs where started_at > today` style check at the top of the
  orchestrator's dispatch loop, not a Postgres trigger (the DB should not need to know what "a day" is
  for billing purposes; that is application logic).
- **Backstop, not the control:** the owner should also set a workspace-level spend limit in the
  Anthropic console as the outer ceiling — exactly the role Cloudflare/Turnstile plays for D-017's SMS
  numbers: the per-run/per-day figures are the thing that should fire first, the console limit is what
  fires if they don't.
- **Alarm and audience:** there is no outbound transport (D-017 — still true, see §9.4) so the alarm
  cannot be an email or a push. It has to be a surface the owner/operator already checks — a spend
  figure on S4's C4 back-office dashboard (it already reads `agent_runs` for status; a running total and
  an "approaching ceiling" banner are the same read), visible to owner/operator, same role matrix as
  everything else in this document.
- **Rotation path:** owner generates a new key in the Anthropic console → updates the GitHub Secret
  (`STAGING_ANTHROPIC_API_KEY`, same `secrets[format('{0}_ANTHROPIC_API_KEY', inputs.secret_prefix)]`
  shape every other secret in `_deploy.yml` already uses) → redeploy renders it → **revoke the old key
  in the console only after a run has used the new one**, not before, so a rotation never produces a
  gap where neither key works mid-deploy.

### 9.4 What an agent may never do, and where that is actually enforced

| May never | Enforced by | Honest caveat |
|---|---|---|
| Run DDL | `agent` role has no `CREATE`/`ALTER`/`DROP` grant at all | real control — role-level, not code |
| Write a money column on `orders`/`payment_events`/`payment_jobs` | column-level `REVOKE UPDATE` on those specific columns from `agent` (same mechanism S2-08 needs for `settings.draft`'s fix) | real control |
| Delete anything | no `DELETE` grant on any table for `agent` | real control |
| Read `staff` | no `SELECT` grant, no RLS policy referencing `agent` | real control |
| Alter its own (or another agent's) registry row — ceiling, `active` flag, config | no `UPDATE` grant on the agent registry table for `agent` | real control, and the one that makes §9.3's ceiling mean anything — a ceiling an agent can edit is not a ceiling |
| Send anything to a customer | **nothing** — D-017 means no transport exists to send through | **convention only, and not actually a control.** The moment any transport ships (push, SMTP), this line item must become an explicit code-level gate plus, per §9.5, a human-confirmation step for Sales specifically — it does not become safe by continuing to not exist |
| Touch `/etc/nginx/.htpasswd-shos-bo` or any host file outside its own app directory | container filesystem isolation — the automation container must ship with **zero host bind mounts** beyond its own code/working directory (checklist item, §9.7) | real control *if* S1 configures the compose service with no extra mounts; `infra-access.md`'s "attempts are logged" is detection, not prevention, and should not be counted as the control |

### 9.5 Prompt injection — the new threat class, tied to §9.1's identity ruling

Every input SHOSHO has trusted so far is a typed RPC payload with a server-side guard — a guest's
`place_order` call, a staff member's form submission. **Sales (D-020) is specified to read Instagram
and Facebook DMs; Warehouse will read supplier documents. Both are free text written by someone
outside the system, driving a process that holds a privileged DB credential.** That is a genuinely new
shape of input and deserves a genuinely new rule, not an extension of "validate the payload."

**The mitigation is not "train the agent to recognise injected instructions."** That is a prompt-
engineering convention — worth doing (delimit untrusted content explicitly, instruct the model in the
system prompt to treat it as data to summarise rather than commands to follow) — but it is not a
control, because it can be defeated by a sufficiently clever message and there is no way to prove it
can't be. **The actual control is that a successful injection should not be able to do anything the
`agent` role's grants (§9.1) don't already allow, and should not be able to do anything externally
visible without a human in the loop.** This is why §9.1's narrower-role ruling is the load-bearing
decision in this boot: the smaller the role, the smaller the set of actions an injected agent can take
regardless of how completely it was fooled.

**Tiered action model:**
- **Tier A — read and summarise.** Reading a DM, extracting intent, drafting a reply in memory. Safe
  regardless of injection content, because nothing external happens yet. Autonomous.
- **Tier B — write to an append-only, non-live table.** A drafted order, a drafted reply, a logged
  observation — written to tables an agent can `INSERT` into but never `UPDATE`/`DELETE` (§9.4), and
  that nothing downstream treats as committed fact. Autonomous, because the write is reversible by
  construction (it is a draft, not a live row) and is itself the audit trail §9.6 needs.
- **Tier C — anything externally visible, financially consequential, or that promotes a draft into
  live state.** Sending a reply, turning a Sales draft into a real order, writing a stock adjustment
  past whatever threshold C8 sets. **Requires an explicit human action** — a back-office operator
  clicking "approve," which is the only path that calls the already-existing trusted entry point
  (`place_order`, same as a guest or staff member would) rather than a new privileged write-path
  invented for agents. The agent is a client to that RPC, exactly like the free-order vector in §5 —
  it gets no shortcut around the same trust boundary S2 is fixing there.

**Where each half is enforced, stated honestly:** the A/B/C classification itself is **code** in the
orchestrator (S5) — a bug in that logic is possible and this is not claimed to be airtight. The backstop
is **structural**: Tier C actions correspond to grants/EXECUTE rights the `agent` role does not have
(§9.1, §9.4), so a misclassified Tier-C action doesn't merely get flagged wrong, it gets refused by
Postgres regardless of what the orchestrator's code decided.

### 9.6 Ordinary wrongness — not compromise, just wrong

An agent will produce a wrong number before it is ever maliciously manipulated — a bad total in a
Steuerberater report, a stock figure drifting from reality, an invented food cost. None of that needs
an attacker.

- **Reversible by construction:** anything written as a draft (§9.5 Tier B) — a report, a stock
  adjustment, a reply — stays reversible for as long as it is unapplied. The failure mode to design
  against is a draft being *treated* as live before a human looked at it, not the draft existing.
- **Append-only audit:** every run and every log line, win or lose, lands in C1's `agent_runs`/logs —
  and per §9.4, the `agent` role itself must not be able to `UPDATE`/`DELETE` its own run history, or
  the audit trail is only trustworthy until the thing being audited decides to edit it.
- **Human-confirmed before it counts:** this is the gap. **C1's run records answer "what happened
  during a run" — they do not answer "is this number currently trusted."** A run can complete
  successfully and log a wrong figure; nothing in the registry/run/queue/log shape S2-08 is building
  distinguishes "the agent concluded X" from "a human has looked at X and it stands." That needs a
  status field — pending / approved / rejected, with a reviewer and a timestamp — on whatever an agent
  *produces* (a report, a draft), separate from the record of the run that produced it. **This is
  missing from C1's stated scope and is flagged to S2 now, not discovered after S5 builds against the
  gap** — proposed as part of `proposed/S7-03-S2-agent-role-grants.md`.

### 9.7 Pre-flight checklist for S1 at step C5

C5 is blocked on this ruling. Before any key is provisioned or wired in:

1. Confirm the two secrets to be rendered are **`AUTOMATION_DATABASE_URL`** (the dedicated `agent`
   role from §9.1 — never `SUPABASE_SERVICE_ROLE_KEY`) and **`ANTHROPIC_API_KEY`** (scoped per §9.3).
   If either `.env.example` or the compose file still names `SUPABASE_SERVICE_ROLE_KEY` at this point,
   stop and check with S7/S0 — it means this ruling wasn't carried through.
2. Verify directly against Postgres (`select rolbypassrls from pg_roles where rolname = 'agent'`) that
   the role is **not** `BYPASSRLS` and is not a member of any role that is, before wiring its
   connection string into CI.
3. Add GitHub Secrets in the same `secrets[format('{0}_X', inputs.secret_prefix)]` shape every other
   line in `_deploy.yml` already uses — `STAGING_AUTOMATION_DATABASE_URL`, `STAGING_ANTHROPIC_API_KEY`
   — no new secret-handling pattern.
4. Re-add the automation service to `docker-compose.staging.yml`, sized from measurement (D-013's own
   instruction), with **zero host bind mounts** beyond its own app directory — no `/etc`, no other
   service's volume — which is what actually enforces §9.4's "no touching host files" line.
5. **Rewrite `_deploy.yml:148-155`'s D-013 comment.** It currently tells a future reader to "restore
   them next to the api service" — the `api` service it means no longer exists (D-013 removed it), so
   that sentence will mislead whoever acts on it next. Replace the last two sentences with:
   > When restoring secrets for `apps/automation` (D-020/S7-03): render `AUTOMATION_DATABASE_URL` (the
   > dedicated, non-`BYPASSRLS` `agent` Postgres role — never `SUPABASE_SERVICE_ROLE_KEY`) and
   > `ANTHROPIC_API_KEY` (scoped, rotated and capped per `docs/security.md` §9), in the same
   > `secrets[format(...)]` shape as the lines below.
6. Confirm the per-run/per-day ceiling (§9.3) is actually wired into the orchestrator's dispatch loop —
   exercised in a dry run, not just present in code — before any schedule/cron triggers a real run.
7. Confirm the back-office spend banner (§9.3) is visible to owner/operator before go-live.
8. GHCR auth for the automation image follows the existing login-via-stdin pattern (`_deploy.yml:178`)
   — no secret on a command line.
9. S0 verifies this list against the actual PR before C5 is reported done — this ruling exists because
   retrofitting it after the orchestrator works is the expensive order, and a checklist nobody checks
   is that retrofit by another name.
