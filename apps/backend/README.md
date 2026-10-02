# SHOSHO — backend (Supabase)

Owner: **S2 Backend**. Everything the data layer is: Postgres schema, RLS, RPCs with the order business
logic, seed data, generated TypeScript types and the integration tests. Contract: [`/docs/api-contracts.md`](../../docs/api-contracts.md)
(§1–4 = target model, §5 = the calls the guest site makes).

```
apps/backend/
├── supabase/config.toml        local stack (api 54321, db 54322; studio/storage/edge/analytics off)
├── supabase/migrations/        one file per section, applied in order (see table below)
├── supabase/functions/         Edge Functions (Deno): Stripe payments — see “Payments” below
├── supabase/seed.sql           idempotent demo data from the design (menu, zones, promos, settings, 4 staff logins)
├── types/database.ts           `supabase gen types` output — S3/S4 import from here (CI fails if stale)
├── tests/                      vitest suite against a running Supabase (local or any project)
└── package.json                scripts below
```

## Run locally

Needs Docker (Desktop, Colima, …) and pnpm. The Supabase CLI is a devDependency (`pnpm exec supabase`);
a global install (`brew install supabase/tap/supabase`) works the same.

```bash
pnpm install                                   # repo root
cd apps/backend
pnpm db:start                                  # supabase start → pulls images, applies migrations + seed
pnpm db:reset                                  # drop & re-apply migrations + seed (use after editing SQL)
pnpm seed:local-logins                         # optional — `pnpm test` already does this via `pretest`
pnpm test                                      # vitest; keys are read from `supabase status` automatically
pnpm db:types                                  # regenerate types/database.ts (commit it)
pnpm db:lint                                   # plpgsql_check on all functions
pnpm db:stop
```

