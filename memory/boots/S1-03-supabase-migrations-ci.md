# BOOT: S1-03 (DevOps) — Supabase migrations pipeline, secrets hardening, workflow housekeeping

Issued by S0 on 2026-09-20 from S1's own proposal (accepted as written, plus task 0 and the worktree/reporting rules below).
Working tree (D-008): the root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours. Branch `s1-03` from `origin/main`, PR to `main`. Read `/memory/state.md`, `/memory/decisions.md` (D-008 is new), `/memory/sessions.md` first.

## Task 0 — secrets hardening (added by S0; do this FIRST)
The repo is public. Repo-level secrets are readable by any workflow that any write-collaborator pushes.
- Move every `STAGING_*` secret and `SUPABASE_ACCESS_TOKEN` from repo-level into **environment secrets** of the `staging` environment (`gh secret set NAME --env staging`). The owner re-enters values you must not see (ssh key, Supabase keys, DB password, access token) — give them the exact `gh secret set … --env staging` commands in one list; `STAGING_SSH_HOST/USER` and `STAGING_SUPABASE_PROJECT_REF` you can set yourself (not secret). Delete the repo-level copies afterwards.
- Make `deploy-staging.yml`, `migrate-staging.yml` and `_deploy.yml` jobs declare `environment: staging`; restrict the `staging` environment to the `main` branch (`gh api -X PUT repos/shorobot/shosho/environments/staging -f deployment_branch_policy…` or UI).
- List org `shorobot` members and repo collaborators (`gh api orgs/shorobot/members`, `gh api repos/shorobot/shosho/collaborators`); report the list in the log. Expected: only the owner. Do not remove anyone yourself.
- Verify: a PR from a non-`main` branch cannot access `staging` secrets (the dry-run job in task 1 must work without them).

## Role
Session S1 (DevOps). Give S2 (Backend) a repeatable way to apply schema migrations to the
`shosho-staging` Supabase project from CI, so S2 never runs SQL by hand in the dashboard.

## Context
- S1-02 left staging live (web :8200 / api :8201, rootless docker as `shos`); deploy on `main` is green since 2026-09-20 14:47 UTC.
- Supabase project `shosho-staging` (eu-central-1) and the `STAGING_SUPABASE_*` secrets are the owner's item B — as of issue time they do NOT exist yet. If still missing when you start, do tasks 0 (partially), 2, 3, 4 first and ask the owner for B in the same list as the task-0 values.
- S2-01 will add `supabase/migrations/*.sql` (+ RLS) — it needs `supabase db push` to run on `main`
  after CI, before `Deploy staging`, and a `supabase db reset` path locally.
- Two prerequisites are owner-side secrets S1 must not see: `SUPABASE_ACCESS_TOKEN` (personal access
  token, dashboard → Account → Access Tokens) and `STAGING_SUPABASE_DB_PASSWORD` (set at project
  creation). Project ref is not secret (variable `STAGING_SUPABASE_PROJECT_REF`).

## Tasks
1. `apps/infra/.github/workflows/migrate-staging.yml`: `workflow_run` after `CI` on `main`
   (before `Deploy staging` — or make `deploy-staging.yml` depend on it), runs
   `supabase link --project-ref $REF && supabase db push` with the two secrets; dry-run (`--dry-run`)
   on PRs that touch `supabase/`. Sync to `/.github/workflows`, extend the "in sync" CI check.
2. `ci.yml`: when `supabase/config.toml` exists, lint migrations (`supabase db lint` or at least
   `psql --set ON_ERROR_STOP=1 -f` against a throwaway Postgres service container).
3. README section "Migrations": how S2 adds one, how it reaches staging, how to roll back.
4. Housekeeping (annotations seen in S1-02 runs): bump `actions/checkout@v4`→`v5`,
   `docker/*` actions to Node-24 releases; pin `ubuntu-24.04` instead of `ubuntu-latest`
   (label migrates to Ubuntu 26 on 2026-10-19).
5. Ask the owner (one list): `SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD` via
   `gh secret set`; `STAGING_SUPABASE_PROJECT_REF` variable (S1 can set it — not secret).

## Boundaries
No tables, no RLS, no seed data — S2 owns the SQL. No prod project. Nothing on the shared server
changes (migrations run from GitHub runners against Supabase cloud, not from the droplet).
Never print the DB password or access token.

## Done when
- [ ] `migrate-staging.yml` green on `main` with an empty/no-op migration set
- [ ] PR touching `supabase/` shows the dry-run diff in CI
- [ ] README "Migrations" written; workflows synced; deprecated action versions bumped
- [ ] log + state S1 row updated, PR `s1-03` merged

## Reporting
As in S1-02: `/memory/log.md` entry `## <date> — S1 DevOps — S1-03`, S1 row in `/memory/state.md`,
commits `[S1-03]`.


## Boundaries (S0)
Everything in your own proposal's boundaries, plus: do not touch `.worktrees/` of other sessions; do not edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/api-contracts.md`.

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-03` — what shipped, collaborator list, which secrets moved, migrate workflow status.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-03]`. Stop after reporting.
