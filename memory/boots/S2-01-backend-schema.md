# BOOT: S2-01 (Backend) — Supabase schema v1, order RPCs, RLS

## Role
You are session S2 (Backend) of SHOSHO. You own the Supabase project: schema, migrations, RLS, RPC and DB-side business logic. This boot creates the data layer that S3 (guest site) and S4 (back-office) will build on.

## Context
Repo: https://github.com/shorobot/shosho (public). **Your working tree (D-008):** from `/Users/bobbob/BOB/SERVER/SH.OS.` run `git fetch origin && git worktree add .worktrees/s2 -b s2-01 origin/main`, then work ONLY inside `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2`. The root checkout belongs to S1 — do not touch it, do not switch its branch, never bare `git stash`. PR from `s2-01` to `main` (branch protection: PR + green `CI`). Repo language: English (D-006).
Read FIRST, in this order:
1. `/memory/state.md`, `/memory/decisions.md` (D-001 stack, D-002 memory rules, D-007 no n8n, D-008 worktrees), `/memory/sessions.md`
2. `/docs/api-contracts.md` — **your spec**. Section 1–4 define the tables, RPCs, realtime and RLS. Ship exactly what is marked S2-01; do not build S2-02 items.
3. `/docs/design/README.md` — product rules and screen inventory (why the schema looks like this). Open the canvas only if a rule is unclear.
4. `/apps/infra/README.md` — how local env and secrets work.

Supabase project: `shosho-staging` (eu-central-1) is created by S1-02. If `STAGING_SUPABASE_URL` is not yet in GitHub Secrets when you start, ask the owner for the project URL + anon key (never the service-role key in chat) and continue with local `supabase start` meanwhile. Do not create a Supabase project yourself.

## Tasks
1. **Supabase CLI project layout** under `apps/backend/` (new): `supabase/config.toml`, `supabase/migrations/`, `supabase/seed.sql`, `package.json` with scripts `db:reset`, `db:push`, `db:types`, `test`. Add `apps/backend` to `pnpm-workspace.yaml`. Do not put it in `apps/web` or `apps/automation`.
2. **Migrations** (one file per section, numbered): enums → settings/staff/delivery_zones → menu (categories, items, option_groups, options, m2m) → customers (+addresses) → orders (+items, events, number sequence from 1000) → promo_codes → triggers (`updated_at`, status→event, promo used_count) → views (`customer_stats`, `menu_items_on_sale`) → RLS policies → RPCs. Column names and enums exactly as in api-contracts §1. If you must deviate, write why in `/memory/boots/proposed/S2-contract-change.md` and keep going with your version — S0 reconciles.
3. **RPCs** per api-contracts §2: `quote_order`, `place_order`, `set_order_status`, `get_order_by_token`, `kitchen_pause`. `place_order` must: re-quote server-side, refuse on any problem, resolve zone by postal code, apply pickup −10 % and free delivery over the zone threshold, validate promo (scope, min order, limits, validity, first-order), upsert customer by phone (copy `kitchen_note` → `orders.allergy_note`), snapshot item names/prices/options, write `order_events(created)`, return `{order_id, number, total_cents, tracking_token}`. Status transitions in `set_order_status`: `new→accepted|cancelled`, `accepted→preparing|cancelled`, `preparing→ready|cancelled`, `ready→out_for_delivery|picked_up|cancelled`, `out_for_delivery→delivered|cancelled`, any paid & completed → `refunded` (owner/operator only).
4. **RLS** per §4. `anon` sees only on-sale menu, active categories, active zones, and `settings` rows whose key is in a public allow-list (`business`, `opening_hours`, `site`, `payments.enabled`). All order/customer access for `anon` goes through security-definer RPCs. Staff role read from `staff.role` via a stable helper `auth_role()`.
5. **Seed** (`seed.sql`, idempotent): the design's data so S3/S4 have something real — 10 categories with kana, ≥ 12 items (Philadelphia Deluxe RL-014 14.90, Signature Set 38.90, Tonkotsu Ramen 13.50, Chicken Shiitake Udon 11.00, Salmon Donburi 12.90, Onigiri Trio 7.50, California Crab 12.40, Ebi Tempura 9.80, Miso soup 3.20, Wakame salad 4.50, Green tea 2.80, Mochi ×3 5.40), 5 option groups from the design, 3 zones (A Mitte/Prenzlauer Berg 15 €/0 €/45 min; B Friedrichshain/Wedding 22 €/2.90 €/60 min; C Kreuzberg part 30 €/4.90 €/75 min) with a few Berlin postal codes each, promo codes SHOSHO10 / WILLKOMMEN / LUNCH15, settings (ops 22/+15/7 d/auto-accept < 50 €, hours Mo–Do 11–23, Fr–Sa 11–24, So 12–22), 4 staff rows (owner K. Sato, operator Marek K., kitchen Lena N., driver Jonas M.) — staff rows need matching `auth.users`; create them in seed via `auth.admin` in a small script or document the 4 test logins in `apps/backend/README.md`.
6. **Types**: `supabase gen types typescript` → `apps/backend/types/database.ts`, committed. S3/S4 import from there.
7. **Tests** (pgTAP or a small `vitest` suite against local Supabase): quote/place order happy path; below min order; out of zone; stoplisted item; promo first-order rule; illegal status transition; anon cannot select `orders`; kitchen cannot set `delivered`. CI: extend `ci.yml` with a `backend` job that runs `supabase start` + migrations + tests (if the runner cannot run Supabase local within limits, run at least `supabase db lint` + a SQL syntax check and say so in the log).
8. **Apply to staging**: `supabase db push` to `shosho-staging` once its secrets exist, plus seed. Record the project ref in your log entry (not the keys).
9. **Docs**: `apps/backend/README.md` — how to run locally, migrate, seed, regenerate types, test logins. Fill `/docs/api-contracts.md` §5 "Web → Supabase" with the concrete calls S3 will make (table/RPC name, params, returned shape) — this is the ONE contract section you are allowed to write; S0 reviews it in the PR.

## Boundaries
- Do NOT build UI, Next.js apps, FastAPI, or agents.
- Do NOT implement payment provider calls (Stripe etc.) — `payment_status` stays `pending`/`authorized` by RPC input in v1; real capture is S2-02.
- Do NOT build campaigns, automations, banners, site publications, customer timeline, devices — marked S2-02/S4 in the contract.
- Do NOT edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`, or api-contracts §1–4 (proposals only).
- No secrets in the repo. `.env.example` only.

## Done when
- [ ] `supabase db reset` locally applies all migrations + seed with zero errors
- [ ] All RPCs in §2 exist and pass the tests in task 7
- [ ] RLS: anon cannot read `orders`/`customers`/`staff`; anon can read on-sale menu; role matrix in §4 holds
- [ ] `types/database.ts` generated and committed
- [ ] CI has a `backend` job and it is green
- [ ] Migrations + seed applied to `shosho-staging`
- [ ] `apps/backend/README.md` written; api-contracts §5 filled
- [ ] PR `s2-01` merged into `main`

## Reporting
1. Append to `/memory/log.md`: `## <date> — S2 Backend — S2-01` — what shipped, staging project ref, deviations from the contract (if any), blockers.
2. `/memory/state.md`: update ONLY the S2 row (status `boot done`, last completed `S2-01`).
3. Commits prefixed `[S2-01]`.

## Next step
Needs for S2-02 (payments capture, customer timeline, anonymisation job, tracking-token RLS) or for other sessions → proposals in `/memory/boots/proposed/S<N>-<NN>-<slug>.md`. Do not execute them. After reporting — stop and wait for S0.