`supabase status` prints the local URL, anon key and service-role key (Studio is disabled to save RAM —
enable it in `config.toml` if you want the UI). The API is `http://127.0.0.1:54321`.

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`) override the
values `supabase status` would otherwise supply, but **`pnpm test` only works against the local
stack** since S2-05: its `pretest` hook (`scripts/seed-local-logins.mjs`) sets the suite's known
password and refuses anything but a loopback URL on purpose — the whole point of this boot is that no
known password may exist on a real project. Run `pnpm exec vitest run` directly (bypassing `pretest`)
if you need to point the raw suite elsewhere, but the role-based sign-in tests will fail unless that
project's staff accounts already have a known password set some other way. The suite writes
orders/customers regardless — never run it against production.

## Migrations

| # | File | Contents |
|---|------|----------|
| 01 | `…01_enums.sql` | `staff_role`, `order_channel`, `order_type`, `order_status`, `payment_status`, `payment_method`, `promo_kind`, `actor_type`; pgcrypto |
| 02 | `…02_settings_staff_zones.sql` | `settings` (key/jsonb), `staff` (id = `auth.users.id`), `delivery_zones` (+ `free_delivery_over_cents`), helpers `auth_role()`, `is_staff(…)` |
| 03 | `…03_menu.sql` | `menu_categories`, `menu_items`, `option_groups`, `options`, `menu_item_option_groups`, `menu_item_on_sale(row)` |
| 04 | `…04_customers.sql` | `customers` (phone unique, E.164), `customer_addresses` |
| 05 | `…05_orders.sql` | `order_number_seq` (from 1000), `orders` (+ `tracking_token`), `order_items`, `order_events`; realtime publication |
| 06 | `…06_promo_codes.sql` | `promo_codes` |
| 07 | `…07_triggers.sql` | `updated_at` everywhere; status change → `*_at` stamps + `order_events` row (actor from GUC / JWT / system); promo `used_count` |
| 08 | `…08_views.sql` | `customer_stats`, `menu_items_on_sale` (both `security_invoker`) |
| 09 | `…09_rls.sql` | RLS on every table; role matrix from api-contracts §4 |
| 10 | `…10_rpc.sql` | `quote_order`, `place_order`, `set_order_status`, `get_order_by_token`, `kitchen_pause` + helpers; execute grants |
| 11 | `…11_payments.sql` | `orders.payment_provider / payment_intent_id / payment_authorized_cents / payment_captured_at / payment_refunded_cents`; `payment_events` (webhook idempotency log); `payment_jobs` + `enqueue_payment_job` / `claim_payment_jobs` / `finish_payment_job`; `record_payment_event` (webhook state machine) |
| 12 | `…12_storage_menu_bucket.sql` | bucket `menu` (public read, owner/operator write) + `storage.objects` policies (`ensure_menu_bucket_policies()`) |
| 13 | `…13_customer_events.sql` | `customer_events` + triggers (order → `order`, consent change → `consent_changed`) + `add_customer_event` |
| 14 | `…14_update_order_items.sql` | `update_order_items` — operator edits with a server-side re-quote |
| 15 | `…15_set_order_status_payments.sql` | `set_order_status` v2: capture / void / refund through `payment_jobs`, cash confirmation, note → customer timeline |
| 16 | `…16_guest_realtime.sql` | guest tracking broadcast to `order:<tracking_token>` + `ensure_guest_realtime_policy()` |
| 17 | `…17_anonymise_and_schedules.sql` | `anonymise_silent_customers(months)`, `is_service_request()`, `run_payment_worker()` (pg_net + Vault), `schedule_payment_worker()`, pg_cron schedules |
| 18 | `…18_grants_hardening.sql` | revokes the `anon` / `authenticated` EXECUTE that Supabase's default privileges hand to every new `public` function (staff- and service-only RPCs) |
| 19 | `…19_security_null_role_guard_fix.sql` | **S7-01** — NULL-unsafe role guards in `kitchen_pause` / `anonymise_silent_customers` (`NULL NOT IN (…)` is NULL, and plpgsql treats `IF NULL` as false, so the gate never fired) |
| 20 | `…20_security_audit_helpers.sql` | **S7-01** — `security_audit_function_grants` / `_table_grants` / `_policies`, the live-catalogue introspection behind `tests/security.test.ts` (service_role only) |
| 21 | `…21_role_access.sql` | `settings_staff_keys()` (public set + `ops`) + policy `settings_staff_common_read`; view `staff_directory`; `settings['kitchen.status'].capacity`; `kitchen_pause()` merges instead of replacing (keeping S7's guard) |
| 22 | `…22_event_payloads.sql` | the status trigger and `set_order_status` write the §1.4 payload per event type (GUC `shosho.status_payload` carries the RPC-only keys); `reason` canonical / `cancel_reason` legacy; `record_payment_event`'s `payment_authorized` payload |
| 23 | `…23_order_attempts.sql` | `order_attempts` (PII-free, CHECK-enforced `items`) + `record_order_attempt(payload)` for `anon` with a per-session rate limit; `place_order` rejection hint + `payment_authorized` payload |
| 24 | `…24_reports.sql` | `customer_stats` rebuilt (completed orders only + `cancelled_count`); `reports_guard()`; `report_revenue_by_day`, `report_top_items`, `report_funnel`, `report_delivery_times` |
| 25 | `…25_payment_trust_boundary.sql` | **S7-01 finding 1 (CRITICAL)** — `place_order` no longer trusts a client `payment_status` / `payment_ref`; staff-recorded `paid` is audited; `set_order_status` stops marking provider-less orders `paid` on completion |
| 26 | `…26_search_path_and_worker_secret.sql` | `search_path` pinned on the six SECURITY INVOKER functions (finding 5); `payment_worker_secret()` + `run_payment_worker` sends it, so pg_cron can prove it is the cron (findings 3/7) |

Adding a migration: `supabase migration new <slug>` → edit → `pnpm db:reset` → `pnpm db:types` → `pnpm test`.
Never edit an applied migration file once it is on `main`; add a new one.

## Apply to staging

Automatic: merge to `main` → CI → **Migrate staging** (`.github/workflows/migrate-staging.yml`) runs
`link` + `db push --include-seed` against `shosho-staging`, then (S2-02) sets the Stripe function
secrets, `functions deploy --use-api` and installs the `payment-worker` schedule; then Deploy staging
ships the containers.
PRs touching `supabase/` get a secret-free plan job. Details: `apps/infra/README.md` → *Migrations*.
Manual (owner only, needs the DB password):
```bash
pnpm exec supabase link --project-ref <ref>      # once; asks for the DB password (owner has it)
pnpm db:push                                     # = supabase db push --include-seed
```

Project: `shosho-staging` (eu-central-1). Ref/URL/keys live only in GitHub Secrets (`STAGING_SUPABASE_*`).

## Payments — Stripe Edge Functions (S2-02, D-011)

Three functions in `supabase/functions/`, deployed to staging by `Migrate staging` right after
`db push` (`supabase functions deploy --use-api`). `_shared/` holds the pure modules (signature
verification, Stripe → schema mapping) that the vitest suite unit-tests on Node.

| Function | verify_jwt | Called by | Does |
|---|---|---|---|
| `create-payment-intent` | yes (anon key is enough) | the guest site / back-office (§5.6) | creates or reuses a PaymentIntent (`amount = orders.total_cents`, `eur`, `capture_method: manual`, `automatic_payment_methods`, `metadata.order_id`), stores `payment_intent_id` + `payment_provider`, returns `client_secret`. A guest must present the order's `tracking_token`; an `owner`/`operator` session may omit it. |
| `stripe-webhook` | **no** — the `Stripe-Signature` header is the authentication | Stripe | verifies the signature against `STRIPE_WEBHOOK_SECRET`, resolves the card / wallet description, then calls `record_payment_event` (idempotent on the Stripe event id). |
| `payment-worker` | yes | pg_cron every minute, the `payment_jobs` insert trigger, or by hand | claims queued `payment_jobs` and executes them against Stripe (capture / cancel / refund / update or increment the amount); `{"action":"install"}` writes the Vault secrets and (re)creates the cron job. **S2-04:** draining needs the service-role key or `x-worker-secret` — see below. |

**Function secrets** (`supabase secrets set`, per project — never in the repo or in `settings`):
`STRIPE_SECRET_KEY` (required), `STRIPE_WEBHOOK_SECRET` (required for the webhook),
`STRIPE_PUBLISHABLE_KEY` (optional; returned to the client so the web app needs no env var of its own).
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.
Staging values come from the GitHub environment `staging` secrets of the same names; while they are
missing the functions answer `503 stripe_not_configured` and nothing else breaks.

**Stripe dashboard** (test mode first): endpoint
`https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, events
`payment_intent.amount_capturable_updated`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`.

**Local development** — needs Docker for the Supabase stack and the Stripe CLI for the webhook:
```bash
cp supabase/functions/.env.example supabase/functions/.env   # your own sk_test_… (never commit it)
pnpm db:start
pnpm exec supabase functions serve --env-file supabase/functions/.env   # :54321/functions/v1/…

