# ARCHITECTURE — SHOSHO

Updated by S0 every few boots. Reflects the REAL state; planned parts are marked `[plan]`.

Last update: 2026-09-20 — after S1-03 / S2-01; S3-01 and S4-01 in flight.

## Layers

```
[Guest]    ──> apps/web (Next.js 15)        [S3-01 in progress] ─┐
                                                                  ├──> Supabase `shosho-staging` (eu-central-1)
[Operator] ──> apps/backoffice (Next.js 15) [S4-01 in progress] ─┘     Postgres + Auth + Realtime · schema v1 LIVE (S2-01)
                                                                        RPC: quote_order · place_order · set_order_status
                                                                             get_order_by_token · kitchen_pause
apps/automation ──────────────────────────────────────────────────┘                                          [plan, S5]
  ├─ agents/ (Claude Agent SDK): Sales, Accounting, Warehouse, Quality, Grow
  ├─ api/ (FastAPI): Lieferando / Wolt / Instagram / Facebook webhooks   (placeholder image running on staging :8201)
  └─ schedules: cron / systemd timers (no n8n — D-007)

apps/backend  — Supabase CLI project: migrations, seed, RLS, RPCs, generated types, vitest   [LIVE]
apps/infra    — compose (local + staging), GitHub Actions, env templates, placeholder images   [LIVE]
```

## Data model (implemented — see /docs/api-contracts.md §1)
settings (kv) · staff (=auth.users, roles owner/operator/kitchen/driver) · delivery_zones · menu_categories · menu_items · option_groups · options · menu_item_option_groups · customers · customer_addresses · orders (+ order_items, order_events, sequential number from 1000, tracking_token) · promo_codes · views customer_stats, menu_items_on_sale.
All money in integer cents. All tables RLS-on; guests act only through security-definer RPCs.

## Environments
| Env | Trigger | Where | State |
|---|---|---|---|
| local | `pnpm --filter @shosho/backend db:reset` (needs Docker) + `docker compose up` in apps/infra | dev machine | works (CI-proven; S2's Mac had no Docker) |
| staging | push to `main` → `CI` → `Migrate staging` (supabase db push + seed) → `Deploy staging` (GHCR → ssh `shos` → rootless compose) | shared DO droplet, `127.0.0.1:8200` web / `:8201` api ← `http://shos.hellfiresol.com` | **live**; web is still the placeholder page until S3-01 lands; schema + seed applied |
| prod | tag `v*` + manual approve (`deploy-prod.yml`) | TBD (not this droplet) | workflow only, no target — decision after S7-01 |

Server terms (co-tenant, 512M, ports 8200–8299, no sudo, no nginx): `/memory/infra-access.md`. `https://` on the domain still hits the wrong origin vhost (Cloudflare SSL Full — owner side).

## CI (`ci.yml`)
Per-app jobs `node (web)`, `node (backoffice)` (lint/typecheck/test, no-op until `package.json` exists), `python (automation)`, `infra` (compose smoke + loopback-port guard + workflow-sync check), `backend (supabase)` (supabase start → db reset → lint → seed ×2 → typecheck → vitest → types diff). Required check for `main`: `CI`.

## Data flows
| # | Flow | State |
|---|---|---|
| 1 | Guest → web → `quote_order` on every cart change → `place_order` → `orders` (+customer upsert) → Realtime → back-office board | backend done; UI in S3-01 / S4-01 |
| 2 | Guest tracking → `get_order_by_token` (poll 15 s; realtime = S2-02) | backend done; UI S3-01 |
| 3 | Operator → `set_order_status` (transition machine, role gates, events) → Realtime | backend done; UI S4-01 |
| 4 | Payment capture (Stripe etc.) | **not built** — v1 stub marks paid on delivery; S2-02 |
| 5 | Instagram/Facebook DM → FastAPI → Sales agent → `orders` | [plan, S5] |
| 6 | Lieferando/Wolt → FastAPI → `orders` (`channel`) | [plan, S5] |
| 7 | Timers → Accounting / Warehouse / Grow agents → reports | [plan, S5] |

## Known gaps / debt
- No payment provider; no storage bucket for menu photos; no customer timeline; no anonymisation job (all S2-02).
- Repo-level secrets → environment `staging` (S1-03 task 0, in progress).
- Brand tokens duplicated between web and backoffice (D-010) — extract to `packages/brand` later.
- Seed staff passwords are public in `apps/backend/README.md` — rotate on staging before any real data (S7).
