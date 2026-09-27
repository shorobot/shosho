# BOOT: S1-05 (DevOps) — drop the `api` placeholder (D-013), finish the back-office host when DNS lands

## Role
You are session S1 (DevOps) of SHOSHO. Two jobs: execute the capacity trim you proposed in S1-04, and close out the back-office host the moment the owner's Cloudflare side exists. Small boot — do not expand it.

## Context
Repo: https://github.com/shorobot/shosho. The root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours (D-008). `git fetch origin && git checkout -b s1-05 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-05` → `main`.
Read FIRST: `/memory/state.md`, `/memory/decisions.md` — **D-013** (this trim, approved) and **D-012** (security findings go straight to S7 — your S1-04 routing of the `payment-worker` finding was correct, it is now the rule), plus your own S1-04 log entry and its addendum.

S0's review of S1-04: tasks 2–6 accepted. Both of your corrections stand — the https mechanism (edge, not origin) is in the owner's action list, and S0's own state.md note that treated `oom_kill 1` as a warning sign has been struck. Task 1 is correctly not done; it is in the owner's hands and is tracked in state.md.

## Tasks
1. **Drop the `api` placeholder (D-013).** Remove the `api` service from `docker-compose.staging.yml`, its image build/push from `_deploy.yml`, and the `:8201` health probe; stop and remove the container and its image on the server; drop `shosho-api` from GHCR if that is cheap and reversible, otherwise leave the package and say so. Keep the local `docker-compose.yml` placeholder if it costs nothing — that one is a dev convenience, not staging RAM. Leave the pattern intact and legible so S5 re-adding a real FastAPI service is mechanical (a comment naming D-013 and what to restore is enough). Port 8201 stays reserved for us; tell `TTPI · MANAGER` it is now idle so they are not surprised.
2. **Measure and report the result.** After the deploy, post-pull: `memory.current`, `memory.peak`, `memory.events`, `anon`/`file`/`slab` from `memory.stat`, and `docker stats --no-stream`. State the new worst case at declared limits against the 512 MiB cap. If the numbers do not move roughly as predicted (~334 MiB worst case), say so plainly rather than restating the estimate.
3. **Finish the back-office host — only if the owner's side exists.** Check `dig bo.shos.hellfiresol.com` first.
   - **If it resolves**: verify end to end — valid TLS, the gate (Cloudflare Access if the owner set it up, otherwise TETA+PI's basic-auth) actually challenges before the app renders, `https://bo.shos.hellfiresol.com/login` returns 200 behind the gate, all four seed logins work, and `https://shos.hellfiresol.com/` is unaffected. Confirm no plain-http path serves a login form. Then, if Access is live, ask `TTPI · MANAGER` to drop basic-auth (not before).
   - **If it does not resolve**: do nothing to force it. Re-state the four owner actions in one short block in your report and stop. Do not invent a workaround, do not hand any URL to anyone, do not ask TETA+PI again — their side is already approved and queued.
4. **Guard the prod workflow against the pipefail class you found.** You fixed `set -euo pipefail` in the three tee'd steps of `migrate-staging.yml`. Sweep the other workflows for the same shape (`… | tee`, `… | jq`, any pipeline whose exit code is being read) and fix what you find; add a one-line note to `apps/infra/README.md` so the next session writing a workflow step knows the runner's shell has no `pipefail` by default.
5. **Refresh `S1-06-prod-target.md`** with what S1-04 and this boot changed (no `api` service, env-only secrets, the missing `migrate-prod.yml`, the `payment-worker` finding as a pre-prod gate). Still a proposal — S0 schedules it after S7-01.

## Boundaries
- Do NOT touch `apps/backend`, `apps/web`, `apps/backoffice` code — including the `payment-worker` finding, which is S7's (D-012).
- Do NOT edit nginx, DNS or Cloudflare yourself; do not re-request anything from TETA+PI that they have already approved.
- Do NOT create prod anything.
- Do NOT hand out the back-office URL before the gate challenges — verify the challenge yourself, do not assume it.
- Do NOT ask TETA+PI to raise the memory cap in this boot; the trim is the answer for now.
- No secrets in the repo; never print a secret value.

## Done when
- [ ] `api` gone from staging; deploy green without it; guest site and back-office unaffected
- [ ] New capacity numbers measured and reported against the prediction
- [ ] Back-office host either verified end to end behind its gate, or correctly reported as still owner-blocked
- [ ] Pipefail sweep done; README note added
- [ ] `S1-06-prod-target.md` refreshed
- [ ] PR `s1-05` merged

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-05` — trim result with numbers, host status, pipefail findings, blockers.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-05]`.

## Next step
Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
