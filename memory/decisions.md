# DECISIONS — architecture decisions

Format: `D-NNN — title` / Status / Decision / Why / Consequences. Decisions are never rewritten — a change is a new entry referencing the old one. Edited ONLY by S0.

---

## D-001 — Technology stack
Status: accepted 2026-09-17 (owner + S0). Amended by D-007.
Decision:
- DB / auth / realtime: **Supabase** (Postgres, RLS, Realtime)
- Guest site + ordering + back-office: **Next.js** (App Router, TypeScript)
- AI agents: **Claude Agent SDK**
- ~~Agent orchestration / integrations: n8n~~ — dropped, see D-007
- External integrations (Lieferando / Wolt / social webhooks): **FastAPI**
Why: realtime out of the box for the operator screen; one Postgres for every layer; agents work on the same DB without a separate bus.
Consequences: all sessions write to the same Supabase schema; contracts between layers = tables + RLS + REST/RPC, documented in /docs/api-contracts.md.

## D-002 — Project memory lives in git
Status: accepted 2026-09-17
Decision: `/memory` in the main repo is the single source of truth. Every session reads state.md + decisions.md before starting and writes to log.md after.
Why: Claude session context gets cut; files in git do not.
Consequences: every commit prefixed `[S<N>-<NN>]` (see /memory/sessions.md). S0 is the only one editing decisions.md and the state.md table as a whole; child sessions edit only their own row and log.md.

## D-003 — Sequential start, one active boot per session
Status: accepted 2026-09-17
Decision: S1 → S2 → S3 → S4, then S5 ‖ S6 ‖ S7 in parallel. At most one open boot per session.
Why: each layer depends on the previous layer's contracts; parallel edits of one contract without coordination break the system.
Consequences: a shared-contract change (API, DB schema) goes only through S0, who updates /docs/api-contracts.md and issues boots to both sides.

## D-004 — Hosting / server
Status: **accepted 2026-09-20** (owner). Supersedes S1's proposal of 2026-09-18 (`boots/proposed/decision-D-004.md`, kept for history).
Decision: staging runs as an **isolated co-tenant on the owner's existing shared DigitalOcean droplet** (Frankfurt) under the terms set by the TETA+PI manager — user `shos`, `/home/shos` only, 512M RAM hard cap, ports `127.0.0.1:8200–8299`, rootless docker or `systemd --user`, no sudo, no nginx access. Domain `shos.hellfiresol.com` is provided. Full terms: `/memory/infra-access.md`.
Why: zero extra cost, EU data, server already exists. The 512M cap is workable once n8n is out (D-007): web + api placeholders fit in ~150–250M.
Consequences: S1's infra assumptions (deploy user `shosho`, `/opt/shosho`, host nginx edits, root bootstrap, certbot/sslip.io) are obsolete and must be removed (S1-02). Any infra change on the host = request to `teta-pi-e0`. Prod is NOT on this box — separate decision after S7-01. If SHOSHO needs more than 512M later → request to TETA+PI or a dedicated droplet (owner decides).

## D-005 — Environments
Status: accepted 2026-09-17
Decision: two environments — `staging` (branch `main`, auto-deploy) and `prod` (git tag `v*`, manual approve). Local dev — `.env.local` + Supabase local or a separate dev Supabase project.
Why: a team of AI sessions makes many small commits; prod must not break on each one.
Consequences: S1 sets up both pipelines; S7 Security reviews the prod deploy before every tag.

## D-006 — Repository language is English
Status: accepted (owner instruction 2026-09-18 via S1; applied by S0 2026-09-20)
Decision: everything committed to the repo is in English — code, comments, commits, `/memory`, `/docs`, boots, proposals, READMEs, UI placeholders. Ukrainian only in chat.
Why: readable for any contributor, tool or model; no mixed-language drift between sessions.
Consequences: log entries written before 2026-09-20 stay in Ukrainian (history is not rewritten). Every new boot is issued in English.

## D-007 — n8n dropped from the stack
Status: accepted 2026-09-20 (owner)
Decision: n8n is removed from D-001. Agent orchestration, schedules and webhooks are implemented in code: FastAPI (webhooks, HTTP), Claude Agent SDK (agents), plain cron / systemd timers (schedules).
Why: n8n would be needed only at S5 (3–4 boots away), costs 300–500M RAM — most of the 512M budget — and adds a second runtime to operate. The same is done in code with what we already have.
Consequences: remove n8n from `docker-compose.yml`, `.env.example`, infra README, GitHub Secrets (`STAGING_N8N_*`). Revisit only if S5 proves a concrete need (new decision).

