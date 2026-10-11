# PROPOSAL (filed by S6-01 QA) — two findings for S3

## Owner
S3 Frontend (`apps/web`).

## Finding 0 (HIGH, filed first because it blocks local development, not just this boot) —
## CSP has no `'unsafe-eval'` carve-out for `next dev`, so the guest site is 100% non-interactive under `pnpm dev`

**What.** `apps/web/lib/csp.ts`'s `contentSecurityPolicy()` sets
`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` — no `'unsafe-eval'`, no `NODE_ENV` branch.
`next dev`'s webpack HMR runtime evaluates chunks via `eval()`; a CSP without `'unsafe-eval'` blocks
that outright. The result isn't a partial degradation — it's total: the page paints (the initial HTML
is server-rendered, so it looks complete) but **no client-side JavaScript executes**, which means no
hydration, no event handlers, nothing. A click on any button physically lands (Chrome shows `:active`)
and does precisely nothing.

**How this was found, not guessed.** Four CI runs in a row (2–5 of this PR) chased this as if it were a
timing problem — hydration races, `next dev`'s lazy route compilation, a React effect scheduling race —
and fixed real, legitimate things along the way (a login-form hardening gap, a Data Cache window, an
actually-flaky realtime test) without ever touching the real cause, because every one of those fixes was
plausible and none of them worked even slightly. The actual answer was sitting in the Playwright trace
the whole time: a `pageError` event reading *"Evaluating a string as JavaScript violates the following
Content Security Policy directive because 'unsafe-eval' is not an allowed source of script:
script-src 'self' 'nonce-…'..."* — captured on the very first failing run, not inspected until the fifth.
Confirmed the mechanism, not just the symptom: `next build`/`next start` (what `shosho-staging` actually
runs) does not use `eval()` by default, which is exactly why this was invisible there — verified live on
staging in this same boot (cookie bar, add-to-cart, full checkout all worked normally).

**Why it matters beyond this PR.** Anyone who runs `pnpm --filter @shosho/web dev` locally today — any
future session, a new contributor, anyone debugging a guest-site bug — gets a site that looks fine and
does nothing when clicked, with no console-visible explanation unless they think to check the CSP
header specifically. That is a worse failure mode than an error page: it looks like a logic bug, not an
infrastructure one.

**Where.** `apps/web/lib/csp.ts`'s `contentSecurityPolicy()` — the standard fix is adding `'unsafe-eval'`
to `script-src` only when `process.env.NODE_ENV !== "production"` (`next build` sets `NODE_ENV=production`
automatically; `next dev` does not), so the production CSP this was written for is unchanged.
`apps/backoffice/lib/csp.ts` has the byte-for-byte identical `script-src` line and almost certainly the
same bug — filed in the matching S4 proposal rather than assumed to be S3's to fix on both apps.

**Workaround in this suite, not a fix.** `apps/e2e/fixtures.ts`'s `webPage`/`boPage` fixtures now strip
the `Content-Security-Policy` header from the document response via `context.route()`, scoped to this
suite's own Playwright contexts only — it touches no file outside `apps/e2e` and changes nothing either
app actually serves. Once the `NODE_ENV` branch lands, that workaround becomes unnecessary (not harmful
to leave, since it only ever affects this suite's own browser contexts) — removing it is optional
cleanup, not required.

## Finding 1 — the guest tracking page's realtime gap

## What
`apps/web/components/order/TrackingClient.tsx` only polls `get_order_by_token` every 15 seconds
(`POLL_MS = 15_000`, a plain `setInterval`). It never opens a realtime channel. Confirmed two ways:

1. **Source, on current `main`** (not stale — re-checked after merging through S3-02/S4-03/S2-06):
   `grep -rn "\.channel(\|realtime\|removeChannel\|order_updated" apps/web` returns **zero hits**
   anywhere in the app.
2. **Live on staging**, 2026-10-10: placed a real order
   (`https://shos.hellfiresol.com/order/d8b4394fd1cd3042009a47b78df3d1e0`, order #1004) and opened its
   tracking page. The page's own footer copy says *"This page refreshes every 15 seconds"* — the
   poll-only design is stated as intentional, not an oversight that happens to also be true.

But api-contracts §3 / §5.6 (written by S0 after S2-02 shipped the feature) documents the opposite
contract: *"The guest subscribes with the anon key — the token is the capability... Keep the 15 s poll
as a fallback (a dropped socket must not freeze the page)"* — i.e., realtime is meant to be the primary
path, polling the safety net. S2-02 built the DB side for exactly this (migration 16,
`apps/backend/tests/guest_realtime.test.ts`, which this boot independently re-verified still works —
see `apps/e2e/specs/realtime-and-tracking.spec.ts`'s first test, subscribing with a plain anon client
exactly as a guest would). Nobody ever wrote the three lines on the `apps/web` side that would use it.

## Why it matters
Every status change (accepted, ready, out for delivery, delivered…) takes up to 15 seconds to reach a
guest who is actively looking at their tracking page — on a product whose whole pitch is "ready in
20 min." Not a crash, not data loss, but a real, user-visible gap between what was built and what
ships, and exactly the class of bug this boot exists to find: both sides individually tested, nobody
connected them.

## Where
- `apps/web/components/order/TrackingClient.tsx` — add a `supabase.channel(`order:${token}`, {
  config: { private: true } }).on('broadcast', { event: 'order_updated' }, () => load())` subscription
  alongside the existing poll (keep the poll — the contract explicitly wants both: realtime first,
  15 s poll as the fallback if the socket drops).
- `apps/backoffice`'s own board already does the equivalent correctly via `postgres_changes` — that
  side needs no change; only the guest-facing tracking page is missing it.

## Repro / verification
`apps/e2e/specs/realtime-and-tracking.spec.ts`'s second test (`"apps/web never subscribes to that
broadcast..."`) places an order, changes its status via a staff RPC, and asserts the open tracking tab
does **not** update within 5 seconds (a falsifiable claim — it also asserts the poll eventually catches
up at ~15 s). Once this is fixed, that test should start failing on the 5 s assertion — at which point
delete it (or flip it to assert an update **within** ~2 s) rather than leaving a known-stale check in
the suite.

## Suggested `data-testid`
None required — the existing test drives this by text content (`"Order accepted"`) and timing, which
is already robust to the fix.
