# BOOT: S6-01 (QA) — first end-to-end pass across guest, back-office and backend

## Role
You are session S6 (QA) of SHOSHO — the first session whose job is to disbelieve the other sessions' reports. Every layer has been built and self-tested by its author; nobody has yet walked a real order across all of them looking for the seams. S4-02 found one by accident (uploaded photos never render on the storefront — the back-office writes bucket paths, the site only accepted absolute URLs, and both sides' tests passed). Your job is to find the rest of that class, deliberately.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** from `/Users/bobbob/BOB/SERVER/SH.OS.` run `git fetch origin && git worktree add .worktrees/s6 -b s6-01 origin/main`; work ONLY in `.worktrees/s6`. Never touch the root checkout or other worktrees; never bare `git stash`. PR `s6-01` → `main`; merge `origin/main` before any PR touching `/memory` (D-009). Repo language English.
Read FIRST: `/memory/state.md`, `/memory/sessions.md`, `/memory/decisions.md`, `/docs/api-contracts.md` (§5 web, §6 back-office — the contracts you are testing), `/docs/design/README.md` (the product rules are the acceptance criteria), `/docs/security.md`, and the log entries for S2-01/02/03, S3-01, S4-01/02, S7-01.

Environment: staging is `https://shos.hellfiresol.com/` (guest) and `127.0.0.1:8202` over ssh tunnel (back-office — no public host yet; `ssh -N -L 8202:127.0.0.1:8202 shos@164.90.235.66` with `~/.ssh/shos_ed25519`), both against Supabase `shosho-staging` which has schema + seed. Seed staff logins are in `apps/backend/README.md`. **Staging is shared with other sessions' work** — do not wipe or reseed it; create your own test data, and clean up orders you create where you can.

## Tasks
1. **Write the scenario suite, not a pile of asserts.** Cover the journeys the design promises, each end to end across apps: guest browses → adds options → promo → checkout (delivery and pickup) → order appears on the board → operator accepts → kitchen prepares → driver delivers → guest's tracking page reflects every step; pre-order for a future slot; phone order created by an operator; cancellation and refund paths; out-of-zone and below-minimum rejections; stoplist mid-session; kitchen paused. Put them in `apps/e2e/` as a new pnpm workspace package (Playwright), or extend `apps/backoffice/e2e/` if that is genuinely simpler — say which and why. Tests must be runnable against staging **and** against a local stack.
2. **Hunt the seams specifically.** The interesting bugs live between sessions, not inside them. Check at minimum: money arithmetic agreeing between `quote_order`, the cart UI, the checkout summary, the board card, the detail totals and the CSV export (cents, VAT, tip, pickup discount, free-delivery threshold); the same order rendered in EN on the site and DE in the back-office; timestamps and `Europe/Berlin` handling across DST; option snapshots surviving a menu edit after the order was placed; a stoplisted item already in a guest's cart; an item deleted/renamed between cart and checkout; realtime actually delivering (the board without a reload) and what happens on reconnect; the tracking token after the order is completed.
3. **Verify the product rules from `/docs/design/README.md` literally** — each of the twelve, by test or by a documented manual check: guest checkout without an account, pickup −10 %, free delivery over the zone threshold, pre-order up to 7 days, auto-accept under 50 € only when the provider vouched for payment (note: S2-04 is changing this — coordinate, do not test the old behaviour), stoplist resets at midnight, category hidden when empty, allergy note propagating to every order card, allergens A–N present, VAT 7/19, consent required before any marketing, sequential order numbers.
4. **Re-verify, do not trust, the claims in the log.** Pick the load-bearing ones and check them yourself: S4-01's "order #1000 driven new→picked_up", S4-02's staging walk-through, S3-01's "cart totals come only from `quote_order`" (try to make the client and server disagree), S2-03's report views returning correct numbers, S7-01's authorisation matrix (spot-check two rows with a real anon key). Report agreement as plainly as you report a gap — "verified independently" is a useful result.
5. **The flaky test.** `apps/backend/tests/guest_realtime.test.ts` has failed three unrelated PRs and passed on re-run every time. S2-03 was asked to make it deterministic; check whether it did, and if it is still flaky, quantify it (run it N times, report the rate) and say whether it should be quarantined. A flaky required check blocks every session — treat it as a defect with a cost, not a nuisance.
6. **CI**: add a `e2e` job that runs whatever can run without a browser download problem on the runner, and document the rest as a local recipe. Do not make the required `CI` check depend on a suite that needs staging to be up — a green `main` must not require a live server.
7. **Report findings like S7 did**: ranked (critical/high/medium/low), each with what, where (file:line or screen + step), how to reproduce, and which session owns the fix. File one proposal per owning session in `/memory/boots/proposed/S6-02-<session>-<slug>.md`. Fix nothing outside `apps/e2e` yourself — you are the independent check; a QA session that patches the code it tests stops being one.

## Boundaries
- Do NOT modify `apps/web`, `apps/backoffice`, `apps/backend`, `apps/infra` — tests and proposals only. The single exception: if a test needs a `data-testid`, propose it rather than adding it.
- Do NOT reseed, truncate or reset `shosho-staging`; do not delete other people's orders; do not touch the `shos` server beyond the ssh tunnel.
- Do NOT use the service-role key anywhere in a test.
- Do NOT edit `/docs/api-contracts.md`, `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT test against anything outside our own surface.
- No secrets in the repo.

## Done when
- [ ] Scenario suite exists, runs, and its failures are real (a test that cannot fail is not a test)
- [ ] The seam checks in task 2 are all either passing or filed as findings
- [ ] Every product rule from the design README is verified or explicitly listed as unverifiable, with the reason
- [ ] The log claims in task 4 independently re-checked, agreement and gaps both reported
- [ ] Flaky-test verdict with numbers
- [ ] `e2e` CI job green and not dependent on staging being up
- [ ] Ranked findings in the log, one proposal per owning session
- [ ] PR `s6-01` merged

## Reporting
1. `/memory/log.md`: `## <date> — S6 QA — S6-01` — ranked findings, what you independently confirmed, flake numbers, what you could not test and why.
2. `/memory/state.md`: ONLY the S6 row.
3. Commits `[S6-01]`.

## Next step
S6-02+ proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
