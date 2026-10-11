# S4-05 (proposed) — Berichte + Einstellungen, the last two `ComingSoon` stubs

Filed by S4 at the end of S4-04, on S0's instruction in that boot's "Next step". **Not executed.**
After this boot lands, all ten back-office sections exist.

The **Einstellungen** half is already specified in `S4-04-settings-cms.md` — that file's Website half
is struck through and its Einstellungen half, plus the two things it got wrong, stand as written.
Read it together with this. This file covers **Berichte**, which nothing has specified yet.

## Berichte (`/reports`) — what the backend already provides

Five functions, all of them already shipped and never consumed by a UI:

| Call | Shipped in | Guard |
|---|---|---|
| `rpc('report_revenue_by_day', { from_date, to_date })` | S2-03 | `reports_guard()` — any **active staff role** |
| `rpc('report_top_items', { from_date, to_date, limit_count })` | S2-03 | same |
| `rpc('report_funnel', { from_date, to_date })` | S2-03, fixed in S2-06 | same |
| `rpc('report_delivery_times', { from_date, to_date })` | S2-03 | same |
| `rpc('report_payments', { from_date, to_date })` | S2-06 (§8.5) | **owner/operator only** — narrower than the other four, deliberately |

`from_date` / `to_date` are Europe/Berlin calendar dates, both ends inclusive, defaulting to the last
30 days. Money is integer cents. Full column lists in §6.10 and §8.5.

**Note the guard mismatch.** Four functions admit kitchen and driver; `report_payments` does not. The
route should be owner/operator (the design's screen mixes payment data with revenue), but the screen
must not assume a uniform guard — if a later boot opens `/reports` to kitchen, four calls would
succeed and the fifth would raise `42501`. Either keep the route owner/operator, or handle that one
rejection as a panel that explains itself rather than as a screen-level error.

## Two things this boot must get right

### 1. MENÜ → WARENKORB is unmeasurable, and the screen must say so

**D-015 (2026-10-06)** rules that SHOSHO v1 collects **no client-side behavioural events**. The
`site_events` table S2 proposed was explicitly not built and is not planned. So the design's first
funnel tile has no data source and cannot acquire one without a new owner-level decision about
collecting personal data on a German storefront.

Render it as **unavailable with the reason**, never as a number and never as `0 %` — a 0 there reads
as "nobody adds anything to the basket", which is a claim about the product. S4-04 already has the
shape for this: `Kpi = { value, unit } | { unavailable: reason }` in `lib/marketing.ts`, with the
reason rendered as copy. Reuse it rather than inventing a second convention.

Also unavailable, for a different reason: **`attempts`, `attempts_with_problems` and
`attempts_to_placed_pct` read 0 / null until S3-03 ships**, because nothing calls
`record_order_attempt` yet. That is "nothing recorded", not "nothing happened", and the two reasons
are different sentences. And when S2-06's `attempts_window_from` / `attempts_window_to` come back
**null**, the requested range does not overlap the period `order_attempts` has existed for at all —
show the sub-window the ratio actually covers whenever it is narrower than what the user asked for,
or the figure silently answers a different question from the one on screen.

### 2. XLSX export

The only genuinely new UI capability in this boot. `lib/csv.ts` is client-side and the Historie
screen's CSV is semicolon-separated with a BOM for German Excel; XLSX needs a real writer.

- **No dependency exists yet.** Adding one to `apps/backoffice` is a `package.json` change and
  therefore S1's CI surface — flag it in the boot rather than discovering it at review. `exceljs` and
  `write-excel-file` are the obvious candidates; `xlsx` (SheetJS) has had a supply-chain history worth
  a look from S7 first, which is cheaper to ask before the install than after.
- **Keep it client-side**, like the CSV: the data is already in the browser from the RPC, the anon key
  cannot reach anything the user could not already see, and a server route would need a session the
  app does not have a server-side pattern for.
- One workbook, one sheet per report, a header row with the window stated in the sheet itself (not
  only in the filename) — an exported figure that does not carry its own date range is a figure
  someone will misread in three months.

## Scope boundaries for the boot

- Both routes exist as `ComingSoon` stubs today: `app/(shell)/reports/page.tsx`,
  `app/(shell)/settings/page.tsx`. Flipping them needs the same two-line nav change S4-04 made in
  `components/shell/Shell.tsx` (`live: true`).
- **Do NOT build the team-invite flow.** It needs a service-role Edge Function and cannot live in this
  app (anon key only). Einstellungen should surface the team read-only from `staff_directory` (§6.9)
  and say what the manual path is, exactly as S4-01 documented it.
- **One nav nit to fix while in there:** `nav.customers` is still marked `live: false` (a `SOON`
  badge) although S4-03 shipped Kunden. S4-04 left it alone because S6-01 was running against the
  shell and the boot fenced nav edits. It is one word.
- `settings` is **owner-write** — the whole Einstellungen screen is one owner-only form, and every
  field needs `lib/write.ts`'s `wrote()` because an operator's update is a silent no-op, not an
  error. See `S4-04-settings-cms.md` for the measurement.

## What makes this boot "done"

Berichte: period picker, KPI row, revenue by day (delivery / pickup / upsell), top items, delivery
times by zone, payments by method × status, the funnel with its two honest gaps stated, XLSX export.
Einstellungen: team (read-only + the documented manual invite path), notifications, operations,
payments (read-only), legal, language, timezone, danger zone. Guard tested for kitchen/driver on both
routes, empty states from BO · Zustände ("Keine Daten im Zeitraum" is the one this screen needs most),
`node (backoffice)` green.
