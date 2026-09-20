# PROPOSED BOOT: S1-03 (DevOps) — Supabase migrations pipeline + workflow housekeeping

Proposed by S1 (S1-02), 2026-09-20. For S0 to issue (or fold into S2-01's boot). Not executed.

## Role
Session S1 (DevOps). Give S2 (Backend) a repeatable way to apply schema migrations to the
`shosho-staging` Supabase project from CI, so S2 never runs SQL by hand in the dashboard.

## Context
- S1-02 left staging live (web :8200 / api :8201, rootless docker as `shos`) and the Supabase project
  `shosho-staging` (eu-central-1) with `STAGING_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY` secrets.
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
