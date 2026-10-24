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
- **Accounts are optional.** Guest checkout survives unchanged as a first-class path. This retires the design's product rule "Guest checkout, no account" (`docs/design/README.md` lines 26 and 48) — the rule becomes "guest checkout always available; an optional account adds a personal cabinet, saved addresses and messages". The design and the twelve-rule list must be updated in the same boot that ships the login, or S6 will correctly report the feature as a rule violation. **CONFIRMED BY THE OWNER 2026-10-22, out loud rather than inferred: accounts are optional and guest checkout survives.** S2-07 was explicitly not issuable without this and was issued the same day. *(History: this clause had been S0's inference from the owner's description — "name and address can be added later" — and was the only part of D-016 the owner had never answered explicitly.)*
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

## D-019 — VAT rate is a per-item property, chosen 7 % or 19 % at item creation; the order type does not change it
Status: accepted 2026-10-15 (owner, answering S0's `proposed/S0-vat-pickup-rate-owner-decision.md`)
Decision: each menu item carries **one** VAT rate, selected as 7 % or 19 % when the item is created or edited. The rate follows the **product**, not the fulfilment channel — a pickup order and a delivery order of the same item are taxed identically. `menu_items.vat_delivery_pct` is that rate and is already what `place_order`/`quote_order` charge (`rpc.sql:237`), so **no backend change is required**; the per-item 7/19 control the owner asked for already exists (`ItemEditor.tsx:318`). What must change is `vat_onsite_pct`: the backend reads it **nowhere**, yet `ItemEditor.tsx:319` offers an operator a live 7/19 dropdown for it. Remove that control. The column may stay dormant for a future dine-in channel, but it must not be presented as if it does something.
Why: the owner's rule puts the tax judgement where it belongs — on the person configuring each product, with their Steuerberater — instead of in a hardcoded branch on order type. It is also the correct shape for German VAT, where the split that actually matters is by product (prepared food at the reduced rate; drinks, alcohol and non-food at the standard rate) rather than by whether the customer carried the bag out themselves. SHOSHO has no on-premises channel at all — `order_type` is `enum ('delivery','pickup')` — so an on-premises rate has nothing to apply to.
Consequences: **S4-05's filing against S2 to "fix" pickup to 19 % is cancelled, not deferred.** Executing it would have added 12 points of tax to every Abholung order. S0 caused that filing by asserting in the S4-05 boot that "pickup VAT is computed at 19 % server-side from `menu_items.vat_onsite_pct` and is correct" — false in both halves, and S4 found it by reading the code rather than trusting the boot. The `detail.vat` label was telling the truth all along; S4's fix to render the rate actually used stands and is right under this decision too. Remaining work: drop the dead control (S4, small) and decide later whether to drop the column (S2, cosmetic). The Accounting agent in D-020 depends on this being settled, which is why it was worth answering before S5 started.

## D-020 — Automation is a native Claude Agent SDK orchestrator in `apps/automation`; it is the first component that needs server-side privileged secrets, which reverses D-013
Status: accepted 2026-10-15 (owner's architecture; S0 recording it with the consequences and the ordering)
Decision: the AI-agent layer lives in `apps/automation` as a **natively written** orchestrator — Claude Agent SDK, Python, no visual/no-code tool (this extends **D-007**, which dropped n8n, from "not n8n" to "logic lives in code we own"). Supabase Postgres + Realtime is the substrate; a **FastAPI** endpoint fronts external integrations (Lieferando, Wolt). Agent observability — statuses, queues, execution logs — is rendered **inside the back-office** as internal dashboards on Next.js + Supabase Realtime, not as a separate tool. Planned agents: **Sales** (Instagram/Facebook DM lead-gen and order intake), **Accounting** (bookkeeping, Steuerberater reporting), **Warehouse** (stock, food cost), **Grow** (analytics and growth proposals), **Quality** (computer vision, explicitly a later phase).
Why: the owner's call on each point. Native code over no-code buys full control of agent logic and makes it reviewable, testable and diffable like the rest of the repo — and it keeps the orchestrator in the same CI that already has a `python (automation)` lane waiting (`ci.yml:63`, currently a no-op because the directory holds only `.env.example` and `.gitkeep`). Putting the dashboards in the back-office rather than a separate tool means one auth model, one design system and no second thing to deploy.
Consequences, in the order they bite:
- **This reverses D-013's secret posture, and that is the single most important consequence.** `_deploy.yml:150` records that `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are *deliberately* no longer rendered into the server `.env`, because the dropped `api` placeholder was their only reader. `apps/automation/.env.example` needs **both**. So automation is the first SHOSHO component to hold privileged credentials on the host — every app shipped so far is anon-key only. **S7 must design that trust boundary before S5 writes code**, not after: what the service role may touch, how the Anthropic key is scoped and rotated, and what an agent is forbidden from doing. Retrofitting a privilege boundary around a working orchestrator is the expensive order.
- **No agent-run schema exists.** Queues, statuses and execution logs have no tables, so neither the orchestrator nor the back-office dashboard has anything to write or read. This is S2's and it is the first build step; both S5 and S4 block on it.
- **Agent order is forced by external dependencies, not by value.** *Sales* needs a Meta app, Business verification and Messenger/Instagram Messaging permissions — owner-side, weeks, uncodeable-around — so it is **not** first despite being the most commercially interesting. *Warehouse* needs an ingredient/recipe/stock schema that does not exist at all. *Quality* is deferred by the owner. **Accounting** and **Grow** read data that already exists and need no external credential, so one of them is agent #1. Accounting is the better first because D-019 just settled the VAT model it depends on.
- **Nothing an agent produces can be *sent* yet.** D-017 still stands: no SMTP, so no email; no push transport exists. An agent may write rows and surface them in the back-office; it may not message a customer. Sales order-intake in particular is read-and-draft until a transport exists.
- QA and Security are **continuous, not a phase**: S6 regresses the guest→order→back-office→agent path on each new boot, S7 audits before any production deploy. Neither waits for the agents to be finished.

## D-021 — The account-linking rule's email half: link only on an unambiguous single match, never on a non-unique identifier
Status: accepted 2026-10-22 (S0, specifying what D-016's finding 5 left under-defined, at the moment S2-07 was issued)
Decision: `link_my_account()` links a verified identifier to an existing `customers` row **only** on an unambiguous single candidate.
- Verified **phone** → **AMENDED 2026-10-23, before this decision ever reached `main`.** The original
clause read "at most one candidate (the column is `unique`); link it **iff** it has no `auth_user_id`."
**S2-07 showed that is defective, and they are right.** A guest row is unlinked **by definition** —
`place_order` creates it and no account has ever claimed it — so "has no other account attached" is
satisfied by *exactly* the rows a recycled number lands on. The test excludes rows claimed by another
*account*; it says nothing about rows belonging to another *person*. For the dominant case the rule
therefore reduces to a phone match alone, which finding 5's own last sentence forbids. **The rule as
written did not prevent the disaster it was written to prevent.** Ratified by S0 without catching it.
- **Interim rule, ratified as S2-07 proposed it:** additionally require **`kitchen_note is null`** before
auto-linking on a phone match. It is strictly tightening, it blocks the food-safety path specifically
(`kitchen_note` is copied to `orders.allergy_note` on every order), and it needs no schema change.
**Clearing the note on link is NOT the safe alternative** — if the link is correct, clearing destroys a
real customer's allergy record. Refusing is recoverable; both wrong-link and wrong-clear are not.
- Verified **email** → link **iff exactly one** non-anonymised row carries that email **and** it has no `auth_user_id`. Two or more candidates → **fresh customer row**, never a guess.
- A `NULL` email matches nothing, guarded explicitly. A row with `anonymised_at` set is never a candidate.
- Any non-link starts a fresh row and leaves a **deliberate staff merge** from the back-office, audited in `customer_events`.
Why:
- **Measured, and it is the reason this needed a ruling at all:** `customers.phone` is `text not null unique`, but **`customers.email` is nullable with no unique constraint or index anywhere in the 34 migrations** — checked repo-wide. D-016's finding 5 says "the account's verified identifier matches the customer row's identifier", which is well-defined for phone and ambiguous for email. Written naively against a non-unique column, "the matching row" is whichever row the planner returns first.
- **The failure mode is food safety, not privacy.** `customers.kitchen_note`'s own column comment is "Allergy / kitchen note — copied to orders.allergy_note on every order." A wrong link copies a stranger's allergy note onto every future order of a different human being. That asymmetry — a silent wrong link is far worse than an inconvenient refusal — is what makes "refuse and let staff merge" the correct default rather than a conservative one.
- Refusing is cheap and recoverable: the customer gets an account, just a new row, and staff can merge deliberately. Mis-linking is neither.
Consequences:
- `link_my_account()` must be able to **report** "did not link, staff merge required" to the client, which is why S2-07 specifies an explicit RPC rather than a trigger on `auth.users` (a trigger cannot signal that outcome, and cannot be tested with a real customer JWT).
- The back-office needs a deliberate **merge** action eventually. It is **not** in S2-07 and not in B; whoever scopes it must audit into `customer_events`. Until it exists, an unlinked duplicate is a visible, harmless row — the correct failure direction.
- Does not change D-016's channel choices and does not depend on which channel ships first.

## D-022 — Snapshot the VAT rate on `order_items` at write time, and land it BEFORE D9
Status: accepted 2026-10-23 (S0, on S5-01's finding, re-measured before accepting it)
Decision: add a per-line **VAT rate snapshot** to `order_items`, written at order time from the rate actually used, plus the delivery fee's own rate on `orders`. **This migration must land before owner action D9** (setting the real 7/19 rates with the Steuerberater). S2's work; S5 correctly refused to touch `apps/backend`.
Why:
- **The schema already snapshots everything else on the line, and the rate is the one thing it forgot.** `order_items` copies `name`, `unit_price_cents` and `line_total_cents` off the menu item precisely because menu values drift and a filed order must not move; `item_id` is even `on delete set null` so a deleted item leaves the line intact. The rate drifts identically and is **not** copied. So this is not a new design principle — it is an existing principle applied inconsistently.
- **Measured, all three legs, rather than taken from the report:** `order_items` has no vat/rate/pct column (migration 5, lines 54-66); the rate exists only as `menu_items.vat_delivery_pct` (`numeric(4,2) not null default 7`, migration 3) and is read **live at calculation time** (`rpc.sql:237`, `update_order_items.sql:119`); and `menu_items` carries no grant to the `agent` role, which S5 proved as a `42501` refusal rather than an empty result. `orders` keeps only the aggregate `vat_cents`.
- **A grant would answer the wrong question, which is the part worth recording.** Even with `SELECT` on `menu_items`, joining *today's* rates to a past order reprices a filed period. D9 makes that imminent rather than theoretical: it changes every rate, with the Steuerberater.
- **Hence the sequencing, which is the sharp half of this decision and which nobody had stated.** Every order placed before the snapshot column exists loses its true rate the moment D9 runs — irrecoverably, because nothing anywhere records what the rate was at the time. The column is cheap; the window in which it is still possible to capture correct history closes when D9 does.
- **The delivery fee is the same defect in a worse form:** its VAT is the literal `v_fee * 19.0 / 119.0` at `rpc.sql:359`, readable from no table at all. So the fee's tax component is not derivable either, and a hardcoded rate cannot even be changed by D9 — it needs a code change, which is its own finding.
Consequences:
- **Historical rows get no backfill.** Pre-migration lines take `null` and every per-rate report states the split as unavailable for that window, with the reason. Backfilling by joining today's `menu_items` is the exact repricing error this decision exists to prevent — it must not be done, even though it would make the reports look complete.
- Until it lands, Accounting reports **charged** VAT and marks the per-rate split `available: false` with its reason. S5-01 already ships exactly that, which is the correct interim behaviour and not a gap to be closed by inventing a number.
- **For the owner:** worth putting in front of the Steuerberater already engaged for D9, because a German invoice is normally expected to show the tax amount per rate — which is precisely what is not derivable today. S0 is not the authority on that; the Steuerberater is, and they are already in the loop.
- Does not change D-019 (the rate is a per-item property; order type does not change it). It makes D-019 *auditable*, which it currently is not: nothing records which per-item rate an order actually used.
- The misleading column name `vat_delivery_pct` — a per-item rate with "delivery" in it, used unconditionally — is noted for S2 to decide on. Renaming is cosmetic next to the snapshot and must not delay it.

## D-023 — `agents.config` spend-ceiling keys are `run_ceiling_usd` / `day_ceiling_usd`
Status: accepted 2026-10-23 (S0, settling S4-06's filed proposal against S5-01's shipped code)
Decision: the keys are **`run_ceiling_usd`** and **`day_ceiling_usd`**, plain USD numbers, optional — absence means "no ceiling configured", never `0`.
Why: S5-01 merged first and its ledger already reads exactly these (`apps/automation/.../ledger.py:157-158`). **The enforcer's names win**: the dashboard *displays and writes* a ceiling, but the orchestrator is what actually bounds spend, and an unknown key there is indistinguishable from "not set" — it silently falls back to the code default (`$0.50`/run, `$5.00`/day) while the screen reports a configured ceiling. A safety control that claims a property it does not have is worse than a visibly absent one.
Consequences:
- S0 renamed S4-06's keys in `s4-06` before merging it (19 lines, 5 files). S4 **filed the gap rather than guessing past it**, which is the only reason it was caught before shipping — their proposal called it "not urgent", which was true when written and stopped being true the moment S5-01 merged.
- Any third agent reads these keys. `docs/api-contracts.md` §8.8 should name them rather than leaving "S5's vocabulary, not specified here".

## D-024 — `settings.draft` is readable by ANY authenticated user, customers included; it blocks phase B
Status: accepted 2026-10-23 (S0, confirming S2-07's finding by reading the migration)
Decision: treat this as a **release blocker for phase B (the customer login)**, not as an open hygiene item, and route it to **S7** per D-012. It must be closed before any non-staff user can hold a JWT.
Why, measured rather than taken on report:
- Migration 32 narrowed the `draft` column by **column grant**, and only for one role: `revoke all on table public.settings from anon; grant select (key, value, created_at, updated_at) on public.settings to anon;` (lines 23-24). `authenticated` keeps the blanket table grant.
- `settings_public_read` is `for select to anon, **authenticated** using (key = any (settings_public_keys()))` — it is the one `to authenticated` policy that carries **no** `is_staff(...)` predicate, because it is the public-read policy.
- Together: any `authenticated` role can select `draft` on the publicly-readable rows. Today that is kitchen and driver (recorded as **B5**, understated). **After phase B it is every customer** — the shop's unpublished edits, readable by anyone who signs up.
- **The migration's own comment states the assumption that fails:** "`authenticated` keeps its existing (unchanged) table-level grant, so owner/operator continue to…". It reasoned about `authenticated` as if it meant *staff*. That was true when written and phase B makes it false.
Consequences:
- **This is the one place the ROADMAP's "safe by construction against a second class of authenticated user" claim does not hold**, and S2-07 found it. The claim rested on "every `to authenticated` policy carries an explicit `is_staff(...)`" — `settings_public_read` is the exception, and column grants are where it bites. The invariant should be restated with the exception named rather than repeated.
- Column grants cannot fix it alone (S2-07's words, confirmed): the fix is to revoke the blanket `authenticated` grant and re-grant the public columns, mirroring what was done for `anon` — S7 to rule, S2 to implement.
- **B5 is upgraded** from "reaches kitchen/driver" to "reaches every authenticated user" and from an open item to a phase-B blocker.

