# STATE — current project state

Maintained by S0 Orchestrator. Child sessions update ONLY their own row. Roster and ID format — `/memory/sessions.md`.
Last update: 2026-09-21 (S0 — D-011 payments; S2-02 issued)

## Phase
Phase 3 — hardening and reach. Guest site live on https; back-office built but ssh-only; payments coded, no Stripe account yet. Issued: S1-04 (back-office host + secrets cleanup) ‖ S7-01 (first security audit). Next: S4-02 menu editor, S6-01 QA, S3-02 payments UI (waits for Stripe), S2-03 reports/campaigns.

## Sessions

| ID | Session      | Status        | Active boot | Last completed | Blockers |
|----|--------------|---------------|-------------|----------------|----------|
| S1 | DevOps       | in progress   | S1-04       | S1-03          | needs owner DNS/Cloudflare for `bo.shos.hellfiresol.com` and a vhost from TETA+PI |
| S2 | Backend      | boot done     | —           | S2-02 (PR #21, on staging) | owner: Stripe account + `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (test mode) as env `staging` secrets + the webhook endpoint in the Stripe dashboard — until then the payment functions answer 503 and no live payment has been walked through |
| S3 | Frontend     | boot done     | —           | S3-01 (PRs #15, #18) | none — live at http://shos.hellfiresol.com/ against `shosho-staging`; next: S3-02 (payments UI) after S2-02 |
| S4 | Back-office  | boot done     | —           | S4-01          | public host for the back-office undecided (proposal → `S1-04-backoffice-host.md`); staging is loopback-only (`127.0.0.1:8202`) via ssh port-forward meanwhile |
| S5 | Automation   | not started   | —           | —              | unblocked (S4-01 done); after S7-01 |
| S6 | QA           | not started   | —           | —              | unblocked (S4-01 done); S6-01 next |
| S7 | Security     | in progress   | S7-01       | —              | — |

Statuses: `not started` → `in progress` → `boot done` → `blocked`

## Start order
S1 → S2 → S3 → S4 → (S5 ‖ S6 ‖ S7)

## What exists now
- GitHub: https://github.com/shorobot/shosho — **public**, org `shorobot`, default branch `main`. Branch protection: PR + green `CI`, no force-push. Environments `staging`, `production` (production = required reviewer).
- **Staging is live on https**: `https://shos.hellfiresol.com/` → Cloudflare → host nginx (TETA+PI) → `127.0.0.1:8200` = **the real guest site** (S3-01, Next.js, menu from `shosho-staging`); api placeholder on `127.0.0.1:8201` (`/health`). Rootless docker under `shos`, `systemd --user`, autostart on, ~130M of 512M. Terms: `/memory/infra-access.md`. The Cloudflare SSL-Full issue is resolved (owner added a Configuration Rule, 2026-09-26).
- Deploy pipeline (S1-03): push to `main` → `CI` → `Migrate staging` (`supabase db push --include-seed`) → `Deploy staging` (GHCR build `shosho-web` / `shosho-api` → ssh `shos` → `compose pull/up` → health over ssh). PRs touching `apps/backend/supabase/**` get a no-secret `plan` job. `deploy-prod.yml` exists (tag `v*`, approve, wants `PROD_*` in env `production`), no prod target.
- `/apps/infra`: pnpm monorepo wrapper, `.env.example` per app, `docker-compose.yml` (local: api placeholder), `docker-compose.staging.yml` (web + api, loopback ports), placeholder images, `scripts/shos-user-setup.sh`, `scripts/sync-workflows.sh`, workflows `ci.yml` (per-app no-op jobs + compose smoke + loopback-port guard), `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`. No n8n, no nginx, no root scripts.
- **Supabase `shosho-staging`** (eu-central-1), ref `bvmitglwwqsvufetlkff`, URL `https://bvmitglwwqsvufetlkff.supabase.co`. **Schema + seed applied** by `Migrate staging` (run 35538990827, 2026-09-20).
- GitHub Secrets: `STAGING_SSH_HOST/USER/KEY`, `STAGING_SUPABASE_URL/_ANON_KEY/_SERVICE_ROLE_KEY/_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` — all set 2026-09-20 (S1-03 task 0: env `staging`). Env `staging` variables: `PUBLIC_HOST`, `PUBLIC_URL`, `STAGING_SUPABASE_PROJECT_REF`.
- Workflows on `main`: `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`, `migrate-staging.yml` (push to `main` after CI → `supabase db push` + seed; dry-run on PRs touching `supabase/`).
- `/apps/web` (S3-01): Next.js 15 guest site — home with category rail + popular grid, product page with option groups, cart driven entirely by `quote_order`, 3-step checkout → `place_order`, tracking page, About, 4 DE legal pages, cookie bar, 375 px mobile, brand placeholders until the `menu` bucket exists. Deployed as `shosho-web`.
- `/memory`: log, state, decisions (D-001…D-011), sessions, infra-access, boots/.
- `/apps/backend` (S2-01): Supabase CLI project — 10 migrations, RPCs `quote_order`/`place_order`/`set_order_status`/`get_order_by_token`/`kitchen_pause`, RLS, seed (menu, zones, promos, 4 staff logins), `types/database.ts`, 21 vitest tests, `backend` CI job (supabase start → reset → lint → seed ×2 → tests → types diff). Applied to `shosho-staging`.
- `/docs`: architecture.md, api-contracts.md (§1–4 implemented schema, §5 web contract by S2, §6 backoffice contract by S0), design/ (brandbook, canvas, README).

## Not yet done / open
- **Owner**: Stripe account (Shosho Sushi GmbH, test mode) + `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in env `staging`, and the webhook endpoint in the Stripe dashboard (`…/functions/v1/stripe-webhook`, 5 events — `apps/backend/README.md`). Blocks the live payment walkthrough and S3-02.
- **Owner**: DNS/Cloudflare record for `bo.shos.hellfiresol.com` (S1-04 gives the exact steps); revoke the superseded Supabase access token from 2026-09-20.
- All 8 secrets now exist in environment `staging` (owner, 2026-09-26); repo-level copies still present until S1-04 task 3 deletes them. Env-only chain proven green (run 36254748898).
- No live Stripe payment has ever run; the state machine is verified only against recorded event payloads.
- Menu photos: bucket `menu` exists (S2-02), no upload UI yet (S4-02).
- Prod target — separate decision after S7-01.
