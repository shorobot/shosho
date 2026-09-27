# STATE — current project state

Maintained by S0 Orchestrator. Child sessions update ONLY their own row. Roster and ID format — `/memory/sessions.md`.
Last update: 2026-09-21 (S0 — D-011 payments; S2-02 issued)

## Phase
Phase 3 — hardening and reach. Guest site live on https; back-office built, verified on staging with all 4 roles, still ssh-only. Issued: S1-04 (host + secrets cleanup) ‖ S7-01 (security audit) ‖ S2-03 (contract gaps, order_attempts, reports) ‖ S4-02 (menu editor + photos). Next: S6-01 QA, S3-02 payments UI (waits for Stripe), S2-04 campaigns/CMS, S5-01 automation.

## Sessions

| ID | Session      | Status        | Active boot | Last completed | Blockers |
|----|--------------|---------------|-------------|----------------|----------|
| S1 | DevOps       | boot done     | —           | S1-04          | `bo.shos.hellfiresol.com` not live: **vhost approved by TETA+PI with basic-auth in the same change**; still needs owner DNS record + Configuration Rule + **"Always Use HTTPS"** + Cloudflare Access. Repo-level secrets deleted, env-only chain green (36273961641 → 36274003786). Slice 487/512 MiB — proposes dropping the `api` placeholder; the historic `oom_kill 1` was TETA+PI's own cap test, not ours |
| S2 | Backend      | boot done     | —           | S2-03 (PR #34) | owner: Stripe account + `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (test mode) as env `staging` secrets + the webhook endpoint in the Stripe dashboard — until then the payment functions answer 503 and no live payment has been walked through. S7-01's CRITICAL on `place_order`'s client-supplied `payment_status` is untouched and needs its own boot (§5.3 contract change). Funnel `attempts` figures read 0 until S3 calls `record_order_attempt` (`boots/proposed/S3-record-order-attempt.md`) |
| S3 | Frontend     | boot done     | —           | S3-01 (PRs #15, #18) | none — live at http://shos.hellfiresol.com/ against `shosho-staging`; next: S3-02 (payments UI) after S2-02 |
| S4 | Back-office  | in progress   | S4-02       | S4-01          | public host comes with S1-04; meanwhile ssh port-forward to `127.0.0.1:8202` |
| S5 | Automation   | not started   | —           | —              | unblocked (S4-01 done); after S7-01 |
| S6 | QA           | not started   | —           | —              | unblocked (S4-01 done); S6-01 next |
| S7 | Security     | boot done     | —           | S7-01 (PR #30) | owner/S2: CRITICAL — `place_order` accepts a client-supplied `payment_status`, letting a guest get a "paid" order with no real payment (`S7-02-S2-payment-security-fixes.md`); owner/S1: rotate the shared staff seed password before `bo.shos.hellfiresol.com` goes live; four more proposals filed (`memory/boots/proposed/S7-02-*.md`), none blocking |

Statuses: `not started` → `in progress` → `boot done` → `blocked`

## Start order
S1 → S2 → S3 → S4 → (S5 ‖ S6 ‖ S7)

## What exists now
- GitHub: https://github.com/shorobot/shosho — **public**, org `shorobot`, default branch `main`. **Branch protection is ON and is implemented as a repository ruleset, not classic branch protection** — ruleset `main-protection` (id 23652140, `enforcement: active`, `bypass_actors: []`, applies to `~DEFAULT_BRANCH`) with rules `pull_request`, `required_status_checks [CI]`, `deletion`, `non_fast_forward`. Verified by S0 2026-09-27 via `gh api repos/shorobot/shosho/rulesets/23652140`, and empirically: a direct push to `main` is rejected with `GH013: Repository rule violations found`. **`gh api repos/shorobot/shosho/branches/main/protection` returns 404 `Branch not protected` — that is expected for a ruleset and is NOT evidence that protection is missing.** Anyone auditing this must query `/rulesets`. Environments `staging` (restricted to `main`) and `production` (required reviewer).
- **Staging is live on https**: `https://shos.hellfiresol.com/` → Cloudflare → host nginx (TETA+PI) → `127.0.0.1:8200` = **the real guest site** (S3-01, Next.js, menu from `shosho-staging`); api placeholder on `127.0.0.1:8201` (`/health`). Rootless docker under `shos`, `systemd --user`, autostart on, ~130M of 512M. Terms: `/memory/infra-access.md`. The Cloudflare SSL-Full issue is resolved (owner added a Configuration Rule, 2026-09-26).
- Deploy pipeline (S1-03): push to `main` → `CI` → `Migrate staging` (`supabase db push --include-seed`) → `Deploy staging` (GHCR build `shosho-web` / `shosho-api` → ssh `shos` → `compose pull/up` → health over ssh). PRs touching `apps/backend/supabase/**` get a no-secret `plan` job. `deploy-prod.yml` exists (tag `v*`, approve, wants `PROD_*` in env `production`), no prod target.
- `/apps/infra`: pnpm monorepo wrapper, `.env.example` per app, `docker-compose.yml` (local: api placeholder), `docker-compose.staging.yml` (web + api, loopback ports), placeholder images, `scripts/shos-user-setup.sh`, `scripts/sync-workflows.sh`, workflows `ci.yml` (per-app no-op jobs + compose smoke + loopback-port guard), `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`. No n8n, no nginx, no root scripts.
- **Supabase `shosho-staging`** (eu-central-1), ref `bvmitglwwqsvufetlkff`, URL `https://bvmitglwwqsvufetlkff.supabase.co`. **Schema + seed applied** by `Migrate staging` (run 35538990827, 2026-09-20).
- GitHub Secrets: **repo-level list is empty** (S1-04 deleted all 8 on 2026-09-26 after proving no job reads them outside an `environment:` block). Environment `staging` holds all 8 (`STAGING_SSH_HOST/USER/KEY`, `STAGING_SUPABASE_URL/_ANON_KEY/_SERVICE_ROLE_KEY/_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`) and is restricted to branch `main`; variables `PUBLIC_HOST`, `PUBLIC_URL`, `STAGING_SUPABASE_PROJECT_REF`. Full chain re-verified on env-only secrets: Migrate 36273961641 → Deploy 36274003786, both green.
- Workflows on `main`: `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`, `_deploy.yml`, `migrate-staging.yml` (push to `main` after CI → `supabase db push` + seed; dry-run on PRs touching `supabase/`).
- `/apps/web` (S3-01): Next.js 15 guest site — home with category rail + popular grid, product page with option groups, cart driven entirely by `quote_order`, 3-step checkout → `place_order`, tracking page, About, 4 DE legal pages, cookie bar, 375 px mobile, brand placeholders until the `menu` bucket exists. Deployed as `shosho-web`.
- `/memory`: log, state, decisions (D-001…D-011), sessions, infra-access, boots/.
- `/apps/backend` (S2-01): Supabase CLI project — 10 migrations, RPCs `quote_order`/`place_order`/`set_order_status`/`get_order_by_token`/`kitchen_pause`, RLS, seed (menu, zones, promos, 4 staff logins), `types/database.ts`, 21 vitest tests, `backend` CI job (supabase start → reset → lint → seed ×2 → tests → types diff). Applied to `shosho-staging`.
- `/docs`: architecture.md, api-contracts.md (§1–4 implemented schema, §5 web contract by S2, §6 backoffice contract by S0), design/ (brandbook, canvas, README).

## Not yet done / open
- **Owner**: Stripe account (Shosho Sushi GmbH, test mode) + `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in env `staging`, and the webhook endpoint in the Stripe dashboard (`…/functions/v1/stripe-webhook`, 5 events — `apps/backend/README.md`). Blocks the live payment walkthrough and S3-02.
- **Owner, 4 Cloudflare actions for the back-office host** (S1-04 log has the click-by-click): (1) DNS `CNAME bo.shos → shos.hellfiresol.com`, proxied; (2) duplicate the 2026-09-26 Configuration Rule with the hostname changed to `bo.shos.hellfiresol.com`; (3) **Always Use HTTPS** for that hostname — the origin cannot do this under CF's Full topology, an origin-side `:80→https` redirect would loop (S1-04 addendum); (4) Cloudflare Access self-hosted app with an email allow-list (free ≤ 50 users) — if it paywalls, stay on TETA+PI's basic-auth.
- **Owner**: revoke the Supabase access token created 2026-09-20 (the 2026-09-26 one is live and in use). The old DB password needs nothing — it died when you reset it.
- **Security, pre-prod blocker**: `payment-worker` Edge Function has `verify_jwt = true`, which the **public** anon key satisfies, and it acts with the service role without a caller check — anyone with the key could rewrite the pg_cron schedule or drain the payment job queue. Found by S1-04, routed straight to S7 (D-012), audit in flight. Staging-only today (no Stripe keys, no real money), must be fixed before any prod or real payment.
- All 8 secrets now exist in environment `staging` (owner, 2026-09-26); repo-level copies still present until S1-04 task 3 deletes them. Env-only chain proven green (run 36254748898).
- No live Stripe payment has ever run; the state machine is verified only against recorded event payloads.
- Menu photos: bucket `menu` exists (S2-02); upload UI lands with S4-02.
- **Staging memory is thin but not hostile.** Post-deploy (S1-04, 2026-09-26): slice `memory.current` 487.6 MiB / 512 MiB, `memory.peak` 515 MiB, `memory.events.max` 7736, no swap (`MemorySwapMax=0`). Non-reclaimable is `anon` 234 MiB + kernel 36 MiB = 270 MiB; the rest is reclaimable page cache. Per container: web 44 MiB/96, backoffice 52 MiB/96, api 33 MiB/160, each `oom_kill 0`. Worst case at declared limits ≈ 494 MiB — 18 MiB under the cap. **Correction (S1-04 addendum): the slice's `oom_kill 1` is TETA+PI's own deliberate cap test of 2026-09-20, not our workload** — S0's earlier note that treated it as a warning sign was wrong; nothing of ours has ever been OOM-killed. Fix scheduled: D-013 drops the `api` placeholder in S1-05 → worst case ~334 MiB.

- Flaky test: `tests/guest_realtime.test.ts` failed once on `main` (`no broadcast received … partitions_created: []`) and passed on re-run — S2-03 task 8 makes it deterministic.
- Prod target — separate decision after S7-01.
