# Proposal → owner (via S0): rate-limiting actions S1 cannot take itself

Filed by S1 (S1-07). Everything here needs either Supabase dashboard access or Cloudflare dashboard
access — S1 has neither (D-004: no Cloudflare; the Supabase dashboard holds live auth settings that
`config.toml` cannot reach — see below). Nothing in this file has been applied. Three independent
pieces: (1) Supabase Auth rate limits, (2) Turnstile CAPTCHA, (3) Cloudflare rate-limiting rules for
what Cloudflare can actually see.

## 1. Supabase Auth rate limits — `config.toml` does not reach the hosted project

**Measured, not assumed.** `.github/workflows/migrate-staging.yml`'s `push` job runs exactly two
Supabase CLI commands against `shosho-staging`: `supabase db push --include-seed` (schema + seed —
Postgres objects only) and `supabase functions deploy` (Edge Functions). It never runs
`supabase config push` or calls the Management API for project settings. The CLI itself confirms these
are different things — `supabase config push --help` (CLI v2.117.0, pinned in
`apps/backend/package.json`): *"Pushes the properties your local config.toml declares to the linked
project... Scripts and agents driving this command non-interactively should run `supabase config diff`
first and review it, rather than relying on the prompt"* — which is itself a reason **not** to wire this
into the pipeline casually: `config.toml` is full of local-dev-only values (`site_url =
"http://127.0.0.1:3000"`, disabled toggles, etc.) that a blanket `config push` would silently overwrite
on the hosted project the first time it ran. **So: `config.toml`'s `[auth.rate_limit]` block is
decorative for the hosted project today.** It governs only the local dev Supabase instance
(`supabase start`), not `shosho-staging`. Recommendation: don't wire up `config push` — set the values
below directly in the dashboard, which is also the only way to see what's live there right now (S1 has
no Supabase dashboard access to check).

