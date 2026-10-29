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

**The table above is the ROW picture only — it is not the COLUMN picture, and as of this sweep
(S7-04, 2026-10-29) they disagree for five of these rows.** `delivery_zones`, `menu_categories`,
`menu_items`, `option_groups` and `options` carry a correct `anon`-admitting row policy and an
**unnarrowed** column grant, so `anon` reads every column of every admitted row — `menu_items`
worst of all (`cost_cents`, `kitchen_note`, `station`, `vat_delivery_pct`, `vat_onsite_pct`,
`stock_remaining`, `available`, `stoplist_until`). `settings` is the one row in this group already
narrowed for `anon` (migration 32) — see rule 10 below for the `authenticated` side of that same
table, which this sweep also closes. Full measurement, exact grants and the fix S2 must apply (a
plain rewrite of `menu_items_on_sale` would have broken the storefront) are in §5.

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
| `menu_items_on_sale` (migration 8) | `true` (ruled to become `false` — §5, D-025) | `menu_items` only | `items_staff_read` (owner/operator/kitchen full catalogue) / `items_public_read` (anon/driver: on-sale only) | **Safe from the join-composition risk this row checks** — single-table view, nothing to compose against. **Not safe on the separate column-exposure axis**: today's `select i.*` hands `anon`/`authenticated` every `menu_items` column, `cost_cents` included (§5). S7-04 ruled the fix (explicit column list, `security_invoker = false`, same pattern as `staff_directory`/`banners_live` below); not yet applied — S2's. |
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
10. **"Every `to authenticated` policy carries an explicit staff guard" is false as stated — the
    true invariant has a named exception.** The customer-accounts ROADMAP claimed the backend was
    "safe by construction against a second class of authenticated user" on the strength of that
    sentence. Swept live (S7-04, 2026-10-29): every `to authenticated` policy in `public` is one of
    three shapes — (a) an explicit `is_staff(...)` / `auth_role() is not null` guard (the large
    majority); (b) a **self** guard bound to the caller's own identity (`staff_self_read`'s
    `id = auth.uid()`, `customer_addresses_self_read`'s `customer_id =
    current_customer_id()`) — safe for a different reason, not because it checks staff, but
    because it can only ever return the caller's own row; (c) **`settings_public_read`** — `using
    (key = any (settings_public_keys()))`, admitting `anon, authenticated` with neither guard. That
    is the one real exception, and it bites specifically through a column grant: `authenticated`'s
    unnarrowed table grant on `settings` includes `draft`, so *any* authenticated role — kitchen,
    driver today (a separate, already-filed, still-open Medium finding below), **any customer once
    phase B exists** — reads it on the same rows `settings_public_read` admits (D-024). Fixed for
    the customer case this sweep by narrowing the POLICY, not the column grant: `settings_public_read`
    now reads `to anon` only (§5) — column grants are per-role, not per-`staff.role`, so they could
    never have separated "owner/operator" from "any other authenticated" within the one `authenticated`
    role; only the row policy can. Restate the invariant this way, not as "every policy has a guard".
## 5. Findings needing another session (see `/memory/log.md` S7-01/S7-02 for the ranked lists; proposals in `/memory/boots/proposed/`)

- **High, by design — staging/seed data, not a live breach (D-025): `anon` can read every column
  of five publicly-readable tables, `menu_items.cost_cents` worst of all.** RLS is row-level, not
  column-level (rule 8); these five tables have a correct row policy and an **unnarrowed** column
  grant, so `anon`'s blanket table grant hands it every column of every admitted row —
  `delivery_zones`, `menu_categories`, `menu_items`, `option_groups`, `options`. Confirmed live
  against the deployed staging anon key:
  `GET /rest/v1/menu_items?select=sku,base_price_cents,cost_cents` → `200`, real seed margins
  (Onigiri Trio 750/**210**, Misosuppe 320/**60**, Wakame-Salat 450/**90**) — plus, beyond what
  D-025 first measured, `kitchen_note`, `station`, `vat_delivery_pct`, `vat_onsite_pct`,
  `stock_remaining`, `available`, `stoplist_until` all leak the same way. **Controls, paired with
  every probe**: a misspelled column → `42703`; a nonexistent table → `PGRST205`/404; `settings`'s
  already-narrowed `draft` (migration 32) → `42501` — three distinct signatures, so "the request
  failed" is never ambiguous with "the request leaked." `customers`/`orders` still return `[] 200`
  (row-level, unaffected, re-confirmed as the control D-025 used). **Scope, stated plainly**:
  staging with seed data — the leaked numbers are fictional, the mechanism is real, production
  would ship the same schema. Fix before production; not an incident now.

  **Ruling (S7-04): narrow by column grant, mirroring migration 32's own shape exactly** — per
  table, the public set is whatever `apps/web/lib/api-supabase.ts` actually names (`ITEM_COLUMNS`,
  the zones/categories/options selects), on the principle that a column no public consumer names
  is not public. Verified column-by-column against that file, not guessed:

  ```sql
  revoke all on table public.delivery_zones from anon;
  grant select (code, name, areas, min_order_cents, fee_cents, free_delivery_over_cents,
    promised_minutes, postal_codes) on public.delivery_zones to anon;
  -- not public: id, active, created_at, updated_at (named by no anon consumer; "active" is already
  -- redundant for anon, since zones_public_read's row filter already admits only active=true rows)

  revoke all on table public.menu_categories from anon;
  grant select (id, slug, name_de, name_en, name_ja, sort, schedule) on public.menu_categories to anon;
  -- not public: active, created_at, updated_at

  revoke all on table public.menu_items from anon;
  grant select (id, sku, category_id, name_de, name_en, name_ja, transliteration, description_de,
    description_en, base_price_cents, photos, tags, prep_minutes, allergens, weight_g,
    kcal_per_100g, sort, recommended_item_ids, max_per_order) on public.menu_items to anon;
  -- not public: cost_cents, kitchen_note, station, vat_delivery_pct, vat_onsite_pct (see below),
  -- stock_remaining, available, stoplist_until, created_at, updated_at

  revoke all on table public.option_groups from anon;
  grant select (id, name_de, name_en, min_select, max_select, required) on public.option_groups to anon;
  -- not public: shared, created_at, updated_at

  revoke all on table public.options from anon;
  grant select (id, group_id, name_de, name_en, price_cents, sort, active) on public.options to anon;
  -- group_id is kept: PostgREST's nested embed (menu_item_option_groups -> option_groups ->
  -- options) filters the inner subquery on options.group_id, which needs SELECT on that column for
  -- the embed to resolve at all, independent of whether it appears in the JSON output. Proven live
  -- below, not assumed.
  ```

  **A fifth statement is required, or the storefront's own menu goes blank** — found only by
  proving the fix, not by reading the migration. `apps/web` never queries `menu_items` directly;
  it queries the view `menu_items_on_sale` (`security_invoker = true`, body `select i.*`). A
  `security_invoker` view's defining query is ordinary SQL text, evaluated under the *caller's* own
  column privileges (unlike an RLS `USING` clause, which is evaluated by the executor without that
  check — confirmed by the proof below) — so `i.*` requires `anon` to hold SELECT on **every**
  column of `menu_items`, and the column grant above makes that query fail outright, not fall back
  to the columns `anon` still has:

  ```sql
  drop view public.menu_items_on_sale;
  create view public.menu_items_on_sale
  with (security_invoker = false, security_barrier = true)
  as
  select i.id, i.sku, i.category_id, i.name_de, i.name_en, i.name_ja, i.transliteration,
         i.description_de, i.description_en, i.base_price_cents, i.photos, i.tags, i.prep_minutes,
         i.allergens, i.weight_g, i.kcal_per_100g, i.sort, i.recommended_item_ids, i.max_per_order
  from public.menu_items i
  where public.menu_item_on_sale(i);
  grant select on public.menu_items_on_sale to anon, authenticated, service_role;
  ```
  Same shape as `staff_directory`/`banners_live` (§2.1): the view runs as its owner (full
  internal access, so `menu_item_on_sale(i)`'s whole-row argument and the on-sale filter keep
  working), exposes an explicit column list instead of `i.*`, and the grant that matters moves
  from the base table to the view itself. `menu_items`' own base-table narrowing above still stands
  — it is what closes the direct `GET /rest/v1/menu_items?select=...cost_cents` route D-025 found,
  which the view was never the path for.

  **All of this was proved, not reasoned about, against a disposable local sandbox — PG16.2 via
  the `pgserver` wheel, all 35 migrations plus the committed `seed.sql` applied unmodified, zero
  writes to staging** (`reference-local-postgres-on-this-mac` memory; `set role anon` /
  `set role authenticated` + `request.jwt.claims` to simulate each caller, matching what
  PostgREST itself does). Specifically proved, not assumed:
  - Pre-fix: `set role anon; select sku, cost_cents from menu_items` reproduces the exact staging
    leak locally.
  - Post-fix: the same query now errors `permission denied for table menu_items`; `apps/web`'s own
    `ITEM_COLUMNS` list still returns full rows through `menu_items_on_sale`; asking the view for
    `cost_cents`/`kitchen_note` by name now errors `column … does not exist` (stronger than a
    permission error — the column isn't in the view at all, same shape as `banners_live`'s `draft`
    exclusion); `select *` on the view returns only the public columns (closes a *future* column
    added to `menu_items` the same way, not just today's); the on-sale filter still excludes the
    one off-sale seed item (13 of 14, behavioural, not just "no error"); the exact nested-embed
    query apps/web issues for option groups/options resolves correctly with `options.group_id`
    granted; `apps/backoffice/components/orders/PhoneOrderDialog.tsx`'s own `menu_items_on_sale`
    query (`id, name_de, name_en, base_price_cents`, as a simulated `authenticated` operator)
    is unaffected.
  - **Not verified**: the five `revoke`/`grant` statements above were not additionally proved
    against the *live* staging database (boundary: anon key only, no writes to staging) — the
    sandbox used the same migrations, the same committed seed, and the same Postgres major
    behaviour for grants/RLS (16.2 vs staging's 17, stated rather than glossed, per the sandbox's
    own documented caveat) but is not staging itself. S2 should re-run the two probes above
    (`cost_cents` refused, `ITEM_COLUMNS` still returns rows) against the deployed project
    immediately after applying the migration, before calling it closed.

  Filed to S2 for implementation (D-012); this ruling is the full statement, not a pointer to a
  separate proposal file.

- **This sweep also closes D-024's phase-B blocker — `settings.draft` reachable by any
  authenticated role, customers included — by narrowing the POLICY, not a column grant.**
  `settings_public_read` (`for select to anon, authenticated using (key = any
  (settings_public_keys()))`) is the one `to authenticated` policy with neither an `is_staff(...)`
  guard nor a self-scoped one (rule 10). Column grants cannot fix this alone, confirmed by reading
  `apps/backoffice/lib/siteStore.tsx:77` (`supabase.from("settings").select("*")`, run as the
  logged-in staff member's own `authenticated` session): `authenticated` is one Postgres role
  shared by owner, operator, kitchen, driver and — once phase B ships — every customer, so revoking
  `draft` from that role's column grant would 42501 the CMS settings panel for owner/operator too,
  not just for the role this is meant to stop.

  **Ruling: scope the row policy instead.**
  ```sql
  alter policy settings_public_read on public.settings to anon;
  ```
  `settings_staff_common_read` (migration 21, `using (auth_role() is not null and key = any
  (settings_staff_keys()))`) already admits every real staff role — owner, operator, kitchen,
  driver — to these same rows plus `ops`, so staff read nothing less after this change. A non-staff
  authenticated caller (a future customer) now matches **no** `to authenticated` policy on
  `settings` at all: RLS blocks the row before `authenticated`'s column grant (which still, and
  correctly, includes `draft` for the staff who need it) is ever reached.

  **Proved in the same local sandbox**, simulating a customer-shaped JWT (`authenticated`, `sub`
  not present in `staff`): before the fix, `select key, value, draft from settings` returns the
  five public rows including `draft`; after, zero rows. A simulated kitchen session still reads
  exactly `business`/`opening_hours`/`site`/`payments.enabled`/`kitchen.status`/`ops` — including
  `draft` where pending, **unchanged** — and a simulated owner session still reads every key
  including `payments`/`kitchen`. `anon` is untouched (still the public five, `draft` still
  refused). **Not independently re-verified against live staging** — same caveat as above; also,
  no real customer JWT exists to test with yet (phase A ships no login), so "customer" here means
  a role-`authenticated` session with no matching `staff` row, which is the exact shape phase B
  creates and the shape `settings_staff_common_read`'s own `auth_role() is not null` guard is
  written to exclude.

  **This does not touch the separate, already-filed Medium finding below** (kitchen/driver reading
  `draft` on the rows they're staff-admitted to) — that is a different `authenticated` sub-population
  (real staff, not a future customer) and still needs the `security definer` accessor sketched
  there; nothing in this ruling widens or narrows that finding.

- **Noted for S2, not acted on (boundary: rule and audit only) — `menu_items.vat_onsite_pct` is
  exposed by the same mechanism above and is also dead code (D-019/B3: nothing in the backend
  reads it; VAT follows `vat_delivery_pct` regardless of order type).** Dropping the column is
  better than narrowing it — that is a schema change, S2's call and S2's migration, not this
  sweep's.

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
- The back-office is not yet on a public host (`bo-shos.hellfiresol.com` DNS not yet live) — its
  public-facing posture (TLS, access gate) is S1-04's job, not re-verified here beyond the findings
  above.
- No penetration test of the deployed staging site's network/TLS layer was performed beyond reading
  response headers over HTTPS from this machine (§5 web-surface findings) — this is a code/config
  review, not a live external pentest.

**S7-04 (2026-10-29), by contrast, reached both a live instance and a safe sandbox, and the
difference in confidence is worth stating.** The leak itself (D-025) and its controls were proved
against the **deployed staging** project with the public anon key (read-only, no writes, no
credential beyond what the storefront already ships). The *fix* — the five `revoke`/`grant`
statements, the `menu_items_on_sale` rewrite, and the `settings_public_read` policy narrowing — was
proved end-to-end against a **disposable local sandbox** (35 migrations + the committed seed,
unmodified), not against staging, because applying it to staging is S2's migration, not something
this boot is allowed to write. The sandbox is PG16.2 against staging's configured 17; stated as a
caveat (§5), not glossed, and irrelevant to the privilege/RLS behaviour being tested. What is
**not** verified: the exact grant statements re-run against staging itself, and a genuine
authenticated-customer JWT (none exists — phase A ships no login; simulated with `set role
authenticated` + a `sub` absent from `staff`, which is the same shape phase B's first real session
will have).

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
