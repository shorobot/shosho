# Proposal → S1 DevOps: narrow `secrets: inherit` properly, with a real deploy to prove it

Filed by S0 2026-10-07, after restoring `secrets: inherit` because removing it broke the live deploy.

## What happened, so this is not attempted the same way twice
S7-01 task 3 flagged `secrets: inherit` on the `_deploy.yml` callers as broader than necessary — true,
and worth fixing. S1-07 removed it outright, reasoning that `_deploy.yml`'s `deploy` job declares
`environment: ${{ inputs.environment }}` on itself and so resolves `STAGING_*` from that environment
regardless of the caller. S1 cited GitHub's docs, which do say a job-level `environment:` wins over a
secret passed from the caller.

**The docs sentence was misread, and S1 identified the misreading precisely — this is their framing,
not S0's.** *"If you include `environment` in the reusable workflow at the job level, the environment
secret will be used, and not the secret passed from the caller"* is a **name-collision tie-break**: it
says which value wins when a secret exists in both places. It does **not** say environment-scoped
secrets populate a called workflow's `secrets` context with no pass-through at all. **Without
`secrets: inherit` or an explicit map, a called job's `secrets` context gets nothing.**

S0's first write-up of this blamed the **dynamic index** (`secrets[format('{0}_SSH_KEY', …)]`) and
claimed a static `secrets.NAME` would have resolved. **That was wrong and is retracted here** — the
context is empty either way, so the dynamic form is incidental, not causal. S1's reading is the one to
keep. (The dynamic form still matters for the *fix*, below, because it is what prevents an explicit
map from being written without a restructure.)

Measured: `Deploy staging` run **37640250636** failed at step **"SSH setup"** with `STAGING_SSH_HOST` /
`STAGING_SSH_USER` / `STAGING_SSH_KEY` resolving empty — before touching the server. It surfaced as a
clean, named failure rather than a baffling ssh error because of the
`[ -s ~/.ssh/deploy ] || { echo "::error::…"; exit 1; }` guard S1 added in S1-04. That guard paid for
itself.

Nothing was lost and nothing went down: `build & push images` succeeded, and the containers already
running were from the previous (green) deploy, so staging kept serving throughout. Only the pipeline
was red — and because no app change was pushed to `main` in the interval, nothing was actually blocked
by it. **Recovery verified on a real run** after PR #72 merged: run **37933161045**, `build & push
images` **success**, `deploy to staging` **success**; guest site 200 with its menu photo, back-office
401 at the gate, and the app's own CSP/permissions-policy/XFO still present inside the container.

## The actual fix, if it is still worth doing
The dynamic prefix is what makes `inherit` load-bearing. To narrow it, `_deploy.yml` needs **named
`secrets:` inputs** and the callers must map them explicitly:

```yaml
# _deploy.yml
on:
  workflow_call:
    secrets:
      SSH_HOST:        { required: true }
      SSH_USER:        { required: true }
      SSH_KEY:         { required: true }
      SUPABASE_URL:    { required: true }
      SUPABASE_ANON_KEY: { required: true }
# callers
    secrets:
      SSH_HOST: ${{ secrets.STAGING_SSH_HOST }}
      ...
```

That removes the dynamic lookup entirely, which is the point: the indirection bought a single shared
workflow for two environments, and it costs the ability to declare what crosses the boundary. Whether
that trade is worth unwinding is S0's call, not a given — `inherit` on a workflow that only `main` can
reach, into an environment restricted to `main`, is a much smaller exposure than it sounds.

## Conditions on doing it
1. **One environment at a time.** Change staging, merge, watch a real `Deploy staging` run to green,
   and only then touch prod — which has no target, so its first real exercise would be a tagged
   release and that is the worst place to discover a mistake.
2. **CI cannot prove this.** Every check on PR #70 was green; the failure only exists inside a real
   `Deploy staging` run on `main`. Any PR that touches secret plumbing is unverified until it has run
   there, and the report must say so rather than citing CI.
3. Keep S1-04's `[ -s ]` guard and add the same shape for any other secret the step depends on. It is
   the only reason this cost four minutes instead of a confusing ssh error.
4. Leave the commit-SHA pinning alone — that half of S7-01 task 3 landed fine and is unrelated.
