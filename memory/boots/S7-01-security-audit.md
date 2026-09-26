# BOOT: S7-01 (Security) — audit the whole stack before real data, fix what is yours, file the rest

## Role
You are session S7 (Security) of SHOSHO — the first security pass over a system that is now complete enough to attack: a public repo, a public storefront on the internet, a Supabase project with RLS and security-definer RPCs, Edge Functions handling money, a back-office about to get a public URL, and a shared server we do not own.

## Context
Repo: https://github.com/shorobot/shosho (**public**). **Working tree (D-008):** from `/Users/bobbob/BOB/SERVER/SH.OS.` run `git fetch origin && git worktree add .worktrees/s7 -b s7-01 origin/main`; work ONLY in `.worktrees/s7`. Never touch the root checkout or other worktrees; never bare `git stash`. PR `s7-01` → `main`; merge `origin/main` before any PR touching `/memory` (D-009). Repo language English (D-006).
Read FIRST: `/memory/state.md`, `/memory/decisions.md` (all, especially D-004 co-tenant, D-011 payments), `/memory/infra-access.md` (**binding** — the server is not ours), `/docs/api-contracts.md` §1–6, `/memory/log.md` entries for S2-01, S2-02, S1-03 and S4-01.

**Start from the known finding.** In S2-02 S2 discovered that Supabase's default privileges grant `EXECUTE` on every new `public` function to `anon` and `authenticated`, so `revoke … from public` does not remove them; combined with `if v_role not in (…)` evaluating to NULL for anon, **anon could have called `update_order_items`**. Migration 18 fixed the known set. Your job is to prove the class is gone, not just that instance.

## Tasks
1. **Authorisation matrix, proven by test.** For every table, view, function, bucket and Edge Function, assert what each of `anon`, `authenticated`(role owner/operator/kitchen/driver) and `service_role` can actually do, against a real database (local or `shosho-staging`). Write it as executable tests in `apps/backend/tests/security.test.ts` (S2's harness is there; you may add tests — do not rewrite S2's). Anything that contradicts §4/§6 is a finding.
2. **Function grants sweep.** Enumerate `pg_proc` in `public`: for each function list `proacl`, `prosecdef`, `proconfig` (`search_path` must be pinned). Assert no `anon`/`authenticated` EXECUTE except the intended guest RPCs (`quote_order`, `place_order`, `get_order_by_token`, and the helpers they need). Add a **regression test that fails when a future migration adds a function with default grants** — that is the real deliverable of this task.
3. **RLS sweep.** Every table in `public` (and `storage.objects` policies): RLS enabled, no policy with `using (true)` that exposes PII, no path where `anon` reads `orders`, `customers`, `staff`, `promo_codes` or private `settings` keys. Check the guest-tracking broadcast from S2-02: confirm the `realtime.messages` policy for `order:%` cannot be used to enumerate other guests' topics, and that the payload carries no PII.
4. **Money paths.** Review the Stripe flow end to end as code (no live account exists yet): webhook signature verification (tolerance, rotation, replay via `payment_events` idempotency), that `payment_jobs` cannot be driven by a non-service caller, that totals are never trusted from the client in `place_order` / `update_order_items`, that `amount_exceeds_authorization` cannot be bypassed, and that refunds/voids cannot be triggered by a guest. Report anything that could move money.
5. **Secrets & supply chain.** Scan the full git history for leaked keys (`gitleaks` or `git log -p` + patterns for `sk_`, `whsec_`, `service_role`, JWTs, private keys, `postgres://…:…@`). Check that no secret reaches the client bundles (`NEXT_PUBLIC_*` must contain only URL + anon key + publishable key). Review GitHub: branch protection, environment `staging` restrictions, who can push, whether any workflow echoes secrets, `pull_request_target` usage (there must be none), action pinning. Report, do not change protection rules yourself.
6. **Web surface.** Security headers on both apps (CSP, HSTS via Cloudflare, X-Frame-Options/frame-ancestors, referrer policy), cookie flags on the back-office session (Secure, HttpOnly, SameSite), open redirects, the tracking-token URL (`/order/[token]`) — token entropy, whether it leaks via Referer, whether it is guessable or enumerable. Rate limiting: `place_order`, `quote_order`, `create-payment-intent`, login — what stops 10k requests? Propose the cheapest control that fits (Cloudflare rules are free; do not build a service).
7. **Staff auth.** The four seed logins with a shared published password exist on staging. Decide and document the policy (rotate now, delete unused, require a real password on first login), and coordinate with S1 (who is adding an access gate in S1-04) — do not change the back-office code yourself; file the requirement.
8. **GDPR / legal check** (German market): what personal data is stored where (orders snapshot PII, `customers`, consents), the 24-month anonymisation job, GoBD 10-year retention, whether a single-customer erasure request can be served today (S2 says no — only the nightly job), cookie banner behaviour before consent (no analytics exists, verify nothing loads), and the legal pages' presence. Findings, not legal advice.
9. **Co-tenant hygiene.** Re-verify against `/memory/infra-access.md`: nothing listens outside `127.0.0.1:8200–8299`, nothing writes outside `/home/shos`, no sudo attempts, the ssh key is a deploy key used only by CI. Do not touch TETA+PI's files or probe their ports — read our side only, and say so in the report.
10. **Deliverables.**
    - `/docs/security.md`: the authorisation matrix, the threat model in one page, the controls in place, and the standing rules future sessions must follow (the function-grant pattern, RLS defaults, secret handling).
    - `/memory/boots/proposed/S7-02-<slug>.md` for anything that needs another session's hands (backend, frontend, infra), one file per owner session, each written as a ready boot task list.
    - Findings list in your log entry, ranked **critical / high / medium / low**, each with: what, where (file:line), how to exploit, and the fix.
    - Fix yourself ONLY what is purely a security artefact in your own files: the grants/RLS regression tests, `docs/security.md`, and — if a finding is *critical and one-line* in SQL — a new migration `apps/backend/supabase/migrations/…_security_fix.sql` with a clear comment (never edit an applied migration). Everything larger is a proposal.

## Boundaries
- Do NOT rewrite other sessions' code. Tests, docs, and at most a small additive security migration.
- Do NOT edit applied migrations, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/api-contracts.md` §1–6 (propose changes), or `/memory/infra-access.md`.
- Do NOT change GitHub branch protection, org settings, or Cloudflare — report to the owner/S1.
- Do NOT attack anything outside our own surface: no scans of the host's other services, no traffic to TETA+PI or hellfire, no third-party targets. Testing is limited to `shosho-staging`, our containers and our repo.
- Do NOT put any real secret, token or password into the repo, the docs or the report.
- Do NOT publish findings anywhere outside the repo.

## Done when
- [ ] `security.test.ts` passes and **fails** when you deliberately add a function with default grants (show that in the log)
- [ ] Grants, RLS, money-path, secrets, web-surface, auth, GDPR and co-tenant sections all reviewed with a written conclusion each
- [ ] `docs/security.md` written
- [ ] Every finding either fixed (small, yours) or filed as a proposal naming the owning session
- [ ] `backend` CI still green; PR `s7-01` merged

## Reporting
1. `/memory/log.md`: `## <date> — S7 Security — S7-01` — the ranked findings list (short lines), what you fixed, what is filed, what needs the owner.
2. `/memory/state.md`: ONLY the S7 row.
3. Commits `[S7-01]`.

## Next step
S7-02+ proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
