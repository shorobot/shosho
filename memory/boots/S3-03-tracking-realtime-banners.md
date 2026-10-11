# BOOT: S3-03 (Frontend) — wire the tracking page to the realtime it already has, then render the banners that now exist

## Role
You are session S3 (Frontend) of SHOSHO, idle since S3-02 merged on 2026-09-30. Two things became true while you were away: QA found that the guest tracking page **never subscribes to the realtime broadcast the backend has been publishing since S2-02**, and the back-office can now **create banners** that the storefront has no code to display. Close both.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s3` run `git fetch origin && git checkout -b s3-03 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s3-03` → `main`.
Read FIRST: `/memory/state.md` (SNAPSHOT, then S6-01's findings table), `/memory/decisions.md` — **D-015** (no client-side analytics; do **not** add tracking events) and **D-016**/**D-017** (accounts are coming later; this boot adds none), then:
1. `/memory/boots/proposed/S6-02-S3-guest-tracking-realtime.md` — QA's finding, with both proofs and the reproduction. **Task 1 is this.**
2. `/docs/api-contracts.md` **§3** and **§5.6** — the broadcast contract, which documents a subscription with the 15 s poll as a **fallback**. The app currently implements only the fallback.
3. `/docs/api-contracts.md` **§8.6** — `banners` and `banners_live`, shipped by S2-06; the back-office admin for them shipped in S4-04 2026-10-11.
4. `/memory/boots/proposed/S3-03-banners-i18n-pwa.md` — your own older proposal. Its **banners** half is task 2; its **i18n / PWA / favourites** halves are explicitly **not** in this boot.
5. `apps/web/lib/csp.ts` — read the comment at the top before touching anything. Your nonce CSP is enforcing and only safe because the root layout is `force-dynamic`.

## Tasks
1. **Subscribe the tracking page to `order:<token>`, keeping the poll as a fallback.** `components/order/TrackingClient.tsx` runs a bare 15 s `setInterval` (`POLL_MS = 15_000`); `grep -rn "\.channel(\|realtime\|removeChannel" apps/web` returns **zero hits** anywhere in the app. S2-02 built and tested the DB side (`apps/backend/tests/guest_realtime.test.ts`), and §3/§5.6 says the client is meant to subscribe. So this is implementing a documented contract, not inventing one.
   - **The broadcast is token-scoped.** Subscribe to the channel for *this* order's token only; never a table-wide or wildcard subscription, and never one keyed on anything a guest could change to watch someone else's order. This is the security property of the whole design — §3 explains it.
   - **Keep the 15 s poll as a fallback**, as the contract says. Realtime over a websocket fails in ways polling does not (corporate proxies, flaky mobile). Degrade quietly to the poll; never show the guest a connection error for something that self-heals.
   - **`connect-src` already allows `wss://…supabase.co`** (S4-03's CSP does; check yours in `lib/csp.ts` and fix it if not). A websocket blocked by CSP looks exactly like a Supabase outage, which the file's own comment warns about.
   - **Unsubscribe on unmount**, and handle the token page being left open for hours — reconnect rather than silently dying. S2-03 hit a real race here; their `guest_realtime.test.ts` fix (task 8) used a warm-up-nudge-until-observed pattern, and S6 independently reproduced the same race. Read both before writing your own timing.
   - **The footer copy must change.** It currently says *"This page refreshes every 15 seconds"* — stated as design, which is how this gap survived. Say what is true after your change.
   - **S6's spec is written to flip when you fix this** (`apps/e2e/specs/realtime-and-tracking.spec.ts:33` asserts the gap and says in its own comment that failing means the app was wired up). **Do not edit `apps/e2e/`** — your fix turning it red is the intended signal; note it in your report so S6 or S0 updates it.
2. **Render banners from `banners_live`.** Today the hero is static (`components/home/Hero.tsx`; only "from … €" is live). `banners_live` is the **only** anon-reachable banner surface — it exposes active, in-window rows and nothing else. Slots: `home_hero`, `home_strip`, `product`, `checkout`.
   - Honour `sort`, and the DE/EN fields (`title_de/en`, `subtitle_de/en`, `cta_label_de/en`, `cta_href`).
   - **Never query the `banners` base table** — `anon`'s grant on it is revoked outright, and `settings.draft` / `site_publications` are likewise unreachable by design. If you find yourself needing them, the answer is no.
   - **Empty is the normal case.** There may be zero banners for a slot, and the storefront must look deliberate rather than broken — keep today's static hero as the fallback for `home_hero` rather than rendering a gap.
   - Images come from the `site` bucket. `img-src` must allow it; `next/image` is `unoptimized`, so `remotePatterns` is **not** the lever — CSP is. S3-02's log has this; re-read it rather than rediscovering it.
3. **Verify both against staging, not just locally.** The storefront is `https://shos.hellfiresol.com/`. Place a real order, open its tracking page, have the status changed, and confirm the page updates **without** waiting 15 s — then confirm it still catches up if the socket is blocked. For banners you need one to exist: ask the owner to create one in the back-office (`/website`), or say you could not verify end to end and why.
4. **Docs**: update `apps/web/README.md` — the realtime/poll relationship and the banner slots. Contract gaps → `proposed/S3-contract-notes.md`.

## Boundaries
- Do NOT touch `apps/backend`, `apps/backoffice`, `apps/infra`, or `apps/e2e`.
- Do NOT build i18n/DE toggle, PWA/service worker, favourites, or the payments UI — separate boots. The DE/EN **banner fields** are in scope; a site-wide language toggle is not.
- Do NOT add any client-side analytics or event table (**D-015**).
- Do NOT subscribe to anything broader than this order's own token channel.
- Do NOT make any route static or ISR — the nonce CSP depends on `force-dynamic` (`lib/csp.ts`); a cached page carries a stale nonce and blocks every script with no useful error.
- Do NOT edit `/docs/api-contracts.md` (propose instead), `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- No secrets in the repo; anon key only.

## Done when
- [ ] Tracking page subscribes to `order:<token>`, token-scoped only, with the 15 s poll retained as a fallback and unsubscribe on unmount
- [ ] A status change is reflected **without** waiting for the poll, verified on staging with a real order
- [ ] Degrades quietly to polling when the socket cannot connect — no error shown for something that self-heals
- [ ] Footer copy no longer claims 15 s polling is the mechanism
- [ ] `banners_live` rendered for all four slots, `sort` honoured, DE/EN fields used, zero-banner case looks deliberate
- [ ] `site` bucket images load (CSP `img-src`, not `remotePatterns`)
- [ ] `node (web)` CI green; PR `s3-03` merged
- [ ] S6's realtime spec noted as now-inverted in your report, and `apps/e2e/` untouched

## Reporting
1. `/memory/log.md`: `## <date> — S3 Frontend — S3-03` — how you proved realtime actually arrives (and what you did about reconnection), what the banner empty case looks like, and whether you verified banners end to end or could not.
2. `/memory/state.md`: ONLY the S3 row.
3. Commits `[S3-03]`.
4. Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
Still queued for S3: the payments UI (`proposed/S3-02-payments-ui.md`, blocked on the owner's Stripe keys), the DE/EN toggle, PWA + web push (which the customer-accounts roadmap will want), and favourites per-customer once accounts exist. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
