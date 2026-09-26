# BOOT: S1-04 (DevOps) — public host for the back-office, ratify the functions-deploy steps, drop repo-level secrets

## Role
You are session S1 (DevOps) of SHOSHO. Three jobs: give the back-office a real URL behind TLS, take ownership of the workflow steps S2 had to add while you were busy, and finish the secrets hardening you started in S1-03.

## Context
Repo: https://github.com/shorobot/shosho. The root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours (D-008). `git fetch origin && git checkout -b s1-04 origin/main`. Before any PR touching `/memory`, merge `origin/main` first (D-009).
Read FIRST: `/memory/state.md`, `/memory/decisions.md` (D-004 co-tenant terms, D-011 payments), `/memory/infra-access.md`, and both proposals: `/memory/boots/proposed/S1-04-backoffice-host.md` (from S4 — options A/B/C) and `/memory/boots/proposed/S1-05-edge-functions-deploy-ratify.md` (from S2 — the diff already applied to `migrate-staging.yml`).

State: guest site live on `https://shos.hellfiresol.com/`; back-office container runs on `127.0.0.1:8202`, reachable only by ssh tunnel; Edge Functions deploy from `migrate-staging.yml` and are ACTIVE on staging; env `staging` now holds all 8 secrets (owner re-entered them 2026-09-26; S0 verified a green `Migrate staging` run 36254748898 on env-only values).

## Tasks
1. **Back-office host — option A** (S0's decision, from S4's recommendation): `bo.shos.hellfiresol.com` → `127.0.0.1:8202`.
   - The DNS record and the Cloudflare rule are the **owner's** action, the vhost is the **TETA+PI manager's** — you own neither. Send one message to `teta-pi-e0` requesting the vhost for `bo.shos.hellfiresol.com` → `127.0.0.1:8202` (same pattern as `shos.…` → `:8200`), and give the owner the exact Cloudflare steps (CNAME/A record, proxied, plus whatever Configuration Rule made `shos.` work on 2026-09-26 — reuse it, do not re-derive).
   - **Gate before the URL is announced to anyone**: put Cloudflare Access (preferred — email allow-list for the owner + staff) or nginx basic-auth in front of it while it is staging, and confirm the app is only ever served over https. If Access cannot be configured without a paid plan, say so and use basic-auth via the TETA+PI vhost request.
   - Verify end to end: `https://bo.shos.hellfiresol.com/login` reachable, TLS valid, the four seed logins work, the guest site unaffected.
2. **Ratify the functions-deploy steps** (S2's S1-05 proposal): review the `# S2-02:` blocks in `.github/workflows/migrate-staging.yml` + the synced copy — function secrets, `functions deploy --use-api`, the `payment-worker` install POST. Keep, rewrite or harden as you see fit (S2 asked for exactly this); make sure the sync check still passes and the chain stays `CI → Migrate → Deploy`. Delete the proposal file when done.
3. **Finish S1-03 task 0**: the env-only chain is proven green — delete the 8 repo-level secret copies (`STAGING_SSH_HOST/USER/KEY`, `STAGING_SUPABASE_URL/_ANON_KEY/_SERVICE_ROLE_KEY/_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`). Re-run the full chain afterwards (`workflow_dispatch` on Migrate, then a no-op push or a re-run of Deploy) and confirm green with environment secrets only. If anything breaks, restore by asking the owner — never guess values.
4. **Tell the owner what to revoke**: the Supabase personal access token created 2026-09-20 is superseded by the one from 2026-09-26; list exactly which credential to revoke where (account → access tokens), and whether the old DB password matters (it does not if it was reset).
5. **Staging capacity check**: three containers now (web, api, backoffice) on a 512M slice. Report `docker stats --no-stream` and the cgroup `memory.current` after a deploy; if the headroom is under ~80M, say so plainly and propose the next step (drop the api placeholder until S5 needs it, or request more RAM from TETA+PI with numbers).
6. **Prod readiness note** (no work, just write it): what `deploy-prod.yml` still needs (`PROD_*` secrets in environment `production`, a target host, a prod Supabase project) → `/memory/boots/proposed/S1-06-prod-target.md`, for S0 to schedule after S7-01.

## Boundaries
- Do NOT edit nginx, DNS or Cloudflare yourself — request from TETA+PI / the owner (D-004, `/memory/infra-access.md`).
- Do NOT change `apps/backend`, `apps/web`, `apps/backoffice` code. Workflows, compose, infra docs only.
- Do NOT create a prod environment or a prod Supabase project.
- Do NOT hand out any back-office URL before the auth gate of task 1 is in place.
- No secrets in the repo; never print a secret value.

## Done when
- [ ] `https://bo.shos.hellfiresol.com/login` serves the back-office over valid TLS, behind an access gate, and the guest site still works
- [ ] Functions-deploy steps reviewed and owned by you; sync check green; proposal file deleted
- [ ] Repo-level secrets deleted; full chain green on environment secrets only
- [ ] Owner told exactly what to revoke
- [ ] Memory/RAM report for the three containers
- [ ] `S1-06-prod-target.md` proposal written
- [ ] PR `s1-04` merged

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-04` — URL + gate, what TETA+PI answered, secrets deleted, RAM numbers, blockers.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-04]`.

## Next step
Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
