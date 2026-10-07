# S4 — contract requests for `/docs/api-contracts.md` §6 (from S4-01)

Written by S4 after building `apps/backoffice` against §6. Nothing here is urgent for S4-01 — the
app ships with the workarounds noted. S0 decides what becomes contract; S2 owns the DB side.

## 1. `settings` is invisible to the kitchen and driver roles
§4/RLS: `settings_staff_read` is `owner, operator` only. The kitchen screen therefore cannot read
`ops.prep_default_min` or `kitchen.rush`, and the shell's prep-time/rush chips are blank for them.
**Workaround:** those chips are only rendered for owner/operator; the kitchen board falls back to
`orders.promised_minutes` (which `set_order_status` already stamps).
**Request:** let `kitchen` and `driver` read the public keys **plus `ops`** (prep/rush minutes are
not sensitive), or add a `settings_ops_public` view.

## 2. `staff` is invisible to the kitchen and driver roles
`staff_read` is `owner, operator`; the other two roles see only their own row. Consequence: the
timeline on a kitchen screen cannot resolve the actor of an event, and a driver cannot see who else
is on shift. **Workaround:** unresolved actors render as "Team".
**Request:** allow every staff role to select `id, name, role, active` from `staff` (no phone).

## 3. No `driver_id` in the `handed_to_driver` event payload contract
The timeline wants "An Fahrer Jonas M. übergeben". The trigger writes the event, but §1.4 does not
state what `order_events.payload` contains per type. Today the UI reads `payload.driver_id` when it
is there and falls back to the order's current `driver_id`.
**Request:** fix the payload shape per event type in §1.4 (at least `handed_to_driver.driver_id`,
`cancelled.reason`, `note.text`, `created.channel`, `payment_authorized.payment_ref`).

## 4. `set_order_status` payload key for the cancel reason
§6.1 documents `{reason}` for `cancelled`; the implementation reads `payload.cancel_reason`
(`20260920000010_rpc.sql`). The UI sends both.
**Request:** pick one in §6.1 (suggest accepting both in the RPC, documenting `reason`).

## 5. No signal for two of the BO · Zustände error states
*"Artikel während des Checkouts ausverkauft"* and *"Adresse außerhalb des Liefergebiets"* are
operator-facing states in the design, but nothing in the schema reports them to the back-office:
`quote_order` returns the problem to the **guest**, and the order is simply never created.
**Request (S2-02+):** either an `order_attempts` table (rejected checkouts with their problem codes)
or a lightweight `problem_events` feed, so the board can show "two baskets affected".

## 6. Kitchen load has no model
The design shows "KÜCHENAUSLASTUNG 72 %". There is no capacity anywhere in the schema, so the shell
computes `accepted + preparing` against a hard-coded nominal capacity of 8 concurrent orders.
**Request:** `settings.kitchen.capacity` (concurrent orders) or a per-station capacity map, so the
number means something.

## 7. "Info" / notify the customer
The Unterwegs card in the design has an **Info** button (notify the customer). There is no messaging
channel in v1 (no push, no SMS, no email sender) — the button is not rendered.
**Request:** route it through S5's automation layer, or drop it from the design.

## 8. `customer_stats.orders_count` counts every order, including cancelled ones
The detail screen shows "14. Bestellung" from `customer_stats`. Whether cancelled/refunded orders
should count is a product question, not a UI one.
**Request:** state the intent in §6.4 (suggest: completed orders only).

---

## From S4-02 (menu editor + photos, 2026-09-27)

Items 1–8 above are answered in §6.9 and are being implemented by S2-03. The following are new.

## 9. The storefront cannot render an uploaded photo — **blocker for the S4-02 acceptance test**
§1.2 and §6.8 store `menu_items.photos` as **bucket-qualified paths** (`menu/<item_id>/<n>.jpg`), and
the back-office now writes exactly that. But `apps/web/components/ui/Photo.tsx` renders an image only
when `photos[0]` is an absolute URL:

```ts
return typeof p === "string" && /^https?:\/\//.test(p) ? p : null;
```

so every card on `https://shos.hellfiresol.com/` falls back to the placeholder stone. Verified on
staging 2026-09-27: `menu/<id>/1.webp` was uploaded, is public (HTTP 200, `image/webp`), renders in
the back-office — and the storefront shows zero `<img>` elements.

