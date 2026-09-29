# BOOT: S2-05 (Backend) — no known staff password may exist on a cloud project (micro-boot)

## Role
You are session S2 (Backend) of SHOSHO. One job, small: stop this public repository from shipping a working password for four staff accounts, and rotate the ones that exist on staging. This is a **precondition for the back-office getting a public URL** (S7-01 finding 2) — the DNS record could appear any day.

## Context
Repo: https://github.com/shorobot/shosho (**public**). **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -b s2-05 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s2-05` → `main`. Do this after S2-04 is merged, or alongside it if that is still in review — but do not let S2-04's remaining test work delay it.
Read FIRST: `/memory/boots/proposed/S7-02-S1-rate-limiting-password-rotation.md` (the finding), `/docs/security.md`, `/memory/state.md`.

**What S0 already established, so you do not re-derive it:**
- The string `shosho-test-2026` appears in `apps/backend/README.md:212`, `apps/backend/supabase/seed.sql:54,61`, `apps/backend/tests/helpers.ts:17`, and as a fallback in `apps/backoffice/e2e/smoke.spec.ts:5`.
- `seed.sql` inserts the four `auth.users` rows with `on conflict (id) do nothing`, so **a rotation done today survives every later seed run** — the risk is not that rotation gets undone, it is that any *new* cloud project (or a reset one) is born with a password published on the internet.

## Tasks
1. **Seed must never create a known password on a cloud project.** Preferred shape, unless you see a better one: `seed.sql` always sets a **random** password (e.g. `extensions.crypt(gen_random_uuid()::text, …)`), so no cloud project ever has a guessable staff login. Local development gets its known password from a small documented script (`pnpm --filter @shosho/backend seed:local-logins` or similar) that resets the four users through the **local** Supabase admin API after `db reset`. That keeps zero secrets in the repo and needs no change to S1's pipeline. If you prefer a GUC/env-driven password instead, say why in the report — but the outcome is non-negotiable: after this boot, cloning the repo must not give anyone a working staging login.
2. **Rotate the four staging users now.** Generate four strong, distinct passwords, set them on `shosho-staging` via the Auth admin API using the service-role key from your local env, and write them to a **gitignored** file outside the tracked tree (e.g. `apps/backend/.staff-credentials.local`, added to `.gitignore` in this PR). Tell the owner the file path in your report. **Never print a password in chat, in a log entry, in a commit, or in the README** — the path is the deliverable, not the values. If you do not have the service-role key locally, do not ask for it in chat: write the script, and give the owner a one-command recipe to run it themselves.
3. **Un-publish.** Remove the password from `README.md` — keep the table of emails and roles, and replace the password line with how to get local logins (task 1's script) and where the staging ones live (the gitignored file, owner's machine).
4. **Un-hardcode the consumers.** `tests/helpers.ts` reads the password from env with the local-dev default the script sets; `apps/backoffice/e2e/smoke.spec.ts` already reads `E2E_PASSWORD` — make its fallback the local default too, not a real credential. The `backend` CI job runs against local Supabase, so it must still work with no secrets configured; confirm it does.
5. **Tell the sessions that use these logins.** S4 signs in with them in every staging walk-through, and S6-01's e2e suite will. Write `/memory/boots/proposed/S2-05-credentials-note.md` — one short file naming the new local recipe and the fact that staging passwords now live only on the owner's machine — so S0 can route it without either session discovering it through a failed login.
6. **Check nothing else leaks.** Grep the repo (and `git log -p`) for the old string and for any other credential-shaped constant. If the old password reached the git history, say so plainly in the report — it is a public repo, so the honest conclusion is that the value must be treated as compromised, which rotation already assumes. Do not attempt to rewrite history.

## Boundaries
- Do NOT change any workflow (`apps/infra`, `.github`) — if the pipeline needs a change, propose it to S1.
- Do NOT touch `apps/web` or `apps/backoffice` beyond the single `E2E_PASSWORD` fallback in task 4.
- Do NOT put any password into the repo, a commit message, a log entry, the README, or this chat.
- Do NOT delete or recreate the staging users — rotate them; their `id`s are referenced by `public.staff`, orders and events.
- Do NOT edit `/docs/security.md` (S7 owns it), `/memory/decisions.md`, `/memory/sessions.md`.

## Done when
- [ ] A fresh `db reset` on a cloud project produces staff accounts nobody can log into without a deliberate reset
- [ ] The four staging users have new, distinct passwords; the owner knows the file path; no value appears anywhere in the repo or in chat
- [ ] `shosho-test-2026` no longer appears in any tracked file
- [ ] Local dev and the `backend` CI job still work with no secrets configured
- [ ] The note for S4/S6 is written
- [ ] `backend` CI green; PR `s2-05` merged

## Reporting
1. `/memory/log.md`: `## <date> — S2 Backend — S2-05` — what shape you chose and why, the credentials file path (path only), whether the old value is in git history, what S4/S6 must now do.
2. `/memory/state.md`: ONLY the S2 row.
3. Commits `[S2-05]`.

## Next step
S2-06 (campaigns, automations, banners/site publish) and single-customer erasure remain proposals. After reporting — stop and wait for S0.
