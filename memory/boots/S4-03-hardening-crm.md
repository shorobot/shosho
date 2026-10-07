# BOOT: S4-03 (Back-office) — S7's hardening findings, then Kunden / Profil (CRM)

## Role
You are session S4 (Back-office) of SHOSHO. Two halves: close S7-01's back-office findings first (they are small and one of them is an open redirect on a login screen that is about to get a public URL), then build the CRM screens — Kunden list with segments and Profil with the customer timeline.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4` run `git fetch origin && git checkout -b s4-03 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s4-03` → `main`. Repo language English; UI German primary with the EN toggle.
Read FIRST: `/memory/state.md`, `/memory/decisions.md`, then
1. `/memory/boots/proposed/S7-02-S4-backoffice-hardening.md` — your first half, with file:line.
2. `/docs/security.md` — the standing rules; your changes must not regress S7's matrix.
3. `/docs/api-contracts.md` **§6.4** (customers, `customer_stats`) and **§6.8** (`customer_events`, `add_customer_event`) — §6.9 rows 2 and 8 are implemented now: `staff_directory` exists, and `customer_stats` counts **completed orders only** with a separate `cancelled_count`.
4. The canvas screens **BO · Kunden** and **BO · Profil**, and the CRM-related empty states in BO · Zustände.
5. Your own `/memory/boots/proposed/S4-03-crm.md` — accepted as the second half; delete it in your PR.
6. `/memory/boots/proposed/S2-05-credentials-note.md` — **read this before you try to log in anywhere.** The staff passwords changed under you; see "Logging in" below.

## Refreshed 2026-10-05 — five things changed after this boot was written
S0 re-verified each of these rather than relaying them. Read them before task 1; two of them would otherwise cost you time, and one changes how urgent the hardening half is.

1. **Logging in is not what the boot originally assumed (S2-05).** `seed.sql` no longer sets a known password — each of the four staff accounts gets a random, immediately-discarded one, so a fresh project is never born with a credential that is in this public repo.
   - **Locally**, after `supabase db reset`, run `pnpm --filter @shosho/backend seed:local-logins` once; it sets a documented local-only password on all four accounts and refuses to run against anything but a loopback URL, so run it freely. Verified present in `apps/backend/package.json`.
   - **On staging**, `shosho-test-2026` is still live and still works, because the seed's `on conflict (id) do nothing` could not touch rows that already existed. Treat it as a known-compromised credential that happens to still function. The **owner** may run `rotate-staging-passwords.mjs` at any moment, after which the new values exist only in a gitignored file on their machine — if a staging login suddenly fails mid-boot, that is why: ask the owner, do not debug it.
   - Do not hardcode, log, commit or print any of these values.

2. **The hardening half is no longer hypothetical — the host is LIVE.** The old paragraph called the back-office hostname "a DNS record the owner may add any day". It exists and it works: **`https://bo-shos.hellfiresol.com/` answers today**, 401 behind TETA+PI's basic-auth, on both `:80` and `:443` (S1-06, PR #60, verified from outside by S1 and re-measured independently by S0 on 2026-10-06). Exactly **one owner action** now stands between that URL and a real human being: rotating the four seed logins. **So the open redirect at `LoginForm.tsx:53` is on a login screen that is one command away from a public audience.** Land part 1 even if part 2 runs long; if you must split, split there and say so.
   Two facts about that host you need while testing, and will not guess: the gate is basic-auth **in front of** the app (`/login` returns 401 before your code runs, so a browser prompt you did not write is expected, not a bug), and `http://bo-shos…` currently answers 401 in **cleartext** — a hostname-scoped Cloudflare Redirect Rule is on the owner's list. Neither is yours to change; the host is S1's boundary (D-004).

3. **The photo blocker in your own `state.md` row is closed.** S3-02 resolved bucket paths in `Photo.tsx`; S0 re-verified live on 2026-10-05 that the storefront serves `…/storage/v1/object/public/menu/…/1.png`. An uploaded menu photo does reach a guest now. Nothing for you to do — noted so you do not re-investigate it or carry it in your report as open.