stripe login                                                  # once
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook \
  --events payment_intent.amount_capturable_updated,payment_intent.succeeded,\
payment_intent.payment_failed,payment_intent.canceled,charge.refunded
# copy the printed whsec_… into supabase/functions/.env as STRIPE_WEBHOOK_SECRET and restart `serve`

# drain the queue by hand (capture / void / refund) while testing:
pnpm exec supabase functions invoke payment-worker --no-verify-jwt --data '{}'
```
Test cards: `4242…4242` authorises, `4000 0000 0000 9995` declines (`insufficient_funds`),
`4000 0000 0000 3220` asks for 3-D Secure.

**Money flow in one line**: checkout → `create-payment-intent` → Stripe.js confirm → webhook
`amount_capturable_updated` → `payment_status = authorized` (+ auto-accept under 50 €) →
operator/driver sets `delivered` / `picked_up` → `payment_jobs(capture)` → worker captures → webhook
`succeeded` → `paid` + `payment_captured_at`. `cancelled` → `payment_jobs(void)` → webhook `canceled`
→ back to `pending`. `refunded` → `payment_jobs(refund)` → webhook `charge.refunded` →
`payment_refunded_cents` / `refunded`.

## payment-worker: who may call it (S2-04)

`verify_jwt = true` on an Edge Function only proves the caller holds *some* project JWT — and the
**anon key qualifies**. That key ships in the guest web bundle, so before S2-04 anyone could POST
`/functions/v1/payment-worker` and make it drain the job queue against Stripe, or re-run
`{"action":"install"}`. S7-01 raised it as finding 7; S1 hit the same thing independently in S1-04.

Draining now requires one of:

| Credential | Who presents it |
|---|---|
| `Authorization: Bearer <service-role key>` | a human running the function by hand, or CI |
| `x-worker-secret: <public.payment_worker_secret()>` | pg_cron, via `run_payment_worker()` |

`payment_worker_secret()` is 32 random bytes kept in Vault, generated on first use, `service_role`
only — the Edge Function reads it back with its own service-role client, and nothing else can. A
caller with only the anon key gets `403 forbidden`.

```bash
# by hand (service-role key from the Supabase dashboard → Project Settings → API)
curl -sS -X POST "$SUPABASE_URL/functions/v1/payment-worker" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d '{}'
```

**`{"action":"install"}` is deliberately still reachable with the anon key** — `migrate-staging.yml`
calls it that way, S1 owns workflows, and that token swap is routed as a proposal
(`/memory/boots/proposed/S2-04-S1-payment-worker-install-token.md`). Its parameters are server-side
constants, so the residual surface is "a stranger can re-run our own cron install". Install also
rewrites the Vault key to the **service-role** key and ensures the secret exists, so the drain path
becomes strict the first time it runs after a deploy — nothing needs coordinating for that half.
When S1's swap lands, the install branch gets the same check and no path accepts a public key.

## Refunds cannot double-pay (S2-04)

`capture` and `void` always asked Stripe for the PaymentIntent's live status first, so replaying them
was safe. `refund` did not. `payment_jobs` re-claims a job after 10 minutes, and the retry used a
*new* idempotency key (`job:<id>:<attempt>`), which Stripe treats as a genuinely new request — so a
worker that died between `refunds.create()` resolving and `finish_payment_job` committing refunded
the customer twice (S7-01 finding 2). Two guards now, in `_shared/refund-plan.ts`:

1. **An attempt-stable idempotency key**, `refund:job:<id>`. Stripe honours a key for 24 h and
   replays the original response, so the retry of a call that did reach Stripe returns the same
   refund. This is the part that actually closes the race, because it needs no state of ours.
2. **A pre-check**: list the refunds already on the intent and look for `metadata.job_id = <job>`.
   Same "ask Stripe what is true" shape as capture/void, and it still works after the 24 h window
   has passed — the one case a key alone would not cover.

The planner is a pure function so `tests/refund_idempotency.test.ts` can play the crash-then-reclaim
sequence exactly, with no Stripe account and no network.

## Schedules (pg_cron)

| Job | Schedule | Runs |
|---|---|---|
| `anonymise-silent-customers` | `0 1,2 * * *` UTC, guarded to the hour 03:00 Europe/Berlin | `anonymise_silent_customers(24)` — the guard makes DST a non-issue |
| `payment-worker` | `* * * * *` | `run_payment_worker()` → pg_net POST to the `payment-worker` function (URL + anon key from Vault) |

`payment_jobs` inserts also kick the worker immediately, so a capture normally happens within a
second and the minute cron is only the retry path. If a project has no `pg_cron` / `pg_net` / Vault,
both migrations degrade to a notice and the two entry points must be called externally
(`select public.anonymise_silent_customers(24);` and `functions invoke payment-worker`) — a systemd
timer on the droplet or S5 can do it. `select public.schedule_payment_worker('<url>', '<anon key>')`
(or the function's `{"action":"install"}`) installs the schedule; `Migrate staging` does it after every
deploy.

## Storage

Bucket `menu` — public read, `insert` / `update` / `delete` for `owner` / `operator`, 5 MB per file,
`image/jpeg | png | webp | avif`. `menu_items.photos` holds **bucket-qualified** paths
`menu/<item_id>/<n>.jpg`; the upload path inside the bucket is `<item_id>/<n>.jpg`. Recipe for the
back-office in api-contracts §6.8. Deleting an item does not remove its objects.

## Test logins (seed)

All four exist in `auth.users` + `public.staff` after seeding (local and staging), identified by
email/role/name below — **not** by a shared password: since S2-05, `seed.sql` gives each one a
random, immediately-discarded password, so a fresh or reset cloud project is never born with a login
anyone can find in this public repo.

- **Local development**: after `supabase db reset`, run `pnpm --filter @shosho/backend
  seed:local-logins` to set the documented local-only password on all four accounts
  (`scripts/seed-local-logins.mjs` — it prints the value, and refuses to run against anything but a
  loopback Supabase URL). The test suite does this for you automatically: `pnpm test`'s `pretest`
  hook runs the same script before vitest starts, so no extra step is needed to run the suite.
- **Staging**: this seed change does **not**, by itself, invalidate the password already on
  `shosho-staging` — the `auth.users` insert is `on conflict (id) do nothing`, so a project that
  already has these four rows (which `shosho-staging` has had since S2-01) keeps whatever password
  they already had. **The former shared password is still a live, known-compromised credential on
  staging until the owner rotates it.** To close that: the owner runs
  `scripts/rotate-staging-passwords.mjs` (see its header for the one-line recipe) with the real
  service-role key, which sets four fresh, distinct, random passwords and writes them to
  `apps/backend/.staff-credentials.local` on their own machine (gitignored, never committed) —
  rerunning it rotates again, overwriting that file. After rotation, ask the owner for the current
  values; never put a real value in chat, a commit, a log entry, or this README.

| Email | Role | Name |
|---|---|---|
| `owner@shosho.test` | owner | K. Sato |
| `operator@shosho.test` | operator | Marek K. |
| `kitchen@shosho.test` | kitchen | Lena N. |
| `driver@shosho.test` | driver | Jonas M. |

Rotating the staging passwords is permanent against this seed file: the `auth.users` insert is
`on conflict (id) do nothing`, so a later `Migrate staging` (`db push --include-seed`) never
overwrites a password already set. (`supabase db reset` locally is a full wipe, not a push, so a
reset always starts the four accounts fresh — rerun `seed:local-logins` after one, or just run
`pnpm test`, which does it for you.)

## Business rules implemented in the DB

- **Quote = place.** `place_order` re-runs `quote_order` server-side and rejects on any problem; client totals are never trusted.
- Zone by postal code (`delivery_zones.postal_codes`); min order per zone; fee per zone; free delivery from `free_delivery_over_cents` (35 € in seed).
- Pickup −10 % (`settings.ops.pickup_discount_pct`). Promised time: zone minutes (delivery) / `ops.prep_default_min` (pickup), `+ ops.rush_extra_min` while `settings.kitchen.rush` is true.
- Opening hours (`settings.opening_hours`, Europe/Berlin): ASAP orders only while open and the kitchen is not paused; pre-orders need a slot ≥ 15 min ahead, ≤ `ops.preorder_max_days`, inside opening hours.
- Category `schedule` (`{"days":[1..5],"until":"15:00"}`) makes items orderable only in that window.
- Promo codes: active, validity window, usage limit, min order, `applies_to.scope` `all` / `category` / `first_order` (checked against the phone's order history), optional `days` / `until`. `used_count` increments on order creation.
- Customer upsert by phone; `customers.kitchen_note` snapshots to `orders.allergy_note`; delivery address is stored on the profile (first one becomes default).
- Auto-accept: `authorized`/`paid` ASAP orders with total < `ops.auto_accept_paid_under_cents` go straight to `accepted` (event actor `system`).
- Status machine in `set_order_status`: `new→accepted|cancelled`, `accepted→preparing|cancelled`, `preparing→ready|cancelled`, `ready→out_for_delivery` (delivery, needs an active driver) `|picked_up` (pickup) `|cancelled`, `out_for_delivery→delivered|cancelled`, `delivered|picked_up→refunded` when paid. Kitchen: `preparing`/`ready` only. Driver: `delivered` on own orders only. Cancel/refund: owner/operator.
- **Payment trust boundary (S2-04, S7-01 finding 1)** — **nobody but the payment provider may say
  that money moved.** A guest order is created `pending`; sending any other `payment_status` is
  refused (`invalid_input`), not coerced, and a guest's `payment_ref` is dropped. `authorized` is
  reachable only from `record_payment_event` behind the verified Stripe webhook. `owner`/`operator`
  may record `paid` at order entry for money already in hand, and that writes an `order_events`
  `note` (`code = 'payment_recorded_by_staff'`) naming the actor. Completion is **not** evidence of
  payment: a non-cash order with no provider completes with `payment_status` untouched plus a
  `payment_not_confirmed` note, instead of silently becoming `paid`. Auto-accept keys only off a
  vouched state. Until this landed, `place_order(payment_status: 'authorized')` from the public anon
  key was a free meal.
- **Payments (S2-02, D-011)** — Stripe with manual capture; the DB never holds a provider secret. A
  PaymentIntent is created by the `create-payment-intent` function, `stripe-webhook` moves
  `payment_status` (`authorized` → `paid` → `refunded` / `failed`) and applies the auto-accept rule when
  the authorization arrives, and `set_order_status` only *enqueues* what the provider must do
  (`payment_jobs`: `capture` on delivered/picked_up, `void` on cancelled, `refund` on refunded,
  `update_amount` after an operator edit) for the `payment-worker` function to execute. Cash keeps the
  driver confirmation (`{cash_received: true}` → `paid`; `false` → stays `pending` + a `note` event).
  Orders with no provider (v1 client-reported) still flip to `paid` on completion.
- Operator edits: `update_order_items` re-quotes server-side while the order is `new` / `accepted` /
  `preparing`, marks changed rows `modified_by_operator` and writes `order_events(item_changed)` with the
  diff; a Stripe authorization caps the new total (`amount_exceeds_authorization`).
- Customer timeline: every order, staff note, consent change, complaint / compensation and the
  anonymisation land in `customer_events` (§6.8).
- GDPR: `anonymise_silent_customers(24)` runs nightly at 03:00 Europe/Berlin (pg_cron) — scrubs name /
  phone / email / birthday / kitchen note / consents and the PII snapshot on the orders, deletes the
  addresses, keeps numbers, dates, items and totals (GoBD, 10 years). Never run by the seed.
- Every status change writes `order_events` (`accepted`, `preparing`, `ready`, `handed_to_driver`, `delivered`, `picked_up`, `cancelled`, `refunded`); `place_order` writes `created` (+ `payment_authorized`); `set_order_status` payload `note` adds a `note` event.
- **Event payloads (S2-03)** — each type carries what api-contracts §1.4 documents: `created {channel}`,
  `payment_authorized {payment_ref, provider, amount_cents}`, `accepted {promised_minutes}`,
  `preparing {promised_minutes, station?}`, `ready {}`, `handed_to_driver {driver_id, driver_name}`,
  `delivered`/`picked_up` `{cash_received?}`, `cancelled {reason}`, `refunded {amount_cents}`,
  `note {text, code?}`, `item_changed {before, after, totals}`. Every status event also carries
  `from` / `to`. Keys the trigger cannot see (`station`, `cash_received`, `amount_cents`) are handed
  over by `set_order_status` through the transaction-local GUC `shosho.status_payload`, which the
  trigger consumes and clears. **Rows written before 2026-09-27 are not backfilled** — consumers
  tolerate missing keys, as §1.4 requires.
- **Cancel reason** — `set_order_status` accepts `payload.reason` (canonical, wins when both are sent)
  and `payload.cancel_reason` (legacy, one release). The column stays `orders.cancel_reason`.
- **Kitchen load** — `settings['kitchen.status'].capacity` (int, default 8). Load =
  `count(accepted, preparing) / capacity`, computed by the UI. It lives on the *public* key so the
  kitchen role can read it; `kitchen_pause()` merges the value instead of replacing it.

## Settings key sets

`settings` is one key/value table with **three** access tiers. Which tier a key is in is the whole
access-control story for it — there is no per-field filtering.

| Tier | Function | Keys | Who reads |
|---|---|---|---|
| public | `settings_public_keys()` | `business`, `opening_hours`, `site`, `payments.enabled`, `kitchen.status` | `anon` and every authenticated user |
| staff | `settings_staff_keys()` | the public set **+ `ops`** | every authenticated staff role (owner, operator, kitchen, driver) |
| private | — | `payments`, `kitchen` | `owner` / `operator` only |

Writes are `owner` only, in every tier.

- `ops` was opened up in S2-03 (§6.9 row 1) because the kitchen board needs `prep_default_min`,
  `rush_extra_min` and `preorder_max_days`, none of which is sensitive. `auto_accept_paid_under_cents`
  and `attempt_rate_limit_per_min` ride along in the same key.
- `kitchen` stays private: it holds `paused_by` (a staff uuid) and the `rush` flag. Its public mirror
  `kitchen.status` carries `{paused, since, capacity}` and is written by `kitchen_pause()`, which
  **merges** so `capacity` survives a pause.
- **`business` holds imprint data only** — name, address, phone, email, impressum, ust_id, all of it
  legally public, which is why it is in the public tier. Billing details, payout data, API keys or
  anything credential-bearing must go into `payments` (private) or a new private key. Adding such a
  field to `business` would publish it to `anon`.

## Reports (Berichte)

Four security-definer set-returning functions — api-contracts §6.10 has the column lists.

```ts
rpc('report_revenue_by_day', { from_date: '2026-09-01', to_date: '2026-09-27' })
rpc('report_top_items',      { from_date, to_date, limit_count: 20 })
rpc('report_funnel',         { from_date, to_date })
rpc('report_delivery_times', { from_date, to_date })
```

Why functions and not views: a `security_invoker` view is read through the caller's RLS, and `orders`
RLS is per-role — a `driver` sees only their own orders, so a view would have handed a driver a
partial revenue figure with no indication that it was partial. One shared gate, `reports_guard()`,
requires an active staff role instead; `anon`'s EXECUTE is revoked. Narrowing the reports to
owner/operator later is a one-line change per function.

`from_date` / `to_date` are Europe/Berlin calendar dates, **both ends inclusive**, defaulting to the
last 30 days (`from` / `to` are reserved words, hence the names). Revenue counts **completed orders
only** (`delivered`, `picked_up`), with `cancelled_count` and `refunded_cents` alongside so a sum row
reconciles against the bank.

### What the funnel can honestly support today

| Design tile | Status |
|---|---|
| **WARENKORB → BEZAHLT** | **Real** — `placed`, `paid`, `placed_to_paid_pct` come straight from `orders`. |
| **ZUSATZVERKAUF** | **Real** — the option half of every completed line (`line_total − unit_price × qty`), per period in `report_funnel` and per day in `report_revenue_by_day`. |
| **MENÜ → WARENKORB** | **Not computable. Deliberately absent.** It needs menu impressions / add-to-cart events and no table holds them. The `site_events` sketch in `/memory/boots/proposed/S2-03-reports-campaigns-cms.md` is the route and needs an S0 decision (GDPR) first. No column fakes it. |
| `attempts`, `attempts_with_problems`, `attempts_to_placed_pct` | **Placeholder data until S3 emits attempt rows.** The query is real; nothing calls `record_order_attempt` yet, so they read `0` / `null`. That means "nothing recorded", not "nothing happened" — the Berichte screen should label it that way. |

## `order_attempts` — privacy rules

The rejected/abandoned-checkout feed (api-contracts §1.7) is the one table that receives data from
guests who never became customers, so it is PII-free **by construction**, not by convention:

- **No PII column exists.** No name, phone, email, street, floor/apt, city, courier comment, comment
  flags or `customer_id`. A test asserts each of those names is an unknown column.
- **`items` is `[{item_id, qty}]` only**, enforced by the CHECK constraint `order_attempt_items_ok`.
  `record_order_attempt` also rebuilds the array from scratch, so any extra key a client sends is
  dropped before the insert ever runs.
- **`problems` is filtered** to the §5.2 keys (`code`, `item_id`, `reason`, `field`, `promo_code`), so
  no free text can ride along in a problem object.
- **`postal_code`** is the coarsest location the guest typed and is the whole point of the
  out-of-zone state; `zone_id` is resolved from it server-side.
- **`session_hash`** is an opaque client-side id from `sessionStorage` — **not a cookie**, not derived
  from anything about the person, and used only to de-duplicate and to rate-limit. Do not pass a
  customer id, phone hash or device fingerprint in it.
- **`anon` cannot read the table at all** (the table grant is revoked, and there is no insert policy
  either — the security-definer RPC is the only writer). `owner` / `operator` select; `kitchen` and
  `driver` see nothing.
- Rate limit: `settings.ops.attempt_rate_limit_per_min` rows per `session_hash` per minute, default
  20. Over that the RPC raises `rate_limited` and writes nothing.
- Append-only: no `updated_at`, no update trigger. There is no retention job yet — if S0 wants one,
  it is a one-line `pg_cron` delete of rows older than N days next to the anonymisation job.

## RLS in one table

| Table | anon | kitchen | driver | operator | owner |
|---|---|---|---|---|---|
| `settings` | public keys¹ | public + `ops`² | public + `ops`² | read all | all |
| `staff` | — | own row | own row | read | all |
| view `staff_directory` | — | read (4 cols)³ | read (4 cols)³ | read | read |
| `delivery_zones` | active | active | active | all | all |
| `menu_categories`, `menu_items`, `options` | active / on sale | read all | active / on sale | all | all |
| `option_groups`, `menu_item_option_groups` | read | read | read | all | all |
| `customers`, `customer_addresses` | — | — | — | all | all |
| `orders`, `order_items`, `order_events` | — (RPC only) | read | own (`driver_id`) | all | all |
| `promo_codes` | — (validated in RPC) | — | — | all | all |
| `customer_events`, `payment_events`, `payment_jobs` | — | — | — | read | read |
| `order_attempts` | — (RPC insert only)⁴ | — | — | read | read |
| `storage.objects` in bucket `menu` | read | read | read | all | all |

¹ `business`, `opening_hours`, `site`, `payments.enabled`, `kitchen.status` (`settings_public_keys()`). `service_role` bypasses RLS.
² `settings_staff_keys()` = the public set **plus `ops`**, for every authenticated staff role (S2-03, §6.9 row 1).
³ `id, name, role, active` — explicit column list, so `staff.phone` and anything added to `staff` later stay behind the base table's owner/operator policy. Empty for `anon` and non-staff sessions.
⁴ `anon`'s table grant is revoked entirely and there is no insert policy: `record_order_attempt()` is the only writer.
RPC execute grants: `quote_order`, `place_order`, `get_order_by_token` → anon + authenticated;
`set_order_status`, `kitchen_pause`, `update_order_items`, `add_customer_event`,
`anonymise_silent_customers` → authenticated only (role checked inside, `anon` revoked in migration 18);
`record_order_attempt` → anon + authenticated (§1.7); the four `report_*` functions and `reports_guard`
→ authenticated only (any active staff role, `anon` revoked);
`record_payment_event`, `enqueue_payment_job`, `claim_payment_jobs`, `finish_payment_job`,
`run_payment_worker`, `schedule_payment_worker`, the two `ensure_*` installers and
`is_service_request` → `service_role` only. Supabase's default privileges grant EXECUTE on every new
`public` function to `anon` and `authenticated`, so a new staff-only function needs an explicit
`revoke … from anon` — not just `revoke … from public`.

## CI

`.github/workflows/ci.yml` job `backend`: `supabase start` → `db reset` → `db lint` → seed applied a second
time (idempotency) → typecheck → vitest (~90 tests) → `gen types` must equal the committed `types/database.ts`.
The generated file is also uploaded as the `backend-types` artifact.
