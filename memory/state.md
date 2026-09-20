# STATE — current project state

Maintained by S0 Orchestrator. Child sessions update ONLY their own row. Roster and ID format — `/memory/sessions.md`.
Last update: 2026-09-20 (S0 — design received, api-contracts §1–4 written, S2-01 issued)

## Phase
Phase 1 — infrastructure (S1-02 running) ‖ backend schema (S2-01 issued). Design is in `/docs/design/`.

## Sessions

| ID | Session      | Status        | Active boot | Last completed | Blockers |
|----|--------------|---------------|-------------|----------------|----------|
| S1 | DevOps       | in progress   | S1-02       | S1-01 (partial: no staging URL, no Supabase, no report) | — |
| S2 | Backend      | boot done     | —           | S2-01 (staging push pending: no Supabase project/secrets yet) | staging `db push` waits for `shosho-staging` ref + DB password (S1-02 task 6 / owner) |
| S3 | Frontend     | not started   | —           | —              | waits for S2-01 (api-contracts §5) |
| S4 | Back-office  | not started   | —           | —              | waits for S2-01, S3-01 |
| S5 | Automation   | not started   | —           | —              | waits for S4-01 |
| S6 | QA           | not started   | —           | —              | waits for S4-01 |
| S7 | Security     | not started   | —           | —              | waits for S4-01 |

Statuses: `not started` → `in progress` → `boot done` → `blocked`

## Start order
S1 → S2 → S3 → S4 → (S5 ‖ S6 ‖ S7)

## What exists now
- GitHub: https://github.com/shorobot/shosho — **public**, org `shorobot`, default branch `main`. Branch protection: PR + green `CI` required, no force-push. Environments `staging`, `production` (production = required reviewer).
- Server access: shared DO droplet, user `shos`, 512M / ports 8200–8299 / no sudo — full terms in `/memory/infra-access.md`. ssh verified 2026-09-20.
- Domain: `shos.hellfiresol.com` (Cloudflare → host nginx → 127.0.0.1:8200). Currently 502 / may serve the wrong site (CF SSL Full issue, raised with owner).
- `/apps/infra` (from S1-01): pnpm monorepo wrapper, `.env.example` per app, `docker-compose.yml` (local: n8n + api placeholder — n8n to be removed), `docker-compose.staging.yml` (web + api), placeholder-web / placeholder-api images, nginx vhost files (obsolete — we no longer manage nginx), `scripts/server-bootstrap.sh` (obsolete — assumed root), workflows `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml` (GHCR build → ssh → compose pull/up).
- GitHub Secrets: `STAGING_SSH_HOST/USER/KEY` (USER is stale — was `shosho`), `STAGING_N8N_*` (obsolete).
- `/memory`: log, state, decisions, sessions, infra-access, boots/.
- `/docs`: architecture.md, api-contracts.md (§1–4 = DB schema, RPC, realtime, RLS — target model + S2-01 scope), design/ (brandbook.pdf, shosho-site.dc.html canvas with 19 screens, README with screen inventory + product rules).

## Not yet done / open
- Staging service not running on :8200 (S1-02).
- Supabase staging project not created (S1-02).
- Rootless docker not installed on the server (S1-02).
- CF SSL Full issue on `shos.hellfiresol.com` — owner / TETA+PI side.
- Prod target — not decided; separate boot after S7-01.