4. **S2-04 is merged, and it changes what your screens should honestly show.** A guest `place_order` may only be `pending`; `authorized` comes only from the verified Stripe webhook; and a non-cash order with no provider now reaches `delivered`/`picked_up` with `payment_status` untouched plus a `payment_not_confirmed` note, instead of silently becoming `paid`. **Consequence: until the owner's Stripe keys exist, the board and history will legitimately show completed orders as unpaid.** That is correct. Do not "fix" it, hide it, or coerce a status — if anything, make it legible. Staff may record `paid` at order entry for money in hand, which writes an audited `order_events` note.

5. **Renumbering.** The campaigns/banners/CMS backend work referenced below as "S2-05" is **S2-06** — S2-05 was spent on the credentials fix above. The proposal file is `proposed/S2-03-reports-campaigns-cms.md`.

## Tasks — part 1, hardening (do this first)
1. **Open redirect** (`components/shell/LoginForm.tsx:52-53`): `?next=` accepts `//evil.example` because the check is a bare `startsWith("/")`. S0 confirmed it is still exactly that on `main` today — line 53 reads `router.replace(next && next.startsWith("/") ? next : "/")`. Accept only same-origin relative paths: reject anything starting `//` or `/\`, anything containing a scheme or a control character, and anything that `new URL(next, origin)` resolves to a different origin; fall back to the role's default route. Test the bypasses, not just the happy path — `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)`, a protocol-relative URL with whitespace or an encoded slash.
2. **Security headers** for `apps/backoffice`, set by the app itself rather than inherited from Cloudflare: CSP (the back-office must not be iframe-able — `frame-ancestors 'none'`), HSTS with a durable max-age, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Make sure the CSP allows Supabase (REST, realtime websocket, storage) and your fonts. `apps/backoffice/middleware.ts` already exists and `next.config` sets no headers today (S0 checked) — so this is new work, not an edit of something half-done. Verify through the tunnel with `curl -sI` and say what you saw.
   **Read `apps/web/lib/csp.ts` before you write yours — S3 paid for the comment at the top of it.** Their CSP is nonce-based and enforcing, which is *only* safe because the root layout is `export const dynamic = "force-dynamic"`. Make any route static or ISR and its cached HTML carries a stale nonce that blocks every script on the page, with no useful error. Either copy that constraint deliberately and document it in your own app, or choose a hash/`'self'`-based CSP that does not depend on per-request rendering — but decide it on purpose and say which you chose.
   **Expect to see HSTS twice and do not try to win that fight.** TETA+PI's nginx already sends `Strict-Transport-Security: max-age=86400` in front of the back-office (S0 observed it on `bo-shos` today), so once you add the app's own header both will appear. Per RFC 6797 a user agent processes only the first, so this is a duplicate-header smell rather than a bug; it is logged for S1/S7 to settle with TETA+PI and is explicitly **not yours to fix**. Report what you see and move on.
3. **Session cookie flags**: confirm `@supabase/ssr` is issuing `Secure`, `HttpOnly`, `SameSite=Lax` (or stricter) in production and fix the config if not. Note that staging is reached over plain http through the tunnel today — make sure a `Secure` cookie does not lock you out of local development, and document the local recipe.
4. Anything else in S7's file that is genuinely small. Do not take on S7 items filed to other sessions.

## Tasks — part 2, CRM
5. **Kunden** `/customers`: the list from `customers` + `customer_stats` (orders, spend, avg basket, last order, days silent, `cancelled_count`), search from the first character across name / phone / email / address, the four segments the design shows (Stammkunden 3+, new this month, sleeping 60+ days, companies), sort by any stat column, tags VIP / ALLERGIE / KATERING / PROBLEM with add/remove, and multi-select bulk actions. **Only the bulk actions that have a backend** — export (client-side CSV) and tagging. "Push senden" and "Gutschein senden" have no messaging or voucher-issuing backend yet (S2-06/S5): render them disabled with a tooltip naming what is missing, rather than a button that lies.
6. **Profil** `/customers/[id]`: contacts, both addresses, **kitchen note** (the allergy text that propagates onto every order card — make that consequence visible in the UI so nobody edits it casually), GDPR consents per channel with date and source (read-only display of `consent_*`; if you allow editing, write through so the `consent_changed` trigger fires), stats, most-ordered items, and the **timeline from `customer_events`** (orders, notes, complaints, compensations, consent changes, anonymisation) merged with the customer's orders in one chronological view. Actions: call / add note / add complaint / add compensation via `rpc('add_customer_event')`; "Bestellung anlegen" links to the phone-order form you already built.
7. **GDPR controls**: "Daten exportieren" (client-side JSON/CSV of everything this customer's rows hold) and "Daten löschen". Erasure on request is **not implemented server-side** — only the nightly 24-month job exists (S2's proposal covers it). Do not fake it: show the control disabled with an explanation, or open a confirmation that files the request as a `customer_events` note for an operator to action manually, and say in your report which you chose and why.
8. **Empty states** from BO · Zustände: no customer profiles yet, no search hits, customer with no orders, anonymised customer (show it as anonymised rather than as a broken row).
9. **Guards**: operator/owner only; kitchen and driver must not reach these routes. `staff_directory` is what resolves actor names in the timeline — use it, not the base `staff` table.
10. **Tests**: unit-test the segment predicates, the days-silent arithmetic, the redirect validator (with the bypasses), and the timeline merge ordering. Keep `node (backoffice)` green.
11. **Verify on staging** over the tunnel (`ssh -N -L 8202:127.0.0.1:8202 shos@164.90.235.66`, key `~/.ssh/shos_ed25519`) with the operator login — see "Logging in" above for which password, and expect it to be rotated out from under you: tag a customer, add a complaint and a compensation, confirm both land in `customer_events` and render in the timeline in the right order, and confirm a kitchen login is refused. Do not reseed or truncate `shosho-staging` — it is shared; create your own test rows and clean up what you can. Write what you saw, including anything that disagreed with what you expected.
12. **Docs**: extend `apps/backoffice/README.md`. Contract gaps → append to `/memory/boots/proposed/S4-contract-request.md`.

## Boundaries
- Do NOT touch `apps/backend`, `apps/web`, `apps/infra`.
- Do NOT build Website/CMS, Marketing or Berichte (S4-04 and later) — the nav placeholders stay.
- Do NOT implement messaging, vouchers or server-side erasure; surface them as unavailable instead.
- Do NOT edit `/docs/api-contracts.md`, `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT weaken S7's `security.test.ts` expectations.
- Do NOT touch the duplicate HSTS header coming from TETA+PI's nginx, or ask them for anything — the host is S1's boundary (D-004).
- Do NOT hardcode, print or commit any staff password, local or staging.
- No secrets in the repo; anon key + user session only.

