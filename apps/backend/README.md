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
pnpm test                                      # vitest; keys are read from `supabase status` automatically
pnpm db:types                                  # regenerate types/database.ts (commit it)
pnpm db:lint                                   # plpgsql_check on all functions
pnpm db:stop
```

`supabase status` prints the local URL, anon key and service-role key (Studio is disabled to save RAM —
enable it in `config.toml` if you want the UI). The API is `http://127.0.0.1:54321`.

Point tests at another project: set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(see `.env.example`). The suite writes orders/customers — never run it against production.

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
| `payment-worker` | yes | pg_cron every minute, the `payment_jobs` insert trigger, or by hand | claims queued `payment_jobs` and executes them against Stripe (capture / cancel / refund / update or increment the amount), each with the idempotency key `job:<id>:<attempt>`; `{"action":"install"}` writes the Vault secrets and (re)creates the cron job. |

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

All four exist in `auth.users` + `public.staff` after seeding (local and staging). Password for all: **`shosho-test-2026`**.

| Email | Role | Name |
|---|---|---|
| `owner@shosho.test` | owner | K. Sato |
| `operator@shosho.test` | operator | Marek K. |
| `kitchen@shosho.test` | kitchen | Lena N. |
| `driver@shosho.test` | driver | Jonas M. |

Change the password before any real data enters staging (`supabase auth` → users) — these are test accounts.

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

## RLS in one table

| Table | anon | kitchen | driver | operator | owner |
|---|---|---|---|---|---|
| `settings` | public keys¹ | public keys | public keys | read all | all |
| `staff` | — | own row | own row | read | all |
| `delivery_zones` | active | active | active | all | all |
| `menu_categories`, `menu_items`, `options` | active / on sale | read all | active / on sale | all | all |
| `option_groups`, `menu_item_option_groups` | read | read | read | all | all |
| `customers`, `customer_addresses` | — | — | — | all | all |
| `orders`, `order_items`, `order_events` | — (RPC only) | read | own (`driver_id`) | all | all |
| `promo_codes` | — (validated in RPC) | — | — | all | all |
| `customer_events`, `payment_events`, `payment_jobs` | — | — | — | read | read |
| `storage.objects` in bucket `menu` | read | read | read | all | all |

¹ `business`, `opening_hours`, `site`, `payments.enabled`, `kitchen.status` (`settings_public_keys()`). `service_role` bypasses RLS.
RPC execute grants: `quote_order`, `place_order`, `get_order_by_token` → anon + authenticated;
`set_order_status`, `kitchen_pause`, `update_order_items`, `add_customer_event`,
`anonymise_silent_customers` → authenticated only (role checked inside, `anon` revoked in migration 18);
`record_payment_event`, `enqueue_payment_job`, `claim_payment_jobs`, `finish_payment_job`,
`run_payment_worker`, `schedule_payment_worker`, the two `ensure_*` installers and
`is_service_request` → `service_role` only. Supabase's default privileges grant EXECUTE on every new
`public` function to `anon` and `authenticated`, so a new staff-only function needs an explicit
`revoke … from anon` — not just `revoke … from public`.

## CI

`.github/workflows/ci.yml` job `backend`: `supabase start` → `db reset` → `db lint` → seed applied a second
time (idempotency) → typecheck → vitest (52 tests) → `gen types` must equal the committed `types/database.ts`.
The generated file is also uploaded as the `backend-types` artifact.
