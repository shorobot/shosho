# STATE — current project state

Maintained by S0 Orchestrator. Child sessions update ONLY their own row. Roster and ID format — `/memory/sessions.md`.
Last update: 2026-09-20 (S0 — S4-01 issued; D-009/D-010; architecture refreshed)

## Phase
Phase 2 — product. Backend v1 live on staging. Running in parallel: S1-03 (finishing) ‖ S3-01 (guest site) ‖ S4-01 (back-office orders board).

## Sessions

| ID | Session      | Status        | Active boot | Last completed | Blockers |
|----|--------------|---------------|-------------|----------------|----------|
| S1 | DevOps       | boot done     | —           | S1-03          | owner: re-enter 5 secrets with `--env staging` (see log 2026-09-21), then S1 deletes repo-level copies |
| S2 | Backend      | boot done     | —           | S2-01 (merged, on staging) | next: S2-02 after S3-01/S4-01 start |
| S3 | Frontend     | in progress   | S3-01       | —              | — (staging Supabase has schema + seed) |
| S4 | Back-office  | in progress   | S4-01       | —              | public host for the back-office undecided (proposal → S1-04); reachable via ssh port-forward meanwhile |
| S5 | Automation   | not started   | —           | —              | waits for S4-01 |
| S6 | QA           | not started   | —           | —              | waits for S4-01 |
| S7 | Security     | not started   | —           | —              | waits for S4-01 |

Statuses: `not started` → `in progress` → `boot done` → `blocked`

## Start order
S1 → S2 → S3 → S4 → (S5 ‖ S6 ‖ S7)

## What exists now
- GitHub: https://github.com/shorobot/shosho — **public**, org `shorobot`, default branch `main`. Branch protection: PR + green `CI`, no force-push. Environments `staging`, `production` (production = required reviewer).
- **Staging is live**: `http://shos.hellfiresol.com/` → host nginx (TETA+PI) → `127.0.0.1:8200` web placeholder; api on `127.0.0.1:8201` (`/health`). Rootless docker under `shos`, `systemd --user`, autostart on, ~130M of 512M. Terms: `/memory/infra-access.md`. `https://` still serves the wrong site (CF SSL Full — owner-side Cloudflare rule pending).
- Deploy pipeline: push to `main` → `CI` → `Deploy staging` (GHCR build `shosho-web` / `shosho-api` → ssh `shos` → `compose pull/up` → health over ssh). Green since 2026-09-20. `deploy-prod.yml` exists (tag `v*`, approve), no prod target.
- `/apps/infra`: pnpm monorepo wrapper, `.env.example` per app, `docker-compose.yml` (local: api placeholder), `docker-compose.staging.yml` (web + api, loopback ports), placeholder images, `scripts/shos-user-setup.sh`, `scripts/sync-workflows.sh`, workflows `ci.yml` (per-app no-op jobs + compose smoke + loopback-port guard), `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`. No n8n, no nginx, no root scripts.
- **Supabase `shosho-staging`** (eu-central-1), ref `bvmitglwwqsvufetlkff`, URL `https://bvmitglwwqsvufetlkff.supabase.co`. **Schema + seed applied** by `Migrate staging` (run 35538990827, 2026-09-20).
- GitHub Secrets: `STAGING_SSH_HOST/USER/KEY`, `STAGING_SUPABASE_URL/_ANON_KEY/_SERVICE_ROLE_KEY/_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` — all set 2026-09-20 (S1-03 task 0: env `staging`). Env `staging` variables: `PUBLIC_HOST`, `PUBLIC_URL`, `STAGING_SUPABASE_PROJECT_REF`.
- Workflows on `main`: `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`, `migrate-staging.yml` (push to `main` after CI → `supabase db push` + seed; dry-run on PRs touching `supabase/`).
- `/memory`: log, state, decisions (D-001…D-008), sessions, infra-access, boots/ (S1-01 closed, S1-02 done, S1-03 + S2-01 issued).
- `/apps/backend` (S2-01): Supabase CLI project — 10 migrations, RPCs `quote_order`/`place_order`/`set_order_status`/`get_order_by_token`/`kitchen_pause`, RLS, seed (menu, zones, promos, 4 staff logins), `types/database.ts`, 21 vitest tests, `backend` CI job (supabase start → reset → lint → seed ×2 → tests → types diff). Applied to `shosho-staging`.
- `/docs`: architecture.md, api-contracts.md (§1–4 implemented schema, §5 web contract by S2, §6 backoffice contract by S0), design/ (brandbook, canvas, README).

## Not yet done / open
- CF SSL Full on `shos.hellfiresol.com` — owner / TETA+PI.
- Prod target — separate decision after S7-01.
- `docs/architecture.md` — refresh after S2-01 (S0).
