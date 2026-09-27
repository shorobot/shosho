# Proposal → S0: what production still needs before `deploy-prod.yml` can run (`S1-06`)

Written by S1 (DevOps) during S1-04, 2026-09-26. **No work was done on prod** — the boot forbids
creating a production environment or a prod Supabase project, and D-004 says the prod target is a
separate decision after S7-01. This is the inventory S0 asked for, so the boot can be scheduled with
the gaps already known.

## Where prod stands today
`deploy-prod.yml` exists and is wired: tag `v*` → job `production` → `_deploy.yml` with
`environment: production`, `secret_prefix: PROD`. Environment `production` exists in GitHub with the
owner as a required reviewer. Nothing else is real — no host, no secrets, no Supabase project, and
the workflow has never run. It cannot run by accident: it needs a `v*` tag **and** an approval.

## Gap 1 — `PROD_*` secrets in environment `production` (owner)
`_deploy.yml` resolves six names by prefix. For prod that is:

| Secret | What it is | Who provides it |
|---|---|---|
| `PROD_SSH_HOST` | prod host address | owner, after Gap 2 |
| `PROD_SSH_USER` | deploy user on that host | owner, after Gap 2 |
| `PROD_SSH_KEY` | private key for that user | owner (generate fresh — **not** the staging key) |
| `PROD_SUPABASE_URL` | prod project URL | owner, after Gap 3 |
| `PROD_SUPABASE_ANON_KEY` | prod anon key | owner, after Gap 3 |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | prod service role key | owner, after Gap 3 |

All six go in **environment `production` only**, never at repo level — the repo is public, and S1-04
has just removed the last repo-level copies of the staging set. There is no `PROD_SUPABASE_DB_PASSWORD`
or prod `SUPABASE_ACCESS_TOKEN` in the list because **there is no prod migrate workflow yet** — see
Gap 4.

## Gap 2 — a prod host
D-004 is explicit that prod is **not** on the shared staging droplet: 512M total is already ~474M used
by three staging containers (S1-04 capacity report), and the box is co-tenanted with tetapi.dev and
hellfire under someone else's administration. Options for S0/owner to decide:

- **A separate DigitalOcean droplet** (2 GB, Frankfurt, ours alone) — simplest, matches what the
  pipeline already knows how to do (ssh + rootless docker + compose), costs ~€12/mo.
- **A managed container platform** (Fly.io / Render / Railway) — no host to patch, but `_deploy.yml`
  would need rewriting away from ssh, and that is a bigger change than the prod boot should carry.
- **A second slice on the same droplet** — cheapest, and the one D-004 already ruled out. Not
  recommended: staging and prod sharing a 512M cgroup means a staging deploy can OOM prod.

S1's recommendation: a separate droplet, same shape as staging, so `_deploy.yml` needs no changes
beyond inputs. Owner decides; it is the only item here that costs money.

## Gap 3 — a prod Supabase project
A second project (`shosho-prod`, eu-central-1) with its own keys. Not created — out of scope for this
boot and for S1 generally; the owner creates it, the same way `shosho-staging` was created.
Consequence worth stating: **prod starts with an empty database.** The seed in
`apps/backend/supabase/seed.sql` is staging test data (menu fixtures, promos, four staff logins with
known passwords) and must **not** be pushed to prod as-is. Someone has to decide what real initial
data prod gets — that is a question for S2, not a DevOps step.

## Gap 4 — there is no `migrate-prod.yml`
This is the real hole, and the reason the prod boot is more than "fill in six secrets".
`migrate-staging.yml` runs `supabase db push --include-seed --yes` unattended after every green CI on
`main`. Nothing equivalent exists for prod, and the staging one must **not** simply be copied:

- `--include-seed` has to go (see Gap 3).
- Unattended auto-push is wrong for prod. Prod migrations should be gated behind the same tag +
  approval as the deploy, and should run **before** `Deploy production`, so the chain becomes
  `tag v* → Migrate production (approve) → Deploy production`.
- The Edge Functions deploy that S1-04 ratified in `migrate-staging.yml` needs the same prod
  counterpart, with prod Stripe keys (live mode — a separate owner decision, and a separate Stripe
  webhook endpoint).
- `supabase db push` against prod wants `PROD_SUPABASE_DB_PASSWORD` and a `SUPABASE_ACCESS_TOKEN`
  scoped for it. Add both to the Gap 1 table once this workflow is written.

## Gap 5 — stale placeholders in `deploy-prod.yml` (S1 fixes in the prod boot, not now)
Two values in that file predate D-004 and are wrong today:

- `remote_dir: /home/shosho/shosho/prod` — user `shosho` is the **superseded** name from S1's original
  D-004 proposal. The real staging user is `shos`. Prod's user depends on Gap 2 and cannot be
  guessed now.
- It does not pass `backoffice_port`, so `_deploy.yml` defaults it to `8202` and health-checks a
  back-office that prod may not run. Whether prod serves the back-office on its own hostname is a
  product decision (it mirrors the `bo.shos.…` split S1-04 just set up for staging).

Left untouched on purpose: editing them now would encode a second round of guesses, and the workflow
cannot run before Gap 1–2 anyway.

## Gap 6 — no `docker-compose.prod.yml`
Only `docker-compose.yml` (local) and `docker-compose.staging.yml` exist. Prod needs its own, with
prod image tags (`vX.Y.Z`, not `staging`), its own `mem_limit`s sized to the Gap 2 host, and a
decision on whether the `api` placeholder ships at all (S1-04 found it idle at 32M RSS on a 160M limit).

## Suggested shape of the S1-06 boot
1. Owner decides Gap 2 and Gap 3 and provisions both; owner enters the Gap 1 secrets in environment
   `production`.
2. S1 writes `migrate-prod.yml` (Gap 4) and `docker-compose.prod.yml` (Gap 6), fixes Gap 5, and
   proves the chain with a throwaway tag against the new host.
3. S7 reviews the prod deploy before the first real tag — D-005 requires this, and it should be a
   precondition of the boot, not a follow-up.

**Do not schedule this before S7-01 reports** (D-004). Several of its findings will land on prod, and
it would be wasteful to build the prod pipeline twice.
