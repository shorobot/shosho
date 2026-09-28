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

**Timing matters for the hardening half.** The back-office vhost is live on the origin behind basic-auth, and the only thing standing between it and the public internet is a DNS record the owner may add any day. Land the hardening even if the CRM half runs long — if you have to split, split there and say so.

## Tasks — part 1, hardening (do this first)
1. **Open redirect** (`components/shell/LoginForm.tsx:52-53`): `?next=` accepts `//evil.example` because the check is a bare `startsWith("/")`. Accept only same-origin relative paths — reject anything starting `//` or containing a scheme, and fall back to the role's default route. Test the bypasses, not just the happy path.
2. **Security headers** for `apps/backoffice`, set by the app itself rather than inherited from Cloudflare: CSP (the back-office must not be iframe-able — `frame-ancestors 'none'`), HSTS with a durable max-age, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Make sure the CSP allows Supabase (REST, realtime websocket, storage) and your fonts. Verify locally with `curl -sI` through the tunnel and say what you saw.
3. **Session cookie flags**: confirm `@supabase/ssr` is issuing `Secure`, `HttpOnly`, `SameSite=Lax` (or stricter) in production and fix the config if not. Note that staging is reached over plain http through the tunnel today — make sure a `Secure` cookie does not lock you out of local development, and document the local recipe.
4. Anything else in S7's file that is genuinely small. Do not take on S7 items filed to other sessions.

## Tasks — part 2, CRM
5. **Kunden** `/customers`: the list from `customers` + `customer_stats` (orders, spend, avg basket, last order, days silent, `cancelled_count`), search from the first character across name / phone / email / address, the four segments the design shows (Stammkunden 3+, new this month, sleeping 60+ days, companies), sort by any stat column, tags VIP / ALLERGIE / KATERING / PROBLEM with add/remove, and multi-select bulk actions. **Only the bulk actions that have a backend** — export (client-side CSV) and tagging. "Push senden" and "Gutschein senden" have no messaging or voucher-issuing backend yet (S2-05/S5): render them disabled with a tooltip naming what is missing, rather than a button that lies.
6. **Profil** `/customers/[id]`: contacts, both addresses, **kitchen note** (the allergy text that propagates onto every order card — make that consequence visible in the UI so nobody edits it casually), GDPR consents per channel with date and source (read-only display of `consent_*`; if you allow editing, write through so the `consent_changed` trigger fires), stats, most-ordered items, and the **timeline from `customer_events`** (orders, notes, complaints, compensations, consent changes, anonymisation) merged with the customer's orders in one chronological view. Actions: call / add note / add complaint / add compensation via `rpc('add_customer_event')`; "Bestellung anlegen" links to the phone-order form you already built.
7. **GDPR controls**: "Daten exportieren" (client-side JSON/CSV of everything this customer's rows hold) and "Daten löschen". Erasure on request is **not implemented server-side** — only the nightly 24-month job exists (S2's proposal covers it). Do not fake it: show the control disabled with an explanation, or open a confirmation that files the request as a `customer_events` note for an operator to action manually, and say in your report which you chose and why.
8. **Empty states** from BO · Zustände: no customer profiles yet, no search hits, customer with no orders, anonymised customer (show it as anonymised rather than as a broken row).
9. **Guards**: operator/owner only; kitchen and driver must not reach these routes. `staff_directory` is what resolves actor names in the timeline — use it, not the base `staff` table.
10. **Tests**: unit-test the segment predicates, the days-silent arithmetic, the redirect validator (with the bypasses), and the timeline merge ordering. Keep `node (backoffice)` green.
11. **Verify on staging** over the tunnel with the operator login: tag a customer, add a complaint and a compensation, confirm both land in `customer_events` and render in the timeline in the right order, and confirm a kitchen login is refused. Write what you saw.
12. **Docs**: extend `apps/backoffice/README.md`. Contract gaps → append to `/memory/boots/proposed/S4-contract-request.md`.

## Boundaries
- Do NOT touch `apps/backend`, `apps/web`, `apps/infra`.
- Do NOT build Website/CMS, Marketing or Berichte (S4-04 and later) — the nav placeholders stay.
- Do NOT implement messaging, vouchers or server-side erasure; surface them as unavailable instead.
- Do NOT edit `/docs/api-contracts.md`, `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT weaken S7's `security.test.ts` expectations.
- No secrets in the repo; anon key + user session only.

## Done when
- [ ] `?next=` rejects `//evil.example` and every other non-same-origin form, with tests
- [ ] Back-office sets its own security headers; `frame-ancestors 'none'` verified; cookies correctly flagged
- [ ] Kunden list with segments, search, tags, honest bulk actions
- [ ] Profil with consents, kitchen-note consequence visible, and the merged `customer_events` timeline
- [ ] GDPR export works; erasure is either filed as a request or clearly unavailable — not faked
- [ ] kitchen/driver refused; empty states present
- [ ] Staging walk-through in task 11 done and written up
- [ ] `node (backoffice)` CI green; PR `s4-03` merged

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-03` — hardening results first, then CRM, the staging walk-through, what you chose for erasure and why, blockers.
2. `/memory/state.md`: ONLY the S4 row.
3. Commits `[S4-03]`.

## Next step
S4-04 (Einstellungen + Website CMS + Marketing + Berichte) stays a proposal — it needs S2-05 for campaigns/banners and S2-03's report views for Berichte. Do not execute. After reporting — stop and wait for S0.
