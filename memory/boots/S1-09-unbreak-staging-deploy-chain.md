# BOOT: S1-09 (DevOps) — unbreak the staging deploy chain; it has been skipping since #77

## Role
You are session S1 (DevOps) of SHOSHO. One job, roughly fifteen lines of YAML, and it is currently
blocking three open PRs from reaching staging. Do not expand it. **This is S0's miss, not a finding
against you or S6** — the cause is recorded in `log.md` 2026-10-12 and 2026-10-15.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** the root checkout
`/Users/bobbob/BOB/SERVER/SH.OS.` is yours. `git fetch origin && git checkout -b s1-09 origin/main`.
Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-09` → `main`.
Read FIRST: `/memory/state.md` (SNAPSHOT), `/memory/log.md`'s 2026-10-12 and 2026-10-15 S0 entries.

**The mechanism, measured rather than reasoned.** Merging S6-01's PR #77 added an **intentionally
failing** `e2e` job *inside* the `CI` workflow (`.github/workflows/ci.yml:243`). S6 correctly kept it out
of the `ci` gate's `needs`, so pull requests stay mergeable. But `Migrate staging` triggers on
`workflow_run: workflows: [CI]` and gates on `github.event.workflow_run.conclusion == 'success'`
(`migrate-staging.yml:96`), and **a workflow run's conclusion is computed from every job in the run, not
from the gate job**. `Deploy staging` chains off `Migrate staging` the same way
(`deploy-staging.yml:26`). So:

```
2026-10-11 22:23Z  CI 38180213644 success → Migrate 38180402557 success → Deploy 38180450228 success
2026-10-12 09:06Z  CI 38227747259 FAILURE → Migrate 38229595996 SKIPPED → Deploy 38229602837 SKIPPED
                   (in that CI run the `CI` gate job itself PASSED; only `e2e (apps/e2e)` failed)
```

Nothing has pushed to `main` since, so that is still the live state. **It will not heal on its own:**
S6's last four runs held at **15 passed / 16 failed / 2 skipped**, and only four of those failures are
routed to sessions. `needs` protects the merge gate; the run's *conclusion* gates everything downstream.

## Tasks
1. **Move the `e2e` job out of the `CI` workflow into its own workflow file.** `.github/workflows/e2e.yml`,
   mirrored to `apps/infra/.github/workflows/e2e.yml` — **both copies are real and both must change**; S6
   updated both and the mirror is this repo's layout, not a stray file. Same triggers it has today, so the
   job still reports its own status on every PR and every push to `main`. It simply stops entering `CI`'s
   conclusion. Carry S6's comment block across verbatim and extend it to say where the job now lives and
   why it moved — the comment is the reason the next person does not undo this.
2. **Do NOT use `continue-on-error: true`.** It would make the run conclude `success` and the chain work,
   while reporting green over **16 genuine product failures**. That trades a visibly broken pipeline for an
   invisibly broken test suite, which is the worse of the two and much harder to notice later.
3. **Check for the same trap elsewhere before you finish.** Any other workflow gated on a `workflow_run`
   conclusion has the identical exposure the moment someone adds an advisory job to the upstream workflow.
   Grep for `workflow_run` across both workflow directories and say in your report whether
   `deploy-prod.yml` or `migrate-staging.yml` carry it too, and whether a comment should warn about it.

## Boundaries
- Do NOT edit a single file under `apps/e2e` — the specs, fixtures and config are S6's. You are moving a
  **job definition**, not the suite.
- Do NOT add `e2e` to the `ci` gate's `needs`. It fails 16 tests today; making it required blocks every PR.
- Do NOT touch `apps/web` (#87 open), `apps/backoffice` (#89 open), `apps/backend`, or `docs/security.md`.
- Do NOT change what the `e2e` job *does* — not its timeout, not its retries, not its steps. Move it.
- No secrets anywhere; this change touches none.

## Done when
- [ ] `e2e` lives in its own workflow file, both root and `apps/infra` copies, S6's comment carried and extended
- [ ] `continue-on-error` NOT used; `e2e` still reports a red status of its own
- [ ] `ci.yml`'s `ci` gate job and its `needs` list are byte-identical to before, in both copies
- [ ] **Verified on `main` after merge, by run ID, not by expectation:** `CI` concludes `success`,
      `Migrate staging` **runs** (not skipped), `Deploy staging` **runs and succeeds**, and `e2e` reports
      its own failure separately
- [ ] The `workflow_run` sweep from task 3 reported
- [ ] PR `s1-09` merged

## Reporting
`/memory/log.md`: `## <date> — S1 DevOps — S1-09` — the four run IDs from the verification, and anything
the sweep in task 3 turned up. `/memory/state.md`: ONLY the S1 row. Commits `[S1-09]`.

**The verification rule that applies here with full force:** a change to the deploy chain is unverified
until a real `Deploy staging` run has passed. CI on your PR **cannot** prove any of this — the chain only
executes on `main`. S1-07 broke this same chain on fully green PR checks, for exactly this reason. State
plainly in your report that PR CI did not prove it and that you watched the `main` chain instead.

## Next step
After this, `Deploy staging` works again and #87 / #89 can merge and actually ship. Still S1's and unrun:
`S1-08`'s PR #88 awaits S0 review; `proposed/S1-prod-target.md` and `proposed/S1-explicit-secrets-map.md`
remain queued. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
