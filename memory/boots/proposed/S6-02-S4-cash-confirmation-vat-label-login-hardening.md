# PROPOSAL (filed by S6-01 QA) — three back-office findings: cash confirmation, VAT label, login hardening

## Owner
S4 Back-office (`apps/backoffice`).

## 1. MEDIUM/HIGH — the operator board never confirms cash, so a genuinely-collected cash order stays `pending`

**What.** `apps/backoffice/components/orders/OrderCard.tsx`'s generic action button
(`onClick={() => (a.dialog ? setDialog(a.dialog) : void run(order, a.to))}`) sends **no payload** for
`delivered` (`out_for_delivery → delivered`) or `handed_out` (`ready → picked_up`) — neither has a
`dialog` entry in `apps/backoffice/lib/orders.ts`'s `actionsFor`. On the backend,
`coalesce((payload->>'cash_received')::boolean, false)` (both
`20260921000015_set_order_status_payments.sql:98` and the newer
`20260926000022_event_payloads.sql:188`) treats "absent" exactly like "no": the order's
`payment_status` stays `pending` and an `order_events(note, code: cash_not_received)` is written —
even when the cash genuinely changed hands.

**Why it's real, not a test artifact.** `apps/backoffice/components/driver/DriverBoard.tsx` gets this
right: `onClick={() => void run(order, "delivered", { cash_received: order.payment_method === "cash" })}`.
But that's the **driver's own account** — pickup orders have no driver role at all, so the board's
generic button (confirmed used for `handed_out` on every pickup) is the *only* UI path to complete a
pickup order, and it has the bug. Delivery orders have a workaround (complete via the driver account
instead, which this boot's own `checkout-delivery.spec.ts` does) — pickup orders do not. This also
directly contradicts api-contracts §6.8: *"Cash on delivery — **the driver (or the operator on their
behalf) confirms**."* The operator path that clause promises doesn't exist.

**Where.** `apps/backoffice/lib/orders.ts`'s `actionsFor` (add a `dialog` for `delivered`/`handed_out`
when `order.payment_method === "cash"`, same shape as the existing `cancel`/`refund`/`driver` dialogs)
+ a new small confirm dialog (or reuse the pattern) that sends `{ cash_received: true | false }`
explicitly — mirroring `DriverBoard.tsx`'s own correct call.

**Repro / verification.** `apps/e2e/specs/checkout-pickup.spec.ts`'s last step: places a cash pickup
order, drives it to `FERTIG` via the board, clicks "Ausgegeben", and asserts `payment_status` is still
`pending` — which is the bug, asserted as the current (wrong) behavior so the test documents the gap
rather than silently passing through it.

## 2. MEDIUM — order detail's VAT line is hardcoded to 7%, regardless of order type

**What.** `apps/backoffice/components/detail/OrderDetail.tsx:176` renders
`t("detail.vat", { v: euro(order.vat_cents, lang) })`, and `detail.vat`'s DE/EN strings
(`apps/backoffice/lib/i18n.tsx:240,1038`) are literally `"inkl. 7 % MwSt. {v}"` / `"incl. 7% VAT {v}"`.
But design/README and api-contracts both say **VAT 7% delivery / 19% on-site**
(`menu_items.vat_delivery_pct` / `vat_onsite_pct`), and `orders.vat_cents` is computed at the right
rate per order type — only the *label* is wrong. A pickup order's detail screen claims "7% VAT" while
the number next to it was computed at 19%.

**Where.** `apps/backoffice/lib/i18n.tsx`'s `detail.vat` key (both languages) — needs to either show
the actual rate (requires passing it down, e.g. `order.vat_cents / order.subtotal_... ` isn't a clean
derivation since VAT applies per-line at each item's own rate; simplest correct fix is probably per-line
VAT display, or at minimum branching the label on `order.type === "pickup" ? 19 : 7` as a first pass)
or drop the percentage from the copy entirely and just show the amount.

**Repro / verification.** `apps/e2e/specs/checkout-pickup.spec.ts`: places a pickup order, reads
`menu_items.vat_onsite_pct` as the oracle, reads the rendered "incl. N% VAT" text on the detail screen,
asserts they match — fails today.

## 3. LOW — login form hardening: a cold-compile hydration race once produced a GET submission with the password in the URL

**What.** `apps/backoffice/components/shell/LoginForm.tsx`'s `<form onSubmit={onSubmit}>` correctly
calls `e.preventDefault()` as its first line — the code is right. But the `<form>` has no `method`/
`action` attribute, so on a cold `next dev` compile (this boot's `e2e` CI job hits exactly that: a
freshly-started dev server, first request), there's a real window between the SSR'd form painting and
React attaching the handler. A click inside that window falls through to the browser's native
submission, which for a method-less form defaults to GET — every field, **including the password**,
lands in the URL. Observed once, live, in this boot's own CI run:
`http://127.0.0.1:3102/login?email=operator%40shosho.test&password=local-dev-only`.

**Severity judgment.** Low, not higher: it needs a timing window that's wide open on a cold dev-mode
compile but narrows sharply on a production build, and no real user double-clicks within milliseconds
of first paint. Flagging it as hardening, not an active exploit.

**Suggested fix (one line, defense in depth).** Add `method="post" action="#"` (or equivalent) to the
`<form>` so even a pre-hydration native submission fails safe (posts nowhere useful, no query-string
leak) instead of leaking credentials into the URL, browser history and any access/referrer log that
sees the next request.

**Where it showed up.** `apps/e2e/fixtures.ts`'s `signInBackoffice` now waits for `networkidle` and
retries once if the URL shows the leak pattern — a test-side mitigation, not a fix; the proposal above
is the actual fix.

## Suggested `data-testid`
None required for any of the three — all driven by existing accessible text/roles.
