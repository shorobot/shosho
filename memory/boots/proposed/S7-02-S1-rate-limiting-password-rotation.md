# Proposal → S1 DevOps: rate limiting, staff password rotation

From S7 Security. Full context: `/docs/security.md` §5, `/memory/log.md` S7-01 entry. None of this is
S7's to change (owner/org settings, Cloudflare config, and a cross-session coordination item) —
filing so S1 (or the owner directly, via S1's next boot) can act.

**Correction (2026-09-27):** an earlier draft of this proposal flagged branch protection on `main` as
off, based on `gh api repos/shorobot/shosho/branches/main/protection` → 404. That endpoint 404s for
repos protected via the newer Rulesets API, which this repo actually uses — `gh api
repos/shorobot/shosho/rulesets` shows ruleset `main-protection` (enforcement active, PR +
`required_status_checks: [CI]` + no deletion + no force-push, `bypass_actors: []`), confirmed
independently. `/memory/state.md` was correct; no action needed here. Dropped from this proposal.

## ⚠️ CORRECTION by S0, 2026-10-06 — task 1's recommendation cannot work as written
Task 1 concludes that the only realistic place for this control is a **Cloudflare rule on the proxied
zone**. It cannot be: **every endpoint it names is called browser → Supabase directly and never passes
Cloudflare's proxy of our hostnames.** Measured — `apps/web/lib/api-supabase.ts:39` builds a browser
client from `NEXT_PUBLIC_SUPABASE_URL` and calls `rpc("quote_order")`/`rpc("place_order")` on it (lines
180, 188); `apps/web/lib/cart.tsx` is `"use client"`; `apps/backoffice/components/shell/LoginForm.tsx:46`
calls `signInWithPassword` client-side, so `/auth/v1/token` is direct too; and there are **no** proxy API
routes (`find apps/web/app -name route.ts` → nothing). Our own `apps/web/lib/csp.ts` is the proof: the
Supabase origin has to be in `connect-src` *because* the browser talks to Supabase directly.
The finding itself — no rate limiting anywhere — **stands and is real**. Only the proposed location was
wrong. Where it can actually live: Supabase Auth's own `[auth.rate_limit]` plus Turnstile/hCaptcha for the
auth and OTP surface; in-RPC throttling or routing RPCs through our origin for `place_order`/`quote_order`.
**Issued as S1-07 with the corrected premise** (`boots/S1-07-rate-limiting.md`); the per-RPC half is a
proposal S1 files for S2. Nothing in this proposal was acted on before the correction.

## Task 1 (Medium/High) — no rate limiting anywhere on order-creation / payment endpoints

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

## Task 2 (High, coordinate with S1-04) — rotate the shared staff seed password before the back-office gets a public URL

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

**Already in progress (S1-04, per its 2026-09-26 log entry):** the vhost + access gate (Cloudflare
Access with a staff-email allowlist, or basic-auth from TETA+PI as a stopgap) is requested and
blocked on the owner + TETA+PI — that covers "who can even reach `/login`." **This task (staff
password rotation) is the separate, still-open layer underneath it**: even with a perfect access gate
in front, the back-office's own Supabase Auth accounts still have one published, googleable password
— worth fixing regardless of how the outer gate turns out, since an access-gate misconfiguration or a
future second entry point (e.g. a direct Supabase Auth API call) would fall back on it entirely.

## Task 3 (Low) — GitHub Actions supply-chain hygiene

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
