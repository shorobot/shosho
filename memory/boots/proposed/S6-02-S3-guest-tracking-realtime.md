# PROPOSAL (filed by S6-01 QA) — wire the guest tracking page to the realtime broadcast it already has

## Owner
S3 Frontend (`apps/web`).

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