## Done when
- [ ] `?next=` rejects `//evil.example` and every other non-same-origin form, with tests for each bypass
- [ ] Back-office sets its own security headers; `frame-ancestors 'none'` verified; cookies correctly flagged
- [ ] Kunden list with segments, search, tags, honest bulk actions
- [ ] Profil with consents, kitchen-note consequence visible, and the merged `customer_events` timeline
- [ ] GDPR export works; erasure is either filed as a request or clearly unavailable — not faked
- [ ] kitchen/driver refused; empty states present
- [ ] Staging walk-through in task 11 done and written up
- [ ] `node (backoffice)` CI green; PR `s4-03` merged

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-03` — hardening results first, then CRM, the staging walk-through, what you chose for erasure and why, blockers.
2. `/memory/state.md`: ONLY the S4 row — and drop the closed `Photo.tsx` blocker from it while you are there, since it is yours to edit and it is done.
3. Commits `[S4-03]`.
4. If you find a security issue outside your boundary, it goes straight to S7 (D-012) — tell S0, do not wait to be routed.

## Next step
S4-04 (Einstellungen + Website CMS + Marketing + Berichte) stays a proposal — it needs **S2-06** for campaigns/banners and S2-03's report views for Berichte. Do not execute. After reporting — stop and wait for S0.
