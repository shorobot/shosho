# BOOT: S2-06 (Backend) — campaigns, automations, banners, site publish; and make the funnel honest

## Role
You are session S2 (Backend) of SHOSHO. Build the two unbuilt thirds of your own S2-03 proposal — the campaign/automation tables and the banner/CMS publish model — and fix the one report of yours that returns a number that cannot be true. Everything here is additive; no shipped RPC signature changes.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s2` run `git fetch origin && git checkout -b s2-06 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s2-06` → `main`. Repo language English (D-006).
Read FIRST: `/memory/state.md`, `/memory/decisions.md` (**D-014** migration numbering — it exists because two of your own sessions collided; **D-015**, new, rules on the funnel question you raised), then `/memory/boots/proposed/S2-03-reports-campaigns-cms.md` — your proposal, which is the substance of this boot. Delete it in your PR once sections 2 and 3 are implemented.

**S4-03 is running right now in `apps/backoffice`.** You do not touch that app, and it does not touch `apps/backend`, so you are safe in parallel — but do not "helpfully" wire anything up on their side, and expect their PR to land around the same time as yours.

### What S0 verified before issuing this, so you do not rebuild it
**Section 1 of your proposal (reports) is already DONE** — you built it in S2-03, migration `20260926000024_reports.sql`: `report_revenue_by_day`, `report_top_items`, `report_delivery_times`, `report_funnel`, plus `reports_guard`. Do not rebuild any of them. Two residues:
- `report_top_items` asked S0 to pick view-vs-function. **Moot** — you shipped it as a function with `(from, to, limit)`. Keep it.
- **`report_payments` is the only report from section 1 that does not exist.** It is in scope here (task 5) because S4-04's Berichte screen needs it.

**Migration numbers (D-014).** The highest on `main` today is `20260928000026`. **Claim `…027` through `…032`** — that is your range, recorded in this boot, which is what D-014 asks for. Before you open the PR, re-check `main`: if anything landed in your range, you renumber, because the PR that merges second always does. S4-03 adds no migrations (its boundary forbids `apps/backend`), so a collision is unlikely but the rule is not optional.

## Tasks
1. **Campaigns and recipients.** `campaigns` (`name`, `channel` push/email/both, `segment jsonb`, `message_de/en jsonb`, `status` draft/scheduled/sending/sent/cancelled, `scheduled_for`, `sent_at`, `stats jsonb`) and `campaign_recipients` (`campaign_id`, `customer_id`, `state` queued/sent/failed/opened, `sent_at`, `opened_at`, `error`, **unique (campaign_id, customer_id)**). That unique constraint is load-bearing: it is what makes the design's "max one automated action per customer per week" enforceable in SQL rather than in whichever client remembers to check. Say in your report how a weekly cap is actually expressed on top of it — the constraint alone gives you once-per-campaign, not once-per-week.
2. **Automations.** `automations` (`kind` welcome / win_back_45d / birthday / review_after_delivery, `active`, `config jsonb`, `last_run_at`) and `automation_runs` for the audit trail.
3. **`resolve_segment(segment jsonb)`** → customer ids plus consent counts, so the back-office wizard's "recipients" number and the real send use **one** implementation and cannot disagree. **Consent is mandatory and is not a filter the caller may skip:** only customers with the matching `consent_*` and `anonymised_at is null`. Build it so a caller who forgets consent gets fewer rows, never more.
4. **`claim_campaign_recipients(limit)`**, shaped like your `claim_payment_jobs` (migration `20260921000011_payments.sql:94`) — `for update skip locked`, same idempotency discipline. **Read this before you write it:** S7-01 and S1 independently found that `payment-worker` accepts the **public anon key** while acting with service-role authority. Do not reproduce that shape. This function must be unreachable with an anon or authenticated JWT — follow the revoke pattern in `20260921000018_grants_hardening.sql` and assert it in a test, not just in the grant.
5. **`report_payments`** — per `payment_method` × `payment_status`: count, cents, refunded cents, using `payment_events` / `payment_jobs` for the provider trail. `security_invoker` like your other reports so staff RLS applies and kitchen/driver see nothing. Note while building it: **no live payment has ever run** (no Stripe keys yet), so every provider-side number will be zero or absent on staging. Make the view correct rather than demonstrable, and say plainly in your report that it is unexercised against real provider data.
6. **Banners.** `banners` (`slot` home_hero / home_strip / product / checkout, `image_path` in bucket `site`, `title_de/en`, `subtitle_de/en`, `cta_label_de/en`, `cta_href`, `valid_from/to`, `sort`, `active`) and a `banners_live` view exposing only active, in-window rows to `anon`. New storage bucket **`site`** (public read, owner/operator write) — `20260921000012_storage_menu_bucket.sql` is your own template, and the `menu` bucket's policy shape is the one to copy.
7. **Draft / publish.** Implement the model from your proposal, which S0 accepts as the smallest thing that gives the design's publish flow: `settings` and `banners` rows get `draft jsonb null`; `publish_site()` (owner only) copies `draft` → `value` and writes a `site_publications` row (`at`, `actor_id`, `summary jsonb`, `snapshot jsonb`); **the guest site keeps reading `value` only**, so an unpublished draft can never leak to a guest. Verify that last claim with a test using the anon key, not by inspection — `settings` already has public keys readable by `anon` (`settings_public_keys`), so this is exactly the place a mistake would be invisible.
8. **Make `report_funnel` honest (the 200 % bug).** S3-02 found `attempts_to_placed_pct: 200.0` and correctly did not patch your code. S0 read the function: **both CTEs use the same date window, so the SQL window is right and the *meaning* is wrong.** `order_attempts` only exists from migration `…023` (2026-09-26); `orders` go back to S2-01. Over any window reaching before attempt-recording began, `placed` counts orders whose attempt rows never existed, so the ratio exceeds 100 % and is not a bug in the arithmetic. Fix it so the function cannot report an impossible number: clamp the effective window to the earliest `order_attempts.at`, or return the ratio as `null` with the comparable sub-window reported alongside — **your call, but the result must be either true or explicitly absent, never a plausible-looking 200.** Whatever you choose, return enough for the caller to see which window the ratio actually covers, and test the pre-recording window specifically.
9. **Contracts.** Append the new tables, views and RPCs to `/docs/api-contracts.md` in **one new section of your own** (`§7 campaigns, banners, publish` or the next free number) — you write that section, S0 reviews it. Do not edit anyone else's section.
10. **Tests** (vitest, `backend` CI green): `resolve_segment` honours consent and excludes anonymised customers; the recipients unique constraint holds; `claim_campaign_recipients` is **refused** with an anon and with an authenticated non-staff JWT; `publish_site` is owner-only and a draft is invisible to `anon`; `banners_live` hides inactive and out-of-window rows; `report_payments` returns nothing to kitchen/driver; `report_funnel` never returns a ratio above 100 and reports its window.

## Boundaries
- Do NOT touch `apps/backoffice` — **S4-03 is live in it right now** — nor `apps/web`, nor `apps/infra`.
- Do NOT build `site_events` or any client-side analytics table. **D-015 defers it** — read the entry; it is a deliberate ruling, not an omission. If your funnel fix makes you want it, say so in your report as a proposal and stop there.
- Do NOT implement sending (push/email) — that is S5. You deliver tables, the resolver and the claim function.
- Do NOT implement server-side erasure-on-request; the nightly `anonymise_silent_customers` job is all that exists and S4-03 is told to surface erasure as unavailable.
- Do NOT change a shipped RPC signature. Additive only.
- Do NOT edit `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`, or another session's section of `api-contracts.md`.
- Do NOT reseed, truncate or reset `shosho-staging` — it is shared, and S4-03 is walking through it this week.
- No secrets in the repo. Note that `pretest` now runs `seed-local-logins.mjs` (your own S2-05 work), so `pnpm test` needs no extra step locally.

## Done when
- [ ] Migrations `…027`–`…032` (or renumbered against `main` at PR time), all additive
- [ ] `campaigns` + `campaign_recipients` with the unique constraint; weekly-cap mechanism explained
- [ ] `automations` + `automation_runs`
- [ ] `resolve_segment` — consent mandatory, anonymised excluded, one implementation
- [ ] `claim_campaign_recipients` provably unreachable with anon/authenticated, asserted in a test
- [ ] `report_payments`, `security_invoker`, invisible to kitchen/driver — and flagged as unexercised
- [ ] `banners` + `banners_live` + bucket `site`
- [ ] `draft`/`publish_site()`/`site_publications`; draft invisible to `anon`, proven with the anon key
- [ ] `report_funnel` cannot return an impossible ratio; the pre-recording window is tested
- [ ] `api-contracts.md` — your new section only
- [ ] `backend` CI green; PR `s2-06` merged

## Reporting
1. `/memory/log.md`: `## <date> — S2 Backend — S2-06` — what you built, the funnel decision and why, the weekly-cap mechanism, what `report_payments` cannot yet prove, blockers.
2. `/memory/state.md`: ONLY the S2 row.
3. Commits `[S2-06]`.
4. Security issues outside your boundary go straight to S7 (D-012) — tell S0, do not wait to be routed.

## Next step
S4-04 (Einstellungen + CMS + Marketing + Berichte) is the consumer of this work and stays a proposal until this merges. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