**Request:** an S3 boot to resolve bucket paths through
`supabase.storage.from('menu').getPublicUrl(path.replace(/^menu\//, ''))` (keeping the absolute-URL
branch for the seed). One function, no contract change. Until then "the storefront shows the photo"
cannot be ticked by anyone. `apps/web` is outside S4's boundary, so S4 did not touch it.

## 10. `photos` as an array of strings cannot carry the two crops the design asks for
BO · Artikel says *"Zuschnitt getrennt für Karte und Detailseite"* — separate crops for the card and
the detail page. `photos jsonb` holds one path per photo and nothing else, so there is nowhere to put
a second rendition or a focal point. S4-02 therefore ships a **focal-point picker** that bakes the
chosen crop into the uploaded pixels (one asset, dual-frame preview) and says so in the README.

**Request:** decide between
(a) leave it — one baked asset per photo, the design note is satisfied "well enough"; or
(b) widen `photos` to `[{path, focal?: {x,y}, card?: string}]`, which is a schema + contract change
touching `apps/web`, `apps/backoffice` and the seed, and needs S2 + S3 in the same wave.
S4's recommendation is (a) for v1 and (b) only if the restaurant's own photos turn out to need it.

## 11. No per-item sales figure for the Speisekarte
The design's items table has a **VERKAUFT** column and the Artikel editor a *"212 verkauft in der
Woche · 2 078 € Umsatz"* panel. There is no view for it (S2-03 owns the reports views), so S4-02
leaves the column out rather than filling it with a number the operator would trust.
**Request:** name the view and its columns in §6.5 when S2-03 lands it (suggest
`menu_item_sales(item_id, period, qty, revenue_cents)`), and S4 will wire both places.

## 12. `menu_categories` has no documented deletion rule
S4-02 ships create / rename / deactivate, because nothing states what happens to the items inside a
deleted category (`menu_items.category_id` is `not null`). Deactivating hides the category from the
site, which covers the design's intent, but test and retired categories accumulate forever.
**Request:** either declare deactivate-only as the product rule, or specify the delete (block while
items remain / move them to a category the operator picks).

## 13. `customer_stats` has no first-order timestamp, so "Neu diesen Monat" is keyed on `created_at`
Added by S4-03. The Kunden screen's four segments come off `customer_stats` (§6.4), which exposes
`orders_count`, `spent_cents`, `avg_cents`, `last_order_at`, `days_silent`, `cancelled_count` — but
nothing for the **first** order. The design's tile is *"Neu diesen Monat · erste Bestellung"*, so S4-03
keys it on `customers.created_at` in Europe/Berlin instead, which coincides because `place_order`
creates the profile when the phone number is new (§1.3).

It is an assumption the schema does not enforce: a profile created by hand, or imported, counts as
"new this month" with no order at all, and a customer whose first order is re-created after an
anonymisation would date from the wrong month.
**Request:** add `first_order_at timestamptz` to `customer_stats` (same `filter (where status in
('delivered','picked_up'))` as the other five) and S4 will switch the predicate to it in one line. Low
priority — the current behaviour is right for every row that exists today.

## 14. No single-customer GDPR erasure (restating §6.8's own note, now with a shipped workaround)
§6.8 says on-request erasure "is not in S2-02 — S4 should surface the request and S0 will schedule an
RPC for it", and `S2-single-customer-erasure.md` proposes one. S4-03 has shipped the surfacing half:
"Daten löschen" writes a `note` with `payload.kind = 'erasure_request'`, `requested_at` and
`requested_by` onto the customer's own timeline, and the profile renders it as pending until something
clears it.
**Request:** when that RPC is specified, have it (a) look for those marker notes so a request filed by
hand is not lost, and (b) write an `anonymised` event, which is what the profile already watches for.
The marker key is `erasure_request`, defined as `ERASURE_REQUEST_KIND` in
`apps/backoffice/lib/crm.ts`.

## 15. `order_items` has no option snapshot on the CRM's "most ordered" path — not a request, a note
"Bestellt am häufigsten" counts `order_items.name` (the snapshot column), which is correct, but it
means two orders of the same item with different options collapse into one line. That is what the
design shows and S4-03 keeps it. Recorded only so nobody reads the figure as option-level demand.
