# ARCHITECTURE — SHOSHO

Updated by S0 every few boots. Reflects the REAL state; planned parts are marked `[plan]`.

Last update: 2026-09-20 — phase 1 (infra), no product code yet.

## Layers

```
[Guest]    ──> apps/web (Next.js) ───────┐
                                          ├──> Supabase (Postgres + Auth + Realtime + Storage)   [plan]
[Operator] ──> apps/backoffice (Next.js) ─┘         ▲
                                                     │
apps/automation ─────────────────────────────────────┘                                          [plan]
  ├─ agents/ (Claude Agent SDK): Sales, Accounting, Warehouse, Quality, Grow
  ├─ api/ (FastAPI): Lieferando / Wolt / Instagram / Facebook webhooks, internal HTTP
  └─ schedules: cron / systemd timers (no n8n — D-007)

apps/infra — compose files, GitHub Actions, env templates, placeholder images                   [partial]
```

## Environments
| Env | Trigger | Where | State |
|---|---|---|---|
| local | `.env` + `docker compose up` in apps/infra | dev machine | placeholder api only |
| staging | push to `main` | shared droplet, user `shos`, `127.0.0.1:8200` ← `shos.hellfiresol.com` | pipeline exists, target not yet live (S1-02) |
| prod | tag `v*` + manual approve | TBD | workflow exists, no target |

Server terms (co-tenant, 512M, ports 8200–8299): `/memory/infra-access.md`.

## Target data flows
1. Guest → web → `orders` (Supabase) → Realtime → back-office operator screen
2. Instagram/Facebook DM → FastAPI webhook → Sales agent → `leads` / `orders`
3. Lieferando/Wolt → FastAPI → `orders` (source = `channel`)
4. Timer → Accounting / Warehouse / Grow agents → `reports`, Storage

## Implemented
- CI (lint/typecheck/test per app, no-op while apps are empty; compose smoke test)
- Deploy workflows (GHCR build → ssh → compose) — need adaptation to rootless/co-tenant (S1-02)
- Placeholder images `shosho-web`, `shosho-api`
