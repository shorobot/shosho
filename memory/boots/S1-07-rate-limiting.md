# BOOT: S1-07 (DevOps) — rate limiting, where it can actually live; plus workflow hygiene

## Role
You are session S1 (DevOps) of SHOSHO. Close the rate-limiting half of S7-01's finding — **after reading the correction below, because the proposal's own recommendation cannot work** — and do the small supply-chain hygiene item while you are in the workflows. Small boot. Do not expand it.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** the root checkout `/Users/bobbob/BOB/SERVER/SH.OS.` is yours. `git fetch origin && git checkout -b s1-07 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s1-07` → `main`.
Read FIRST: `/memory/state.md`, `/memory/decisions.md` — **D-016** (the owner chose SMS **and** email OTP, which is why this boot exists now), `/memory/boots/proposed/S7-02-S1-rate-limiting-password-rotation.md` (the finding — tasks 1 and 3 are yours, task 2 is the owner's and is tracked), and `/memory/boots/proposed/ROADMAP-customer-accounts-and-push.md` phase C.

**Why now.** Rate limiting has sat open since S7-01 with no owner. D-016 turned it from hygiene into a precondition: the owner chose **SMS** OTP, and unthrottled SMS is not a hygiene gap, it is an open bill. SMS pumping — a script requesting thousands of codes toward premium-rate numbers — is charged to the owner at German rates (≈ €0.03–0.09 per message; MessageBird ≈ €0.0317 is the chosen provider). **Also note it protects something live today:** `shos.hellfiresol.com` is a public storefront whose order RPCs anyone can call right now, and `bo-shos.hellfiresol.com` has had a public URL since 2026-10-05.

### Correction you must read before task 1 — S7's recommendation cannot work, and S0 verified why
`S7-02-S1-rate-limiting-password-rotation.md` task 1 concludes: *"the only place this control can realistically live is a **Cloudflare rule** on the proxied zone `shos.hellfiresol.com`"*, and lists `place_order`, `quote_order`, `create-payment-intent` and `/auth/v1/token` as the paths to limit. **Every one of those is unreachable from a Cloudflare rule on our zone.** S0 measured it:
- `apps/web/lib/api-supabase.ts:39` builds a **browser** client: `createClient(env.supabaseUrl, env.supabaseAnonKey)` from `NEXT_PUBLIC_SUPABASE_URL`, and calls `rpc("quote_order")` / `rpc("place_order")` on it (lines 180, 188).
- `apps/web/lib/cart.tsx` is `"use client"` and drives the debounced quote from the browser.
- `apps/backoffice/components/shell/LoginForm.tsx:46` calls `supabase.auth.signInWithPassword` from a client component — so the back-office login hits `*.supabase.co/auth/v1/token` directly too.
- **There are no API routes proxying any of it:** `find apps/web/app -name route.ts` returns nothing, and `apps/backoffice` has only `app/auth/signout/route.ts`.
- The decisive piece of self-evidence is in our own code: `apps/web/lib/csp.ts` has to put the Supabase origin in **`connect-src`** precisely *because* the browser connects to Supabase directly. If it did not, that CSP entry would be unnecessary.

So guest and staff traffic goes **browser → `bvmitglwwqsvufetlkff.supabase.co`**, never through Cloudflare's proxy of our two hostnames. A Cloudflare rate-limit rule on `shos.hellfiresol.com` would never see a single one of those requests. This was plausible reasoning that nobody had measured — the same shape as the `curl -H 'Host:'` error of 2026-09-30 — so it is corrected here rather than passed on. **Do not ask the owner for Cloudflare rules on those paths.**

## Tasks
1. **Supabase Auth rate limits — the layer that actually fronts the OTP risk.** `apps/backend/supabase/config.toml:197` has an `[auth.rate_limit]` block at stock values: `sms_sent = 30`/hour, `email_sent = 2`/hour, `sign_in_sign_ups = 30`/5 min, `token_verifications = 30`/5 min, `token_refresh = 150`/5 min.
   - **First, settle the load-bearing unknown and report it plainly: does `config.toml` reach the hosted `shosho-staging` project at all?** The migrate pipeline runs `supabase db push`, which pushes *database* objects. Auth configuration for a hosted project may be dashboard- or Management-API-managed, and the file's own comments hint at it (line 338 mentions `[auth.captcha]` "if self-hosting"). Find out — do not assume either way. If `supabase config push` (or the Management API) applies it, wire it into the pipeline or document the command. If it does not, say so and produce the exact dashboard settings instead. **Everything else in this task depends on that answer, so establish it first.**
   - **Flag, do not silently fix:** `email_sent = 2` per hour. If that value is live and applies to OTP mail, **email OTP is unusable** — two codes an hour across the whole project. D-016 chose email as one of the two channels, so this needs raising with S0 before S2-07 builds against it, not discovering during a demo.
   - Propose tuned values for OTP with a sentence of reasoning each, and state the worst-case monthly SMS spend the chosen `sms_sent` permits at €0.0317. A number the owner can read is the point.
2. **CAPTCHA on the auth endpoints — the direct answer to OTP abuse.** Supabase Auth supports hCaptcha and **Turnstile**; the zone is already on Cloudflare, so Turnstile is free and native. Determine whether it can be enabled for this hosted project and what the front-end would owe (a token on sign-in/OTP calls — that work is S3's and S4's, not yours). Report the exact enablement steps and what it costs the client side; **do not change `apps/web` or `apps/backoffice` yourself.**
3. **Cloudflare rules for what Cloudflare can actually protect** — and say so honestly in your report rather than implying wider cover. Our zone fronts the two Next.js apps, so a rule there can throttle floods against `shos.hellfiresol.com` and `bo-shos.hellfiresol.com` themselves (the storefront's own pages and the back-office login *page*). Write it as click-by-click for the owner, as you did in S1-04 — you have no Cloudflare access and must not ask for any rule that pins a hostname to Flexible (see `state.md`; that step is struck for good reason).
4. **Per-RPC throttling for `place_order` / `quote_order` is NOT yours — write the proposal and stop.** The real options are (a) throttling inside the `security definer` RPCs themselves, keyed on phone or a session id, with the honest caveat that a trustworthy client IP is not available at that layer — this is S2's; or (b) routing guest RPCs through our own origin so they *do* pass Cloudflare, which would also move the anon key server-side but is an architecture change spanning S3 and S1. Lay out both with the trade-offs and file as `proposed/S2-rpc-throttling.md`. Pick no winner; S0 decides. **S2 is mid-boot in `apps/backend` (S2-06) — do not touch that app.**
5. **Supply-chain hygiene (S7 task 3, Low).** Pin third-party `uses:` actions to full commit SHAs rather than mutable major tags, and replace `secrets: inherit` in `deploy-staging.yml` / `deploy-prod.yml` with an explicit secrets map naming only what `_deploy.yml` reads. Keep the full chain green — **verify the staging chain actually still runs after the change** rather than trusting that CI passing means the deploy path works; that distinction has bitten this project before.

## Boundaries
- Do NOT touch `apps/backoffice` (S4-03 is live in it) or `apps/backend` (S2-06 is live in it). `apps/web` only if a task above says so — none do.
- Do NOT edit DNS, nginx, the origin certificate or anything in Cloudflare yourself (D-004). You have no sudo and no nginx access; the zone is the owner's and is shared with TETA+PI and hellfire.
- Do NOT ask TETA+PI for anything in this boot. Nothing here is theirs.
- Do NOT implement the per-RPC throttle (task 4 is a proposal).
- Do NOT rotate the staff passwords — S7 task 2 is owner-only and is tracked in `state.md`.
- Do NOT create prod anything; the prod target is `proposed/S1-prod-target.md` and S0 schedules it.
- Never print a secret value.

## Done when
- [ ] Answered, with evidence, whether `config.toml`'s `[auth.rate_limit]` reaches the hosted project — and either wired it up or documented the dashboard equivalent
- [ ] `email_sent = 2` raised with S0 if it is live, before S2-07 builds against it
- [ ] Tuned OTP limits proposed, with the worst-case monthly SMS spend in euros
- [ ] Turnstile/hCaptcha feasibility answered with exact steps and the client-side cost
- [ ] Cloudflare rules written click-by-click for the owner, scoped honestly to what they can protect
- [ ] `proposed/S2-rpc-throttling.md` filed with both options and no winner picked
- [ ] Actions pinned to SHAs; `secrets: inherit` replaced; **staging chain verified green end to end, not just CI**
- [ ] PR `s1-07` merged

## Reporting
1. `/memory/log.md`: `## <date> — S1 DevOps — S1-07` — the config.toml answer first (it is the one everything depends on), then the numbers, then what Cloudflare can and cannot cover, then hygiene.
2. `/memory/state.md`: ONLY the S1 row.
3. Commits `[S1-07]`.
4. Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait to be routed.

## Next step
Proposals → `/memory/boots/proposed/`. Do not execute them. After reporting — stop and wait for S0.
