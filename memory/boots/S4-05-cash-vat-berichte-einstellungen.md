# BOOT: S4-05 (Back-office) — fix the cash bug first, then the last two stubs

## Role
You are session S4 (Back-office) of SHOSHO. Three of S6-01's QA findings are yours, and **one of them breaks money accounting in production-shaped use** — fix that before building anything new. Then close the last two `ComingSoon` stubs, **Berichte** and **Einstellungen**, after which all ten back-office sections exist.

## Context
Repo: https://github.com/shorobot/shosho. **Working tree (D-008):** in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4` run `git fetch origin && git checkout -b s4-05 origin/main`. Merge `origin/main` before any PR touching `/memory` (D-009). PR `s4-05` → `main`. Repo language English; UI German primary with the EN toggle.
Read FIRST: `/memory/state.md` (the SNAPSHOT block, then S6-01's findings table), `/memory/decisions.md` — **D-015** (the funnel's menu→cart step is unmeasurable; Berichte must say so rather than invent a number) and **D-017**, then:
1. `/memory/boots/proposed/S6-02-S4-cash-confirmation-vat-label-login-hardening.md` — S6's three findings with file:line and the specs that prove them. **This is the priority half of this boot.**
2. `/memory/boots/proposed/S4-05-reports.md` — your own Berichte specification, with the five report RPCs and their guards.
3. `/memory/boots/proposed/S4-04-settings-cms.md` — its Website half is struck; **its Einstellungen half stands as written**, including the two things it says it got wrong. Read those two files together.
4. `/docs/api-contracts.md` **§6.8** (what cash confirmation is supposed to do), **§6.10** (reports), **§8.5** (`report_payments`).

**S6-01's PR #77 may still be open when you start.** Its specs are the proof of findings 1–3 below, and several are written to **flip from red to green when you fix them** — that is deliberate, and it means your fix is what turns their suite green. Do not edit `apps/e2e/`; if a spec needs changing, say so in your report.

## Tasks — part 1, S6's findings (do this first; land it even if part 2 runs long)
1. **MED/HIGH — the operator board never confirms cash, so a genuinely-collected cash order stays `pending` forever.** `components/orders/OrderCard.tsx`'s generic action button sends **no payload** for `delivered`/`handed_out` (no `dialog` entry for either in `lib/orders.ts`'s `actionsFor`), and the SQL's `coalesce((payload->>'cash_received')::boolean, false)` treats *absent* exactly like *no*. `components/driver/DriverBoard.tsx` already gets this right (`cash_received: order.payment_method === "cash"`) — but **pickup orders have no driver role at all**, so the board's generic button is the *only* real path to complete a pickup, cash or not. This contradicts §6.8 verbatim: "the driver **or the operator on their behalf** confirms".
   - Fix it so an operator completing a **cash** order is asked, explicitly, whether the money is in hand — and so the answer travels in the payload. Do not default it to `true`: that would swap a false negative for a false positive, which is worse because it silently asserts revenue that may not exist.
   - A non-cash order must not grow a pointless dialog. Decide the shape and say why in your report.
   - **Verify with a real order**, not a unit test alone: drive a cash pickup to completion through the board and confirm `payment_status` and the `order_events` note are both right. S6's `checkout-pickup.spec.ts` is the oracle for what "right" means.
2. **MEDIUM — the VAT label lies on pickup orders.** `components/detail/OrderDetail.tsx:176` and i18n key `detail.vat` (`lib/i18n.tsx:240,1038`) are literally "incl. 7% VAT {v}" in **both** languages. Pickup VAT is computed at 19% server-side from `menu_items.vat_onsite_pct` and is **correct** — only the label is wrong. Render the rate the order actually used; do not hardcode either number.
3. **LOW — a hydration race put a back-office password in a URL.** `components/shell/LoginForm.tsx`'s `onSubmit` correctly calls `e.preventDefault()`, but the `<form>` has no `method`/`action`, so a click landing before React attaches on a cold compile falls through to a **native GET** — observed live in S6's own CI run as `/login?email=…&password=…`. Add `method="post"` (one line, defence in depth). While you are there, consider whether the submit control should be disabled until hydration; say what you chose.
4. **LOW/INFO, fold in since you are in this code:** `components/orders/CancelDialog.tsx` sends `reason: t(reason)` — the **translated label**, not a stable code — so an operator cancelling in DE writes a German sentence into a column that the CSV export, an EN-toggled detail view and every report render verbatim forever. Store a stable code and translate at render. If that needs a contract note, append to `proposed/S4-contract-request.md`.

