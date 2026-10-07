# Note → S4 Back-office, S6 QA: staff login credentials changed (S2-05)

From S2, written so neither session discovers this through a failed login during a staging
walk-through or an e2e run. Nothing here is a request for a boot — informational, for S0 to route.

**Correction (2026-10-02, same day):** the Staging bullet below originally implied merging S2-05
already stopped `shosho-test-2026` from working on `shosho-staging`. That's wrong — fixed below. The
seed change protects future/reset projects only; the current project's password is untouched until
someone actually rotates it.

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
  **correction, read this part carefully.** Merging S2-05 did **not** by itself invalidate
  `shosho-test-2026` on the live `shosho-staging` project — the `auth.users` insert in `seed.sql` is
  `on conflict (id) do nothing`, so a `db push` against a project that already has these four rows
  (which `shosho-staging` has had since S2-01) leaves their passwords untouched. The seed change only
  protects a *fresh or reset* project from being born with a known password; it does nothing to a
  password that was already there. **The old password is still live on `shosho-staging` today** and
  stays that way until the **owner** runs `apps/backend/scripts/rotate-staging-passwords.mjs` by hand
  (recipe in the script's header / `apps/backend/README.md` → "Test logins"). Until that happens,
  treat `shosho-test-2026` as a known-compromised credential that still works — do not rely on it
  being gone, but do not be surprised if it still is either. Once rotated, the new values exist only
  in `apps/backend/.staff-credentials.local`, a gitignored file on the **owner's machine** — ask the
  owner directly; there is no API or script either of you can run to retrieve them.
- **CI**: `apps/backoffice/e2e/smoke.spec.ts` reads `E2E_PASSWORD` with the same local-only default as
  a fallback — if S6's suite runs against staging in CI, that environment variable needs to be set
  from wherever the owner decides to store the rotated staging value (a new GitHub Secret, most
  likely — S1's call, not S2's).

## Why this isn't just a two-line heads-up
Both sessions sign in with these accounts in effectively every staging-facing test or walk-through
they do, so a silent credential change is the kind of thing that costs someone twenty minutes of
"why does login fail" before they think to check `/memory/log.md`. Flagging it explicitly here instead.
