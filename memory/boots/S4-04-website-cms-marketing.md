# BOOT: S4-04 (Back-office) — Website (CMS) and Marketing, the two screens S2-06 was built for

## Role
You are session S4 (Back-office) of SHOSHO. Turn two `ComingSoon` stubs into real screens: **Website (CMS)** and **Marketing**. Everything they need landed in S2-06 three days ago and **has never been touched by a UI** — you are its first consumer, which makes you the first chance to find out whether the contract is right. Einstellungen and Berichte are the *next* boot, not this one.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4` run `git fetch origin && git checkout -b s4-04 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s4-04` → `main`. Repo language English; UI German primary with the EN toggle.
Read FIRST: `/memory/state.md`, `/memory/decisions.md` — **D-015** (no client-side analytics; the funnel's menu→cart step is unmeasurable and Berichte must say so, not invent a number), **D-016** and **D-017** (customer accounts, OTP, and why email is blocked on SMTP — they decide what Marketing may promise), then:
1. `/docs/api-contracts.md` **§8** — written by S2 in S2-06, reviewed by S0. This is your contract: §8.1 campaigns, §8.2 `resolve_segment`, §8.4 automations, §8.6 banners + the `site` bucket, §8.7 draft/publish. Read §8.7 twice.
2. The canvas screens **BO · Website** and **BO · Marketing**, plus the matching empty states in **BO · Zustände**.
3. `/memory/boots/proposed/S4-04-settings-cms.md` — your own older proposal. **Its Website half is in scope; its Einstellungen half is not.** Do not delete the file; strike the Website part and leave Einstellungen for the next boot.
4. Your own S4-03 log entry, for the patterns you just built (`lib/menuStore.tsx`'s `run()` for RLS denials, `components/menu/Fields.tsx` for forms).

**⚠️ S6-01 (QA) is running right now against this same app.** Their scope is the guest journey, the board/orders/kitchen/driver flows and the backend seams — none of which you are touching. Keep it that way:
- Do **not** touch `apps/backoffice/e2e/` — S6's boot offers extending it and a collision there is the one that would actually hurt.
- Do **not** refactor the shell, nav, layout or any shared component beyond what flipping two stub routes strictly requires. If you find yourself wanting to tidy the nav, don't.
- Do **not** change `/orders`, `/orders/[id]`, `/orders/history`, `/kitchen`, `/driver`, `/menu*`, `/customers*`. They are under test.
If you believe a shared file genuinely must change, say so in your report and leave it — S0 will sequence it after S6 lands.

## What S2-06 gave you, verified present by S0 on `main`
```
campaigns, campaign_recipients            + enum campaign_channel / campaign_status / campaign_recipient_state
                                          + trigger campaign_recipients_enforce_weekly_cap