## Tasks — part 2, the last two stubs
5. **Berichte** (`/reports`) per your own `S4-05-reports.md`: period picker (Europe/Berlin dates, both ends inclusive), KPIs, revenue by day, top items, delivery times, and `report_payments`. **Two things to get right rather than discover:**
   - `report_payments` is **owner/operator only** while the other four admit any active staff role (§8.5). So a `kitchen` login must see the first four and **not** the fifth — handle that as a designed difference, not an error state.
   - **`report_payments` will read zero**, because no live payment has ever run. Render that as "no payment data yet" with the reason, **never as €0.00** — a zero reads as "no sales", a different and alarming claim.
   - Per **D-015** the funnel's **menu→cart** step is unmeasurable in v1 and no `site_events` table exists or is planned. Show it as unavailable with that reason. `report_funnel` was fixed in S2-06 to report the window its ratio actually covers — surface that window rather than hiding it.
   - XLSX export. Keep it client-side; no new server surface.
6. **Einstellungen** (`/settings`) per `S4-04-settings-cms.md`'s Einstellungen half: team & roles via the `staff_directory` view (**not** the base `staff` table, which holds PII and stays owner/operator), notifications, operations, a read-only payments view, legal, language, timezone.
   - **Do NOT build the team-invite flow.** It needs a service-role Edge Function, which cannot live in this anon-key app. Render it as unavailable and name what is missing — the same honesty rule S4-04 applied to "Senden".
   - Settings are **owner-write**: an operator must see the screen read-only rather than a Postgres error (`run()` from `lib/menuStore.tsx`).
7. **Guards and empty states** for both routes, and remember S4-03's finding: a kitchen write can **no-op silently** (RLS matches zero rows, PostgREST returns `200` with `[]`), so test the **route guard**, not just the RLS.

## Boundaries
- Do NOT touch `apps/backend`, `apps/web`, `apps/infra`, or `apps/e2e` (S6's).
- Do NOT implement the invite flow, any sending, or push.
- Do NOT default `cash_received` to `true` anywhere.
- Do NOT edit `/docs/api-contracts.md` (propose instead), `/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md`, `/docs/design/*`.
- Do NOT reseed or truncate `shosho-staging`. **Credentials:** the seed passwords were rotated 2026-10-09 and verified working 2026-10-11; the published `shosho-test-2026` is dead. Ask the owner for the current value — it exists only in a gitignored file on their machine. Never print or commit it.
- S7-02 may be auditing `docs/security.md` and backend policies in parallel — do not touch either.

## Done when
- [ ] A cash order completed through the **board** records `payment_status` correctly, verified on a real order, with the operator asked rather than defaulted
- [ ] The VAT label shows the rate the order actually used, on both delivery and pickup
- [ ] `method="post"` on the login form; hydration decision stated
- [ ] `cancel_reason` stores a stable code, translated at render
- [ ] Berichte: five reports, `report_payments` owner/operator-only and shown as "no data yet" rather than €0.00, funnel's menu→cart shown unavailable per D-015, XLSX export
- [ ] Einstellungen: team via `staff_directory`, invite shown unavailable with the reason, owner-write respected read-only for operators
- [ ] kitchen/driver refused on both routes, **guards** tested
- [ ] `node (backoffice)` CI green; PR `s4-05` merged

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-05` — the cash fix and how you verified it on a real order first, then the rest; what you chose for the non-cash dialog and the hydration question, and anything in §6.8/§6.10/§8.5 that was wrong or awkward.
2. `/memory/state.md`: ONLY the S4 row.
3. Commits `[S4-05]`.
4. Security findings outside your boundary go straight to S7 (D-012) — tell S0, do not wait.

## Next step
After this, all ten back-office sections exist. Remaining S4-adjacent work: the `S7-02-S4-backoffice-hardening.md` leftovers and `S7-S4-03-httponly-correction.md`. Proposals → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
