# Proposal → S1 DevOps: branch protection, rate limiting, staff password rotation

From S7 Security. Full context: `/docs/security.md` §5, `/memory/log.md` S7-01 entry. None of this is
S7's to change (owner/org settings, Cloudflare config, and a cross-session coordination item) —
filing so S1 (or the owner directly, via S1's next boot) can act.

## Task 1 (High) — GitHub branch protection on `main` is OFF

`gh api repos/shorobot/shosho/branches/main/protection` → `404 Branch not protected` (verified
2026-09-26). This contradicts `/memory/state.md`'s "Branch protection: PR + green `CI`, no
force-push" line — either it was never actually applied, or it was removed at some point. The repo is
public, has one collaborator (`tetakta`, admin) per `gh api repos/shorobot/shosho/collaborators`, and
`allow_forking: true`. Practically: right now nothing stops a direct push to `main` (bypassing CI and
review), a force-push, or branch deletion.

**Fix:** enable branch protection on `main` — required status check `CI` (the single aggregate job
already defined in `.github/workflows/ci.yml`), require a PR before merging, disallow force-pushes,
disallow deletion. This is a `gh api` call or a repo-settings UI action; needs admin (owner or
`tetakta`). Coordinate with S0 to correct `/memory/state.md`'s line once actually applied (S1 doesn't
own that file directly — flag it to S0).

## Task 2 (Medium/High) — no rate limiting anywhere on order-creation / payment endpoints

Confirmed by full-repo search: nothing in the workflows, Edge Functions, Next.js middleware, or
compose configs rate-limits `place_order`, `quote_order`, `create-payment-intent`, or the
back-office's `/login` beyond Supabase Auth's own generic default
(`apps/backend/supabase/config.toml`'s `[auth.rate_limit]` block — stock defaults, not tuned for this
app, and its CAPTCHA option is disabled).

Given `/memory/infra-access.md`'s terms (no nginx access, TETA+PI administers the host), the only
place this control can realistically live is a **Cloudflare rule** on the proxied zone
`shos.hellfiresol.com` (and `bo.shos.hellfiresol.com` once S1-04 lands) — that configuration lives
outside this repo and needs the owner's Cloudflare access. Suggested starting rules (cheap, free tier):
- Rate-limit `POST /rest/v1/rpc/place_order` and `POST /rest/v1/rpc/quote_order` (or, more simply, the
  whole `/rest/v1/rpc/*` path if Cloudflare can't distinguish by RPC name) — a guest placing more than
  a handful of orders per minute from one IP is not a real customer.
- Rate-limit `POST /functions/v1/create-payment-intent` similarly.
- Rate-limit `POST /auth/v1/token` (the back-office `/login` path) beyond Supabase's own default,
  once `bo.shos.hellfiresol.com` exists (S1-04).

## Task 3 (High, coordinate with S1-04) — rotate the shared staff seed password before the back-office gets a public URL

The four seed staff logins (`owner@shosho.test` / `operator@shosho.test` / `kitchen@shosho.test` /
`driver@shosho.test`) share one password, **published in this public repo's**
`apps/backend/README.md:154` (`shosho-test-2026`). This is already called out as a pre-condition in
S4-01's own proposal (`/memory/boots/proposed/S1-04-backoffice-host.md`, item 2) — S7 is reinforcing
it as a security finding, not a new discovery. **Do not let `bo.shos.hellfiresol.com` go live (DNS
does not currently resolve — checked 2026-09-26) before this is resolved.**

Options (owner/S1 decision, not S7's or S4's to make unilaterally):
1. Rotate to per-person passwords now, delete the ones nobody actually uses for testing.
2. Require a real password on first login (Supabase Auth supports invite-based flows) if these become
   real staff accounts rather than test fixtures.
3. At minimum, before the public URL exists: put an access gate in front (Cloudflare Access, or
   nginx basic-auth from TETA+PI) as a second layer, per S4-01's proposal.

## Task 4 (Low) — GitHub Actions supply-chain hygiene

All third-party `uses:` actions are pinned to a mutable major-version tag (`@v7`, `@v6`, `@v4`), not a
full commit SHA — common practice, but a tag can be moved by the action's maintainer (or, if their
account is compromised, by an attacker). No `pull_request_target` usage was found anywhere (good), and
no secret is ever echoed into a log. `secrets: inherit` is used in `deploy-prod.yml`/`deploy-staging.yml`
when calling the reusable `_deploy.yml` — broader than necessary (hands the *whole* secret set to the
callee's context, even though `_deploy.yml` only reads the prefixed ones it needs) but both callers are
already gated (tag-push + environment approval for prod; `main`-only `workflow_run` chain for staging).
Low priority: consider pinning actions to commit SHAs and replacing `secrets: inherit` with an explicit
secrets map next time these workflows are touched for another reason — not worth a dedicated PR on its
own.
