# Proposal → S0: what production still needs before `deploy-prod.yml` can run (`S1-06`)

Written by S1 (DevOps) during S1-04, 2026-09-26. **Refreshed by S1-05 on 2026-09-27** — still a
proposal, still no prod work done. The boot forbids creating a production environment or a prod
Supabase project, and D-004 says the prod target is a separate decision after S7-01. This is the
inventory S0 asked for, so the boot can be scheduled with the gaps already known.

**What changed since the first draft (S1-05):** the `api` service no longer exists on staging (D-013),
so Gap 6 loses a question; the staging secret chain is now **environment-only and proven green**, which
turns Gap 1 from a guess into a copy of a working shape; the `payment-worker` finding is written up
below as **Gap 7, a hard pre-prod gate**; and a note on the runner's missing `pipefail` is attached to
Gap 4, because `migrate-prod.yml` is exactly the kind of file that class of bug hides in.

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
removed the last repo-level copies of the staging set. This is no longer a recommendation on paper:
the repo-level secret list is **empty** and the full staging chain has since run green on environment
secrets alone (`Migrate staging` 36273961641 → `Deploy staging` 36274003786), so prod copies a shape
that is known to work. Environment `production` must be restricted to the release ref the same way
`staging` is restricted to `main`, and it already carries the owner as a required reviewer.

One S1-05 consequence for this table: `_deploy.yml` no longer renders `SUPABASE_SERVICE_ROLE_KEY` or
`ANTHROPIC_API_KEY` into the server `.env`, because the `api` container was their only consumer
(D-013). **`PROD_SUPABASE_SERVICE_ROLE_KEY` therefore has no reader on the prod host either.** Keep it
out of the rendered file until something actually needs it, and when something does, give it that
service alone — do not restore the old blanket render. There is no `PROD_SUPABASE_DB_PASSWORD`
or prod `SUPABASE_ACCESS_TOKEN` in the list because **there is no prod migrate workflow yet** — see
Gap 4.

## Gap 2 — a prod host
D-004 is explicit that prod is **not** on the shared staging droplet, and the reason survives the
D-013 trim. Staging now runs **two** containers, not three, and the slice's worst case at declared
limits is ~330 MiB of 512 MiB (S1-05 measurement) instead of ~494 MiB. That margin is headroom for
**S5's real FastAPI service**, not an invitation to co-locate prod: the box is co-tenanted with
tetapi.dev and hellfire under someone else's administration, and staging and prod sharing one 512 MiB
cgroup means a staging deploy can OOM prod. TETA+PI's own words on the cap — they would "rather raise
it deliberately than discover it through an OOM at a bad moment." Options for S0/owner to decide:

- **A separate DigitalOcean droplet** (2 GB, Frankfurt, ours alone) — simplest, matches what the
  pipeline already knows how to do (ssh + rootless docker + compose), costs ~€12/mo.
- **A managed container platform** (Fly.io / Render / Railway) — no host to patch, but `_deploy.yml`
  would need rewriting away from ssh, and that is a bigger change than the prod boot should carry.
- **A second slice on the same droplet** — cheapest, and the one D-004 already ruled out. Still not
  recommended, and the D-013 trim does not change that: the freed RAM is earmarked for S5.

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
- **Write every step of it with `set -euo pipefail`.** The runner's shell is `bash -e {0}` — errexit
  only. S1-04 found this live in `migrate-staging.yml`, where `supabase functions deploy | tee
  "$GITHUB_STEP_SUMMARY"` reported *tee's* status: a failed function deploy would have gone green and
  `Deploy staging` would have shipped app code against functions that never landed. S1-05 swept the
  rest of the workflows and found three more instances of the same class. On prod that failure mode is
  a silent partial release. `apps/infra/README.md` documents the three shapes it takes.

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
prod image tags (`vX.Y.Z`, not `staging`) and its own `mem_limit`s sized to the Gap 2 host.

The `api` question this gap used to carry is **settled**: D-013 removed the placeholder from staging,
so `docker-compose.prod.yml` starts from `web` + `backoffice` and nothing else. A prod `api` service
appears only when S5 has a real one, sized from measurement. Whether prod serves the back-office at
all is the product decision already noted in Gap 5.

## Gap 7 — the `payment-worker` finding is a hard pre-prod gate
Found by S1-04, routed straight to S7 under D-012, and **not fixable by S1** — it is backend code.
`supabase/functions/payment-worker` has `verify_jwt = true`, but the **anon key satisfies that and the
anon key is public** (it ships in the guest web bundle). The function then acts with the service role
with no caller-role check, so anyone holding that public key can POST `{"action":"install"}` to rewrite
the pg_cron schedule, or POST with no action to drain the payment job queue.

Staging-only today — no Stripe keys, no real money — which is exactly why it must not be allowed to
become a prod problem. **Concretely: no `v*` tag may be cut until S7 confirms this is fixed.** S1 will
not build a pipeline that can ship it. D-005 already requires an S7 review before every tag; this is
the first named item on that review.

Related, and also S7's to confirm rather than S1's to assert: `migrate-staging.yml` installs the
pg_cron schedule with a non-blocking POST on the **anon key**, because that is how pg_cron invokes the
function. S1-04 left it on the anon key deliberately — swapping in the service-role key would hide the
finding instead of fixing it. The prod counterpart of that step must not be written until the function
itself authenticates its caller.

## Suggested shape of the S1-06 boot
0. **Gap 7 is closed** — S7 confirms `payment-worker` authenticates its caller. This is a
   precondition of the boot, not a step inside it.
1. Owner decides Gap 2 and Gap 3 and provisions both; owner enters the Gap 1 secrets in environment
   `production`, restricted to the release ref.
2. S1 writes `migrate-prod.yml` (Gap 4) and `docker-compose.prod.yml` (Gap 6), fixes Gap 5, and
   proves the chain with a throwaway tag against the new host.
3. S7 reviews the prod deploy before the first real tag — D-005 requires this.

**Do not schedule this before S7-01 reports** (D-004). Several of its findings will land on prod, and
it would be wasteful to build the prod pipeline twice.

One note for whoever audits the prod gate: `main` is protected by repository **ruleset** 23652140, not
classic branch protection, so `gh api repos/shorobot/shosho/branches/main/protection` answers 404 and
that 404 is **not** a finding (S0, 2026-09-27). Query `/rulesets`. The prod equivalent — environment
`production` with a required reviewer — is a separate mechanism from the branch ruleset, and both need
checking.
