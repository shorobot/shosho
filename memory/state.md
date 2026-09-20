# STATE — current project state

Maintained by S0 Orchestrator. Child sessions update ONLY their own row. Roster and ID format — `/memory/sessions.md`.
Last update: 2026-09-20 (S0 — S1-02 closed, staging deploy green, S1-03 issued)

## Phase
Phase 1 — staging is live and auto-deploys from `main`. S1-03 (migrations CI + secrets hardening) ‖ S2-01 (schema). Design is in `/docs/design/`.

## Sessions

| ID | Session      | Status        | Active boot | Last completed | Blockers |
|----|--------------|---------------|-------------|----------------|----------|
| S1 | DevOps       | in progress   | S1-03       | S1-02          | owner item B: Supabase `shosho-staging` + secrets (not created yet) |
| S2 | Backend      | in progress   | S2-01       | —              | staging push needs owner item B (works locally meanwhile) |
| S3 | Frontend     | not started   | —           | —              | waits for S2-01 (api-contracts §5) |
| S4 | Back-office  | not started   | —           | —              | waits for S2-01, S3-01 |
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
- GitHub Secrets (repo-level, to be moved to env `staging` in S1-03): `STAGING_SSH_HOST/USER/KEY` (KEY replaced 2026-09-20, working).
- `/memory`: log, state, decisions (D-001…D-008), sessions, infra-access, boots/ (S1-01 closed, S1-02 done, S1-03 + S2-01 issued).
- `/docs`: architecture.md, api-contracts.md (§1–4 schema/RPC/realtime/RLS), design/ (brandbook, canvas, README).

## Not yet done / open
- **Owner item B**: Supabase `shosho-staging` (eu-central-1) + secrets `STAGING_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY / _DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, variable `STAGING_SUPABASE_PROJECT_REF`. Blocks S2-01 task 8 and S1-03 task 1.
- CF SSL Full on `shos.hellfiresol.com` — owner / TETA+PI.
- Prod target — separate decision after S7-01.
- `docs/architecture.md` — refresh after S2-01 (S0).
