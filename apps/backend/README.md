# SHOSHO — backend (Supabase)

Owner: **S2 Backend**. Everything the data layer is: Postgres schema, RLS, RPCs with the order business
logic, seed data, generated TypeScript types and the integration tests. Contract: [`/docs/api-contracts.md`](../../docs/api-contracts.md)
(§1–4 = target model, §5 = the calls the guest site makes).

```
apps/backend/
├── supabase/config.toml        local stack (api 54321, db 54322; studio/storage/edge/analytics off)
├── supabase/migrations/        one file per section, applied in order (see table below)
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

Adding a migration: `supabase migration new <slug>` → edit → `pnpm db:reset` → `pnpm db:types` → `pnpm test`.
Never edit an applied migration file once it is on `main`; add a new one.

## Apply to staging

Automatic: merge to `main` → CI → **Migrate staging** (`.github/workflows/migrate-staging.yml`) runs
`link` + `db push --include-seed` against `shosho-staging`, then Deploy staging ships the containers.
PRs touching `supabase/` get a secret-free plan job. Details: `apps/infra/README.md` → *Migrations*.
Manual (owner only, needs the DB password):
```bash
pnpm exec supabase link --project-ref <ref>      # once; asks for the DB password (owner has it)
pnpm db:push                                     # = supabase db push --include-seed
```

Project: `shosho-staging` (eu-central-1). Ref/URL/keys live only in GitHub Secrets (`STAGING_SUPABASE_*`).

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
- Payment (v1 stub, S2-02 replaces): `payment_status` comes from the RPC input (`pending` | `authorized`); `delivered`/`picked_up` flips it to `paid`, `cancelled` releases `authorized` → `pending`, `refunded` sets `refunded`.
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

¹ `business`, `opening_hours`, `site`, `payments.enabled`, `kitchen.status` (`settings_public_keys()`). `service_role` bypasses RLS.
RPC execute grants: `quote_order`, `place_order`, `get_order_by_token` → anon + authenticated; `set_order_status`, `kitchen_pause` → authenticated (role checked inside).

## CI

`.github/workflows/ci.yml` job `backend`: `supabase start` → `db reset` → `db lint` → seed applied a second
time (idempotency) → typecheck → vitest → `gen types` must equal the committed `types/database.ts`.
The generated file is also uploaded as the `backend-types` artifact.
