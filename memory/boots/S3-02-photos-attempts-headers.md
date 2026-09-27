# BOOT: S3-02 (Frontend) — make uploaded photos visible, feed the funnel, add security headers

## Role
You are session S3 (Frontend) of SHOSHO. Three concrete things the storefront owes the rest of the system, none of which needs Stripe: render the photos the back-office can now upload, report rejected checkouts so the funnel has data, and put security headers on `apps/web`. Payments UI is a later boot (S3-03) — it waits for S2-04 and a Stripe account.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s3` run `git fetch origin && git checkout -b s3-02 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s3-02` → `main`. Repo language English; UI copy EN with the DE legal footer, as you built it.
Read FIRST: `/memory/state.md`, `/memory/decisions.md`, then the three specs, each written by the session that found the problem:
1. `/memory/boots/proposed/S4-contract-request.md` **§9** — the photo blocker, with the exact line in your code and the fix S4 suggests.
2. `/memory/boots/proposed/S3-record-order-attempt.md` — S2's spec for the two call sites, with the RPC shape.
3. `/memory/boots/proposed/S7-02-S3-web-security-headers.md` — S7's audit finding, with what is currently served and what is missing.
Also `/docs/security.md` for the standing rules, and `/docs/api-contracts.md` §5 (yours) and §1.7 (`order_attempts`).

## Tasks
1. **Photos — this is a live product bug.** `apps/web/components/ui/Photo.tsx` renders an image only when `photos[0]` matches `/^https?:\/\//`, but `menu_items.photos` holds bucket-qualified paths (`menu/<item_id>/<n>.jpg`) since S2-02/S4-02. Result, verified on staging 2026-09-27: an uploaded photo is public and renders in the back-office, and the storefront shows **zero** `<img>` elements — every card falls back to the placeholder stone.
   - Resolve bucket paths through `supabase.storage.from('menu').getPublicUrl(path.replace(/^menu\//, ''))`, keeping the absolute-URL branch so the seed data still works.
   - Do it in one place that every surface uses (card, product page, cart line, tracking) — not per component.
   - Keep the brand placeholder for items with no photo; that behaviour is correct and stays.
   - Use `next/image` properly (sizes, priority on the hero, no layout shift) and confirm the Supabase storage host is allowed in `next.config.ts` — a blocked remote host fails silently in production, which is exactly how this bug survived.
   - **Acceptance:** upload a photo in the back-office (ask the owner to do it, or use the operator seed login yourself), then confirm it appears on `https://shos.hellfiresol.com/` after deploy. Nobody has been able to tick this box yet — you are the one who can.
2. **Report rejected checkouts (`record_order_attempt`).** S2 built the table and RPC in S2-03; nothing writes to them until you call it, so every funnel figure in the Berichte screen currently reads 0. Two call sites, per S2's spec:
   - a rejected `place_order` (parse the error's `details` for `problems[]` — `place_order` cannot write the row itself, its rejection rolls the transaction back),
   - a guest abandoning at a `problems[]` state from `quote_order` (out of zone, below minimum, closed, item unavailable) — fire once per distinct problem state, not per keystroke.
   - `session_hash`: an opaque per-visit id you generate client-side (not a cookie, not a fingerprint, not anything that identifies a person); the RPC rate-limits on it. Respect the PII rule — the table has a CHECK constraint, so a violation fails loudly; keep it that way rather than working around it.
3. **Security headers** (S7 finding 5). Add a `headers()` function in `next.config.ts` (or middleware): a real CSP (start report-only if you must, but land enforcing in this boot), `Strict-Transport-Security` with a durable max-age, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. Today's headers come from Cloudflare defaults, not from this repo — the app must set its own so they survive a CDN change. Verify with `curl -sI` against staging after deploy, and make sure the CSP does not break the Supabase client, the fonts, or `next/image`.
4. **Check the tracking-token page for leaks** while you are in there (S7 finding 8, the low one): `/order/[token]` should not send the token to any third party via `Referer` — set `Referrer-Policy: no-referrer` on that route if the global policy is looser.
5. **Tests**: unit-test the photo-URL resolver (bucket path, absolute URL, empty, malformed) and the attempt-reporting trigger logic (fires once per state, not per render). Keep `node (web)` green.
6. **Docs**: note the photo pipeline and the attempt call sites in `apps/web/README.md`. If you find a gap in §5, propose it in `/memory/boots/proposed/` — do not edit the contract.

## Boundaries
- Do NOT touch `apps/backend`, `apps/backoffice`, `apps/infra`.
- Do NOT build the payments UI, and do NOT send `payment_status: 'authorized'` from the client — S2-04 is removing the server's trust in that field entirely (S7's CRITICAL finding). v1 stays `pending`.
- Do NOT add analytics, a fifth colour, or another font.
- Do NOT edit `/docs/api-contracts.md`, `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- No secrets in the repo; `NEXT_PUBLIC_*` holds only the URL and the anon key.

## Done when
- [ ] An uploaded menu photo is visible on `https://shos.hellfiresol.com/` — confirmed after deploy, said plainly in the log
- [ ] `record_order_attempt` fires at both call sites; a rejected checkout on staging produces a row an operator can see
- [ ] Security headers served by the app itself, verified with `curl -sI`, CSP enforcing and nothing broken
- [ ] Tracking route does not leak its token via Referer
- [ ] `node (web)` CI green; PR `s3-02` merged

## Reporting
1. `/memory/log.md`: `## <date> — S3 Frontend — S3-02` — the photo result (this is the headline), attempt rows seen, header verification, blockers.
2. `/memory/state.md`: ONLY the S3 row.
3. Commits `[S3-02]`.

## Next step
S3-03 (payments UI) waits for S2-04 and the owner's Stripe account — do not start it. Other proposals → `/memory/boots/proposed/`. After reporting — stop and wait for S0.