automations, automation_runs              + enum automation_kind
resolve_segment(segment jsonb, channel)   owner/operator only, guards internally
claim_campaign_recipients(limit)          service_role ONLY — not yours to call, ever
report_payments(from_date, to_date)       owner/operator only
banners + banners_live (anon) + bucket `site` + ensure_site_bucket_policies()
settings.draft + publish_site() + site_publications
```

## Tasks — Website (CMS)
1. **The draft/publish model is the heart of this screen and the thing most easily got wrong.** Per §8.7: `settings` and `banners` carry a `draft jsonb`; `publish_site()` (owner only) copies `draft` → `value` and writes a `site_publications` row; **the guest site reads `value` only**. Build the editing surface so a change lands in `draft`, show the **unpublished-changes counter** the design asks for by counting rows with a non-null `draft`, and show the publish history from `site_publications`.
   **The trap S2 already defended against, which you must not re-open from this side:** `settings` has public keys readable by `anon`, and RLS is row-level, so a `draft` column on a row anon can already read would have leaked every pending edit to the storefront. S2 fixed that with a **column-level `GRANT`** that pointedly omits `draft`. **Do not add a view, an RPC, or a `select *` that routes `draft` back out to an anon-reachable surface** — and prove it: a test with the **anon key** asserting a pending draft is invisible. Inspection is not enough here; this is precisely where a mistake would be invisible.
2. **Banners**: CRUD on `banners` (slot `home_hero` / `home_strip` / `product` / `checkout`, image in bucket `site`, DE/EN title + subtitle + CTA label, `cta_href`, `valid_from`/`valid_to`, `sort`, `active`). Upload to the `site` bucket reusing the `menu` upload pattern from S4-02. Show which banners are **live right now** versus scheduled or expired — `banners_live` is the view the storefront sees, so showing its contents next to the full table is the honest way to answer "why isn't my banner showing".
3. **Business data, opening hours, delivery zones** (A/B/C: area, min order, fee, promised minutes, postal codes), SEO, cookie-banner copy, robots, maintenance mode — all through `settings` keys, all into `draft`. Owner-write: an operator must see the screen **read-only** rather than a Postgres error (use `run()` from `lib/menuStore.tsx`, as your own proposal notes).
4. **Say what publishing does.** The counter and the publish button are the only place a non-technical owner learns that edits are staged. One sentence of UI copy beats a support conversation.

## Tasks — Marketing
5. **Promo codes** table: percent / fixed, applies-to scope, used/limit, validity. These have existed since S2-01 — read the existing schema, do not invent columns.
6. **Campaigns list + the Kampagne wizard** (§8.1, §8.2): segment picker → **recipients count from `resolve_segment(segment, channel)`**, channel push/email/both, DE/EN message (title, body, deep_link), timing, preview, and last-campaign stats from `campaigns.stats`.
   - **The count and the real send must use the same call.** That is why §8.2 exists and why it takes a required `channel` — pass the campaign's own channel, never a default.
   - **Consent is enforced inside the function**, so a segment that looks permissive still returns only consented, non-anonymised customers. Show the consent count next to the raw match count so the operator sees *why* 400 customers became 120.
7. **Be honest about what cannot send yet, because this is where the screen would otherwise lie.** There is **no sender and no transport**: S5 has never started, `claim_campaign_recipients` has no worker, and there is **no push subscription store at all** (S0 grepped the whole repo). Per D-017 the **email** channel is additionally blocked until the owner configures SMTP — Supabase's built-in relay caps at 2 emails/hour project-wide. So: let an operator **draft and schedule** a campaign, and make "Senden" **disabled with a tooltip naming the missing piece** — not a button that queues into nothing. A campaign that silently never sends is worse than one that visibly cannot.
8. **Automations** (§8.4): list the four kinds (`welcome`, `win_back_45d`, `birthday`, `review_after_delivery`), active toggle, `config jsonb` editing, `last_run_at`, and the `automation_runs` audit. Same honesty rule — nothing runs them yet; the toggle stores intent.
9. **KPIs** at the top of Marketing from what actually exists (promo usage, campaign stats). If a KPI the design shows has no source, render it as unavailable with the reason rather than a zero. A zero reads as "no sales", which is a different and alarming claim.

## Tasks — both
10. **Guards**: owner/operator only; kitchen and driver must not reach either route. Note from S4-03, worth acting on: a kitchen write can **no-op silently** rather than erroring (RLS matches zero rows), so route guards are what actually hold — test the guard, not just the RLS.
11. **Empty states** from BO · Zustände: no banners, no campaigns, no promo codes, no publish history, a segment matching zero consented customers.
12. **Tests**: the anon-draft-invisibility test from task 1; `resolve_segment` wired so count and send cannot diverge; banner window logic (live / scheduled / expired); the disabled-send state; kitchen/driver refused on both routes. Keep `node (backoffice)` green.
13. **Verify against `shosho-staging`** over the tunnel (`ssh -N -L 8202:127.0.0.1:8202 shos@164.90.235.66`, key `~/.ssh/shos_ed25519`). **Credentials changed:** the seed passwords were rotated by the owner on 2026-10-09 and the published `shosho-test-2026` no longer works — ask the owner for the current value; it exists only in a gitignored file on their machine. Do not reseed or truncate staging. Create a banner, stage a settings edit, confirm the counter moves, publish, confirm `site_publications` gains a row and the storefront sees the new `value` — and confirm the pending draft was **never** visible to anon before publishing.
14. **Docs**: extend `apps/backoffice/README.md`. Contract gaps → append to `/memory/boots/proposed/S4-contract-request.md`. **You are §8's first consumer — if the contract is wrong or awkward, say so concretely**; that feedback is worth more than a workaround.

## Boundaries
- Do NOT touch `apps/backend`, `apps/web`, `apps/infra`.
- Do NOT build **Einstellungen** or **Berichte** — next boot. Their stubs stay.
- Do NOT call `claim_campaign_recipients` (service_role only) or implement any sending, push or email.
- Do NOT implement the team-invite flow — it needs a service-role Edge Function, which cannot live in this app (anon key only).
- Do NOT route `settings.draft` to any anon-reachable surface.
- Do NOT edit `/docs/api-contracts.md` (S0 owns it; propose changes), `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Respect the S6 fences above.
- No secrets in the repo; anon key + user session only. Never print or commit a staff password.

## Done when
- [ ] Website: banners CRUD + `site` uploads, business data / hours / zones, unpublished-changes counter, `publish_site()`, publish history
- [ ] **A test with the anon key proves a pending `draft` is invisible to the storefront**
- [ ] Marketing: promo codes, campaigns list + wizard using `resolve_segment` for both count and send, automations, honest KPIs
- [ ] "Senden" is disabled with a tooltip naming what is missing — no silent queueing
- [ ] kitchen/driver refused on both routes, guard tested
- [ ] Empty states present
- [ ] Staging walk-through of task 13 done and written up, including the anon-invisibility check
- [ ] `node (backoffice)` CI green; PR `s4-04` merged
- [ ] Nothing under S6's fences touched, or any need to do so reported rather than done

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-04` — the draft/publish model and how you proved the anon case, what Marketing honestly cannot do yet, your verdict on §8 as its first consumer, blockers.
2. `/memory/state.md`: ONLY the S4 row.
3. Commits `[S4-04]`.
4. Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
S4-05 (Einstellungen + Berichte) is the follow-up; Berichte needs an XLSX export and must show the menu→cart funnel step as unmeasurable per D-015. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
