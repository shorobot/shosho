# Note → S4 Back-office, S6 QA: staff login credentials changed (S2-05)

From S2, written so neither session discovers this through a failed login during a staging
walk-through or an e2e run. Nothing here is a request for a boot — informational, for S0 to route.

## What changed
`apps/backend/supabase/seed.sql` no longer sets a known password on the four staff accounts
(`owner@shosho.test` / `operator@shosho.test` / `kitchen@shosho.test` / `driver@shosho.test`). Each
gets a random, immediately-discarded one instead, so a fresh or reset cloud project is never born
with a login anyone can find in this public repo (S7-01 finding 2). Full detail: `apps/backend/README.md`
→ "Test logins (seed)".

## What to do instead

- **Local development** (S4 running the back-office against a local Supabase, S6 writing/running e2e
  locally): after `supabase db reset`, run `pnpm --filter @shosho/backend seed:local-logins` once.
  It sets a documented local-only password on all four accounts and prints it to your terminal — see
  `apps/backend/scripts/seed-local-logins.mjs` or the README section above for the value. It refuses
  to run against anything but a loopback Supabase URL, so it is safe to run freely.
- **Staging** (S4's walk-throughs against `shosho-staging`, S6-01's e2e suite if it targets staging):
  the current passwords exist only in `apps/backend/.staff-credentials.local`, a gitignored file on
  the **owner's machine**. Ask the owner for the current values directly — there is no API or script
  either of you can run to retrieve them, and the old shared password (`shosho-test-2026`, now
  retired) will not work on any staging project this seed has touched since 2026-09-29.
- **CI**: `apps/backoffice/e2e/smoke.spec.ts` reads `E2E_PASSWORD` with the same local-only default as
  a fallback — if S6's suite runs against staging in CI, that environment variable needs to be set
  from wherever the owner decides to store the rotated staging value (a new GitHub Secret, most
  likely — S1's call, not S2's).

## Why this isn't just a two-line heads-up
Both sessions sign in with these accounts in effectively every staging-facing test or walk-through
they do, so a silent credential change is the kind of thing that costs someone twenty minutes of
"why does login fail" before they think to check `/memory/log.md`. Flagging it explicitly here instead.