**One value is not decorative, though.** Supabase's own docs state `email_sent` defaults to **2 emails
per hour, project-wide, "with the built-in email provider"** — this is a platform ceiling tied to their
shared relay, not a self-hosted-only default, so it very likely matches whatever `shosho-staging` has
right now too (nobody has configured custom SMTP — `[auth.email.smtp]` is commented out in
`config.toml` and no SMTP secrets exist anywhere in the pipeline). **If so, email OTP is capped at 2
codes per hour across every customer on the whole project** — D-016 chose email as one of two OTP
channels, and this needs confirming in the dashboard (Authentication → Rate Limits) before S2-07 builds
against it. The practical fix is not raising the dashboard number (it's tied to the built-in relay) but
configuring a real SMTP provider (SendGrid/Resend/Postmark — `config.toml` already has the SendGrid
shape commented in) before email OTP ships.

**`sms_sent` is also a global, project-wide hourly cap, not per-IP or per-number** (confirmed against
Supabase's docs — unlike `sign_in_sign_ups`/`token_verifications`/`token_refresh`, which are per-IP).
That cuts both ways: it already bounds worst-case spend to a single number regardless of how many IPs
an attacker uses, but it also means a flood from *one* IP can starve every real customer's OTP for the
rest of the hour — Supabase's rate-limit config has no per-IP SMS lever at all. **Turnstile (§2 below)
is the actual per-attacker defense; the number below only bounds total exposure.**

**Dashboard path:** `https://supabase.com/dashboard/project/bvmitglwwqsvufetlkff/auth/rate-limits`.

| Setting | Stock (`config.toml`, = likely hosted default) | Proposed | Reasoning |
|---|---|---|---|
| `sms_sent` (global/hour) | 30 | **20** | Bounds worst-case spend to 20×24×30 = 14,400 SMS/month × €0.0317 (MessageBird) ≈ **€456/month** even if hit every hour for a month — well above any real early-stage single-restaurant OTP volume, while cutting the stock worst case (30/hr → €684.72/month) by a third. Tune up once real volume is observed; pair with Turnstile, since this alone can't tell a flood from a busy dinner rush. |
| `sign_in_sign_ups` (per IP / 5 min) | 30 | 30 (unchanged) | Already per-IP, already a real lever; tightening it risks blocking several staff/customers behind one shared IP for little extra benefit once Turnstile sits in front of it. |
| `token_verifications` (per IP / 5 min) | 30 | **10** | This gates OTP-code *guessing*. A genuine customer needs 2–3 tries; an attacker brute-forcing a 6-digit code benefits far more from 30 tries per 5 minutes than any real user does. Cuts attacker throughput 3× at ~zero cost to legitimate use. |
| `email_sent` (global/hour) | 2 | **unchanged — flagged, not tuned** | Tied to the built-in relay per Supabase's own docs; raising the dashboard number is unlikely to move it meaningfully without custom SMTP. Confirm the live value, then decide SMTP before S2-07, not after. |
| `token_refresh`, `anonymous_users`, `web3` | stock | unchanged | Not part of the OTP flow; `anonymous_users`/`web3` are inert (both features disabled in `config.toml`). |

**Worst-case monthly SMS spend, for the owner to read directly:** at the stock `sms_sent = 30/hour`,
sustained for a full month, **€684.72** (21,600 SMS × €0.0317). At the proposed `sms_sent = 20/hour`,
**€456.48** (14,400 SMS × €0.0317). Both are *ceilings under sustained abuse*, not a forecast of normal
spend — real traffic for one restaurant's customer base will be far below either number.

## 2. Turnstile CAPTCHA on the auth endpoints

**Feasible, and cheap — the zone is already on Cloudflare.** Supabase Auth supports Turnstile natively
(`config.toml`'s own commented hint: `[auth.captcha]`, `provider = "hcaptcha"` or `"turnstile"` — but
note its neighboring comment, "`set up [auth.captcha] if self-hosting`", confirms this file's captcha
block is also local-only; the hosted project's captcha setting is dashboard-only, same story as §1).

Steps (owner, needs a Cloudflare account — the same one administering the zone — and the Supabase
dashboard; S1 has access to neither):
1. Cloudflare dashboard → **Turnstile** (top-level product in the left sidebar, not under the zone) →
   **Add site**. Register the hostname(s) that will show a login/OTP form:
   `bo-shos.hellfiresol.com` now (back-office login), and `shos.hellfiresol.com` once customer OTP
   ships (D-016 phase A/B). Widget mode: **Managed**. Copy the **Site Key** and **Secret Key**.
2. Supabase dashboard → project `shosho-staging` → **Authentication** → **Attack Protection** (or
   wherever the current dashboard build places "Enable CAPTCHA protection" — Supabase has moved this
   section before) → enable it → provider **Turnstile** → paste the Site Key and Secret Key → Save.
3. **Client-side cost, for whoever implements it (S3/S4, not S1):** render the Turnstile widget
   (`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` + a `cf-turnstile` div with
   the site key) on the form, capture the token it produces, and pass it as
   `options: { captchaToken: token }` to the `supabase-js` call (`signInWithPassword` /
   `signInWithOtp`). Both apps already pin `@supabase/supabase-js@^2.116.0`
   (`apps/web/package.json`, `apps/backoffice/package.json`), which has supported `captchaToken` for a
   long time — **no library upgrade needed.** Because both apps call Supabase directly from the browser
   (the correction above), this is a pure front-end change: no new server route, no key handling beyond
   the public Site Key, which is meant to be public. S1-07 does not touch `apps/web` or `apps/backoffice`
   itself (boundary) — this is scoping only.

## 3. Cloudflare rate-limiting rules — honestly scoped to what Cloudflare can see

**What this protects:** floods against the two Next.js apps' own HTTP(S) front door —
`shos.hellfiresol.com/*` (storefront pages) and `bo-shos.hellfiresol.com/*`, especially `/login`.
**What this does NOT protect, and must not be described to anyone as protecting:** `place_order`,
`quote_order`, `/auth/v1/token`, or any other call the browser makes straight to
`https://bvmitglwwqsvufetlkff.supabase.co` — none of that traffic passes through this zone at all (see
the correction in `boots/S1-07-rate-limiting.md`). That surface is §1/§2 above and
`proposed/S2-rpc-throttling.md`, not this section.

Steps (owner, Cloudflare dashboard, zone `hellfiresol.com`):
1. Zone `hellfiresol.com` → **Security** → **WAF** → tab **Rate limiting rules** → **Create rule**.
2. Rule 1 — `shos storefront flood guard`: match **Hostname equals `shos.hellfiresol.com`**; rate
   **more than 60 requests per 60 seconds per IP**; action **Managed Challenge** (not Block — a
   challenge still lets a real browser through after solving it, where Block would also catch a
   legitimate customer behind a shared/NAT IP during a dinner rush); challenge duration **10 minutes**.
3. Rule 2 — `bo-shos login flood guard`: match **Hostname equals `bo-shos.hellfiresol.com` AND URI
   Path equals `/login`**; rate **more than 10 requests per 60 seconds per IP**; action **Managed
   Challenge**, **10 minutes**.
4. **If the "Rate limiting rules" tab is greyed out or prompts to upgrade:** the zone's current
   Cloudflare plan does not include it. S1 has no Cloudflare access and cannot check the zone's plan
   tier from outside — the owner will see this directly. If unavailable, there is no cheap Cloudflare
   WAF substitute for a true rate-limit rule, and this item should wait on a plan check rather than
   being worked around with something weaker.

## Not in this file
- Per-RPC throttling for `place_order`/`quote_order` — `proposed/S2-rpc-throttling.md` (S2's call, S0
  decides).
- Staff password rotation — owner-only, tracked in `/memory/state.md`'s open-actions table already,
  unrelated to this proposal.