## D-008 — One git worktree per session
Status: accepted 2026-09-20 (S0, after an incident)
Decision: sessions never share a working tree. The main checkout `/Users/bobbob/BOB/SERVER/SH.OS.` belongs to **S1 DevOps** (it was there first). Every other session works in its own worktree: `git worktree add .worktrees/<session> -b <branch> origin/main` (e.g. `.worktrees/s2`, branch `s2-01`). S0 uses `.worktrees/s0`. `.worktrees/` is git-ignored. Never use bare `git stash` — the stash stack is shared across worktrees.
Why: on 2026-09-20 S0 and S1-02 ran concurrently in one checkout; S0's `git checkout -b` moved HEAD away from `s1-02`, S1's first commit landed on S0's branch and got merged via S0's PR #3. Nothing was lost, but the attribution and branch history are muddled.
Consequences: every boot states the worktree path. A session that finds HEAD on a branch that is not its own must stop and report instead of committing.

## D-009 — Report PRs merge `origin/main` first; `memory/` is append-only for child sessions
Status: accepted 2026-09-20 (S0, after three consecutive conflicts in `memory/log.md` / `state.md`)
Decision: before opening or updating a PR that touches `/memory`, a session runs `git merge origin/main` into its branch and resolves conflicts in `memory/` by **keeping both sides** (log entries are appended in time order; in `state.md` each session keeps only its own row's change). Child sessions never rewrite lines they do not own. S0 merges child PRs that touch only `memory/` without waiting for the child.
Why: S0, S1 and S2 all write to the same two files; PRs opened minutes apart conflict every time.
Consequences: a report PR that conflicts is rebased by its author, not by S0 — unless the author has already stopped, in which case S0 resolves and merges.

## D-010 — Back-office shares brand tokens, not components, with the guest site (v1)
Status: accepted 2026-09-20 (S0)
Decision: `apps/backoffice` starts in parallel with `apps/web` and owns its own component set. Shared surface = the 7 brand colours, the two typefaces, motion tokens and the pill CTA — copied from `/docs/design/README.md` as CSS variables in each app. Extraction into a `packages/brand` (or `packages/ui`) workspace package is a later boot once both apps exist.
Why: the two UIs differ (EN guest storefront vs DE dense admin), the design canvas shares no components between them, and waiting for S3 to finish first costs a full boot of wall-clock time.
Consequences: small duplication (one CSS file, one font config) accepted for v1. Neither session edits the other's app.

## D-011 — Payments v1: Stripe with manual capture; webhooks in a Supabase Edge Function; Bitcoin deferred
Status: accepted 2026-09-21 (owner)
Decision: one provider in v1 — **Stripe** (cards, Apple Pay, Google Pay, PayPal via Stripe's EU PayPal method). Flow: PaymentIntent with `capture_method: manual` created at checkout → `authorized` → captured when the order reaches `delivered` / `picked_up`, voided on `cancelled`, refunded on `refunded`. Cash on delivery stays as is (driver confirms). Stripe webhooks are received by a **Supabase Edge Function** (`supabase/functions/stripe-webhook`), deployed by the same `migrate-staging` pipeline. Bitcoin is not implemented in v1 (needs a separate service — BTCPay — or a processor; revisit after launch).
Why: Stripe covers every method in the design except Bitcoin with one integration; manual capture matches the design copy "Payment is captured on delivery confirmation"; an Edge Function keeps payment logic next to the DB, costs zero RAM on the 512M droplet and needs no new host. FastAPI (D-001) remains for Lieferando/Wolt/social webhooks (S5).
Consequences: owner creates a Stripe account for Shosho Sushi GmbH and provides `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test mode first) as staging secrets; S2 builds against Stripe test keys of its own until then. `payment_method` enum keeps `bitcoin` for schema stability but the UI hides it (`settings.payments.enabled.methods`).

## D-012 — Security findings go straight to S7; S0 is told, not asked
Status: accepted 2026-09-27 (S0, ratifying what S1 did in S1-04)
Decision: a session that finds a security issue outside its own boundary sends it directly to S7 (or, if S7 is not running, files `/memory/boots/proposed/S7-<slug>.md` and says so in its report) and mentions it to S0 — it does not wait for S0 to route it. Everything else (contracts, scope, priorities, cross-session work) still goes through S0 (D-003).
Why: S1 found that `payment-worker` accepts the public anon key while acting with the service role, and sent it to S7 mid-audit instead of parking it for S0. Routing latency on a live security finding is a cost with no upside; S7's audit was already in flight and would otherwise have shipped without it.
Consequences: S0 tracks such findings from the log rather than gating them. A finding that also changes a contract still needs S0 for the contract part.

## D-013 — Drop the `api` placeholder from staging until S5 needs it
Status: accepted 2026-09-27 (S0, on S1's recommendation in S1-04; TETA+PI left the timing to us)
Decision: remove the `api` service from `docker-compose.staging.yml` (and its image build) until S5 Automation actually ships a FastAPI service. Implemented in S1-05.
Why: it is an idle placeholder at 33 MiB RSS holding a 160 MiB limit. Removing it takes the slice's worst case from ~494 MiB to ~334 MiB of a 512 MiB cap — ~178 MiB of real margin — at zero cost. Cheaper and more honest than asking TETA+PI to raise a cap shared with tetapi.dev.
Consequences: S5-01 re-adds an `api` service when it has one, sized from measurement, and asks TETA+PI for headroom only if the numbers require it. `_deploy.yml` keeps the pattern so re-adding is mechanical. The health check that probes `:8201` goes with it.


## D-014 — Migration filenames are claimed before they are written
Status: accepted 2026-09-27 (S0, after S2-03 and S7-01 both created `20260926000019` and `...020`)
Decision: a session that will add migrations picks its numbers from `main` **at branch time** and immediately records the range it is claiming in its boot's log entry or, if it needs them mid-flight, in `/memory/state.md`'s open list via S0. Before opening a PR, re-check `main` and renumber if someone else's migrations landed first. The session whose PR merges second always renumbers.
Why: two sessions running in parallel both numbered from the same `main` and produced colliding version prefixes. Supabase keys `schema_migrations` on the numeric prefix, so the second file to be applied is silently treated as already applied and **never runs** — a schema that looks migrated and is not. S1's `plan` job catches edited/renamed/out-of-order migrations but not a same-prefix collision.
Consequences: S1 should extend the `plan` job to fail on a duplicate version prefix against `main` (proposal, not this boot). Until then it is a human rule enforced at review by S0.

## D-015 — No client-side analytics in v1; the funnel is measured server-side or not at all
Status: accepted 2026-10-06 (S0, ruling on the open question in `boots/proposed/S2-03-reports-campaigns-cms.md` §1)
Decision: SHOSHO v1 collects **no client-side behavioural events**. The `site_events` table S2 proposed (`page_view`, `add_to_cart`, `checkout_started`, written by `apps/web` with an insert-only `anon` policy) is **not built**. `report_funnel` stays server-side, derived from `order_attempts` and `orders` only, and must report honestly what that data can and cannot support (S2-06 task 8). Whether to add first-party analytics later is an **owner** decision, not a session's, and is on the owner's open-questions list.
Why: three reasons, in order of weight. (1) It is new collection of personal data on a German storefront for a GmbH — a privacy posture belongs to the owner, not to S0 or S2, and S2's own proposal correctly said "S0 should rule on it before S2 builds it" rather than assuming. S2's design was careful (no IP, no user agent, cookie-less id in `sessionStorage`, first-party aggregate) and the argument that it is consent-free is *plausible*, which is not the same as settled — and the cookie bar, the four DE legal pages and the consent model would all need to say something they currently do not. (2) It needs two sessions to move together (S3 writes the events, S2 reads them) for a reporting nicety, while the thing actually blocking the business is three owner actions and a live payment that has never run. (3) The existing funnel's defect is not a missing-data problem at all — it is a window-versus-meaning problem that server-side data can fix on its own, so building a tracking surface would not have fixed the bug that prompted the question.
Consequences: the funnel's menu→cart step stays unmeasurable in v1, and the Berichte screen must show that honestly rather than with an invented number — S4-04's boot will say so. S2-06 is explicitly forbidden from building `site_events`. Revisiting it is a new decision, taken with the owner, and it should come with the legal-page and consent changes in the same breath rather than after.

## D-016 — Customer accounts: optional, OTP by SMS **and** email, bonuses deferred, push as the primary channel
Status: accepted 2026-10-06 (owner, answering S0's four questions on `boots/proposed/ROADMAP-customer-accounts-and-push.md`)
Decision:
- **Accounts are optional.** Guest checkout survives unchanged as a first-class path. This retires the design's product rule "Guest checkout, no account" (`docs/design/README.md` lines 26 and 48) — the rule becomes "guest checkout always available; an optional account adds a personal cabinet, saved addresses and messages". The design and the twelve-rule list must be updated in the same boot that ships the login, or S6 will correctly report the feature as a rule violation. *(This clause is S0's stated assumption from the owner's description — "name and address can be added later" — and is the one part of D-016 the owner did not answer explicitly. Confirm before S2-07 is issued.)*
- **OTP by both SMS and email** from the first release, owner's choice over S0's email-only recommendation. Consequence accepted: see the rate-limiting clause below, which becomes blocking rather than advisory.
- **SMS provider: MessageBird**, unless the owner prefers otherwise after seeing a real quote. The owner asked S0 to look at TurboSMS (Ukrainian) and to find a German equivalent. Measured, October 2026 list prices: **TurboSMS international ≈ €0.067–0.068/SMS** and it is **not** one of Supabase Auth's built-in providers, so it needs a custom Send SMS Hook. **MessageBird ≈ €0.0317/SMS** — roughly half the price — **and is built into Supabase Auth**, so no hook. Twilio ≈ €0.094, Sinch ≈ €0.0785, Plivo ≈ €0.089. Germany is among the priciest EU routes because of carrier termination fees and three carriers. So the cheaper option is also the less work, which settles it. These are list prices, not quotes — confirm with MessageBird for DE OTP volume before committing.
- **Bonuses are deferred** out of the first release and get their own design pass with the owner. Nothing exists today: zero occurrences of bonus / loyalty / points / reward in the schema and nothing in the design canvas, so a session would be inventing the product rules. The first release is login + cabinet + saved addresses.
- **Push is the primary channel**, with an in-app **bell / notification centre** showing unread messages. Native Android and iOS apps are planned later and will carry direct push and banners.
Why: the owner's own framing on each. On the provider, the two candidates were compared on both price and integration cost and one wins on both. On bonuses, the owner agreed with deferring rather than having a session invent loyalty rules. On push, the native-app plan removes the iOS web-push limitation for the app audience, which was S0's main argument for email-first — so that argument no longer applies and the owner's preference stands.
Consequences:
- **Rate limiting stops being advisory.** SMS OTP without throttling is an open financial exposure, not a hygiene gap: SMS pumping lets a script bill the owner thousands of messages at German rates. The open S7-01 rate-limiting finding becomes a **hard precondition of shipping phone OTP** — per-identifier, per-IP and global daily caps, plus a spend alarm. S7-03 owns it and must land with or before S2-07's phone channel. Email OTP carries no such cost and could ship first if the owner wants login sooner.
- **The bell is not push, and that is a feature.** An in-app notification centre is DB rows plus unread state plus realtime — it needs no permission prompt, no service worker, no VAPID, no PWA install, and it works identically on every platform including iPhone Safari. It is therefore the *reliable* surface and push is the nudge that drives people back to it. It gets its own phase ahead of push transport, because it delivers the owner's "bell with new messages" on its own.
- **Push transport must be channel-agnostic from the first migration.** Because native apps are coming, the token store must hold a web-push subscription, an FCM token or an APNs token behind one interface, with the channel as a column. Designing it web-push-only and retrofitting later is the expensive order.
- The design's product-rule list and the Kampagne screen's reach copy both change; `report_funnel`'s unmeasurable menu→cart step (D-015) is unaffected.
## D-017 — Email OTP needs real SMTP before it ships; `sms_sent` is a spend ceiling, not a defence
Status: accepted 2026-10-07 (S0, on S1-07's measurements; amends the email half of **D-016** rather than replacing it)
Decision: the email OTP channel chosen in D-016 **does not ship until `shosho-staging` has a custom SMTP provider configured**. The SMS channel's `sms_sent` cap stays a spend ceiling only, and **Turnstile is the per-attacker defence** — the rate-limit numbers are not treated as one.
Why, measured by S1-07 rather than assumed:
- **`email_sent = 2`/hour is a global, project-wide Supabase platform default tied to their built-in email relay** — not a local-CLI quirk. `[auth.email.smtp]` is commented out and no SMTP secret exists anywhere in the pipeline, so the live project plausibly carries it. If so, email OTP is capped at **two codes an hour across every customer on the whole project**, which is not a usable login. **Raising a dashboard number does not fix it**: the cap is a property of the shared relay, so the fix is a real SMTP provider.
- **`sms_sent` is global too, not per-IP** — unlike `sign_in_sign_ups`, `token_verifications` and `token_refresh`, which are per-IP. Two consequences: worst-case spend is bounded regardless of how many IPs an attacker has, **and** a single-IP flood can starve every real customer's OTP for the rest of the hour. Supabase offers no per-IP SMS lever at all, so the cap cannot be the defence.
- **`config.toml`'s `[auth.rate_limit]` does not reach the hosted project.** The pipeline runs `supabase db push` and `supabase functions deploy`, never `config push` — which is a separate command the CLI's own help warns against running blind, and `config.toml` is full of local-only values (`site_url = http://127.0.0.1:3000`, disabled toggles) that a blanket push would overwrite on a live project. So every rate-limit value is a **dashboard** action, not a repo change.
- Worst-case monthly SMS spend at MessageBird's €0.0317: stock `sms_sent = 30`/hour sustained → 21,600 → **€684.72**; proposed `20`/hour → 14,400 → **€456.48**. Ceilings under sustained abuse, not forecasts.
Consequences:
- **S2-07 must not build the email channel against the built-in relay.** Either SMTP lands first, or the first release is SMS-only — and the owner now has a real reason to prefer one, where D-016 had them choosing on cost alone.
- The owner gains a new open action: choose and configure an SMTP provider (Postmark, Resend, SES, or their existing mail host). This is also what the back-office will need for any transactional mail later, so it is not a cost specific to OTP.
- **Turnstile moves from "nice" to load-bearing** and is cheap: Supabase Auth supports it natively, the zone is already on Cloudflare, `@supabase/supabase-js@^2.116.0` already accepts `options.captchaToken`, and wiring it is a pure front-end change in `apps/web` / `apps/backoffice` — so it belongs to S3 and S4, not S1. Click-by-click steps are in `proposed/S1-07-rate-limiting-owner-actions.md` §2.
- D-016's SMS-provider choice (MessageBird) is unaffected and its rate-limiting precondition still stands — it is now better specified: the lever is Turnstile plus dashboard values, not a config file.

## D-018 — Throttle `place_order` in the RPC; do NOT throttle `quote_order` there; defer the origin proxy
Status: accepted 2026-10-10 (S0, deciding the open question in `boots/proposed/S2-rpc-throttling.md`, which S1 correctly filed without picking a winner)
Decision: take **Option A, scoped to `place_order` only**. Reject Option A for `quote_order`. **Defer Option B** (routing guest RPCs through our own Next.js origin) with an explicit trigger rather than a vague "later". **Nothing ships until S6-01 lands** — both RPCs are the exact surface S6 is testing right now.
Why:
- **The scope correction is the substance of this decision, and it rests on a cost neither option priced.** `quote_order` is called on **every cart change, debounced 300 ms** (`apps/web/lib/cart.tsx:201-206`) and **writes nothing** — S0 checked: zero `insert`/`update`/`delete` in its body. It is a pure pricing read. Option A's mechanism is an `insert … on conflict do update` into a counting table, so applying it to `quote_order` would convert the **hottest read path in the system into a write on every call**. That is a real, permanent cost against an abuse case whose only consequence is compute: a quote creates no rows, no operator noise and no promo burn.
- **`place_order` is where the consequence actually lives.** It inserts orders, so abuse means fake orders on the operator's board during service, plus promo-code burn (first-order promos are checked by phone). Low frequency, high consequence — exactly the right shape for a cheap in-RPC throttle. Keyed on phone and/or the guest session id, accepting S1's honest caveat that both are client-supplied: this stops a careless or casual script, not a determined attacker, and must be documented as such rather than described as rate limiting.
- **Option B is the only real defence and is also the riskiest thing we could do right now.** It gets genuine Cloudflare coverage, which is the thing S1-07 task 3 had to admit it could not provide. But it is an architecture change to the **guest ordering path** — the single most important flow in the product, which has still never had a live payment run through it — and S6-01 is mid-QA on precisely that path. Changing it now would invalidate their pass and put the one flow that matters most at risk for a threat we have not yet observed.
Consequences:
- **Trigger for revisiting Option B, so it is not left to drift:** do it when either (a) real abuse appears in `order_attempts` or the operator board, or (b) the customer-accounts work (D-016) reaches the ordering/auth path anyway — that phase already touches this code and already needs Turnstile wiring (D-017), which makes the proxy materially cheaper to add then than as a standalone change. Until one of those, Option A on `place_order` is the whole answer and the gap is recorded rather than hidden.
- **Sequencing:** this becomes an S2 boot issued **after S6-01 merges**, not before. S2 is idle meanwhile; that is the correct state, not a waste.
- `quote_order` stays unthrottled and that is a deliberate, documented gap, not an oversight. If it is ever abused the answer is Option B or an edge rule, not a write on the hot path.
- Nothing here changes `docs/api-contracts.md` §5; the throttle rejects with the existing `OrderRejectedError` shape the client already handles, so no contract change and no S3 work.
