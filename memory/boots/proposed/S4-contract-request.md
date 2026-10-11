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

---

## From S4-04 (Website CMS + Marketing, 2026-10-11) — §8's first consumer

§8 was written by S2 in S2-06 and had never been touched by a UI. Everything below is from building
against it; items 16 and 17 are the two that actually shaped the screens, and 16 is the one worth
S0's time.

## 16. `resolve_segment` cannot produce the recipient pair the design asks for — and that is by design, which is the problem

The Kampagne screen's headline is *"141 Empfänger · 118 mit Einwilligung · 23 ohne Push-Einwilligung
werden übersprungen"*. Three numbers, and §8.2 can supply exactly one of them.

`resolve_segment(segment, channel)` applies consent and `anonymised_at is null` **first and
unconditionally**, so every row it returns is already consented. Asking it for the 141 is asking it
to be looser, which is the single property it was built not to have ("a caller who forgets consent
gets fewer rows, never more"). So:

- **118** — yes, `rows.length` for the campaign's own channel.
- **141** — impossible. No argument makes the function report the pre-consent match count.
- **23** — impossible, because it is `141 − 118`.

The only ways to get it are both bad: re-derive the segment client-side (a second implementation of
exactly what §8.2 centralises — `tags`, `is_company`, `min/max_orders`, `min/max_days_silent`,
`created_within_days` against `customer_stats`), or widen the function. S4-04 did neither. It shows
the reachable count, the push/email/both split inside it (which the returned `has_*_consent` columns
*do* support), and an expandable note saying the without-consent denominator is unavailable, with the
total non-anonymised profile count as explicitly-different context.

**Request — S4's preference, in order.** (a) A companion **counts-only** function that is allowed to
be looser because it returns no identities:
`resolve_segment_counts(segment) → { matched, consented_push, consented_email, consented_any }`,
owner/operator only. It cannot leak a customer, it answers all three of the design's numbers, and the
sending path still goes through `resolve_segment` — so "one implementation" is preserved where it
matters (who gets contacted) and relaxed only where it does not (how many matched). (b) Leave §8.2
alone and change the **design** copy to the reachable figure plus the channel split, which is what the
screen ships today. (c) Do nothing — the screen is honest as it stands, and this is a nicety, not a
blocker.
S4 recommends (a) if S5 is going to need a dry-run count anyway, otherwise (b).

## 17. `banners.draft` cannot express "clear this field", and a naive attempt breaks the whole publish

`publish_site()` merges with `coalesce(draft->>'col', col)` per column, so a key that is absent **or
JSON null** keeps the live value. There is therefore no way to spell "set this back to NULL".

For text columns that is survivable: staging `""` publishes an empty string, which reads as absent.
For the two **timestamptz** columns it is not. `(draft->>'valid_to')::timestamptz` on an empty string
raises `invalid input syntax for type timestamp with time zone`, and because `publish_site()` is one
statement per table, **that failure aborts the entire publish** — including every unrelated pending
settings key and banner. One operator clearing one date would block the whole site's publish with a
Postgres error.

S4-04 defends against it from this side: `bannerDraftPatch()` (`lib/site.ts`) refuses to stage such a
clear, returns it in `clears`, and the editor offers an explicit immediate write with the reason
stated. Covered by a test. But the trap is still armed for the next consumer — a migration, a script,
S5, or a future screen that writes `draft` directly.

**Request:** make it unrepresentable rather than merely documented. Either (a) a sentinel the function
understands — treat the JSON string `""` as NULL for the cast columns:
`nullif(draft->>'valid_to','')::timestamptz` — which also makes text clears consistent; or (b) a
`check` constraint on `banners.draft` refusing non-null non-timestamp values for those two keys, so a
bad draft is rejected at write time instead of at publish time. (a) is one line and gains a
capability; S4 recommends (a).

## 18. §8.7's description of the `anon` column grant is slightly wrong, in the safe direction

§8.7 says `anon`'s grant is "revoked and re-granted for exactly `(key, value, created_at,
updated_at)`", which reads as though `select *` would return those four columns. **Measured against
`shosho-staging` with the anon key: it returns `42501 permission denied for table settings`.** Column
privileges do not satisfy `SELECT *`.

Better than documented — the leak is closed twice over — but the consequence is real and undocumented:
**every anon consumer must name its columns.** `apps/web/lib/api-supabase.ts:95` already does
(`select("key, value")`), which is the only reason the storefront is unaffected; S4 checked rather
than assumed. A future `apps/web` query written as `select("*")` would fail with a permission error
that points at the table, not at the real cause.

**Request:** one sentence in §8.7 stating that `anon` has no table-level SELECT on `settings` and must
select named columns. Asserted in `apps/backoffice/tests/anonDraft.live.test.ts` so it cannot regress
silently.

## 19. `delivery_zones` has no `draft`, but the CMS screen is where zones are edited

The design puts delivery zones on BO · Website, next to the banners and the publish button; §8.7 gave
`draft` to `settings` and `banners` only. So on one screen, under one "unpublished changes" counter,
zone edits are **live immediately** while everything around them is staged. (The S4-04 boot itself
described zones as going "through `settings` keys, all into `draft`" — they are their own table.)

S4-04 ships this honestly: the panel header and the zone dialog both say zone changes are not part of
the draft and take effect at once, and `ZONES_ARE_STAGED = false` is a constant a test asserts so the
copy and the behaviour cannot drift. Zones are also owner/**operator**-write, unlike `settings`
(owner-only), so three different write rights meet on this screen.

**Request:** a ruling, not necessarily a change. Either (a) accept it and record in §8.7 that zones
are deliberately immediate — defensible, since a zone edit is operational (a courier cannot reach a
street today) rather than editorial; or (b) add `draft jsonb` to `delivery_zones` and extend
`publish_site()`, which makes the screen uniform at the cost of delaying an operational fix behind an
owner's publish. S4 leans (a), and only notes that whichever it is should be written down, because
the next person to read the screen will assume uniformity.

## 20. `publish_site()`'s return shape differs from the `site_publications` row for the same facts

The function returns `{ id, settings_keys, banner_ids }` at the top level; the row stores the same
information nested under `summary`. Trivial, but it means two readers (`publishResult()` and
`publicationSummary()` in `lib/site.ts`) for one concept. Not worth a migration on its own — worth
folding into any future change to either.

## 21. Not a request — three things §8 got right, recorded because they saved real work

- **The required `channel` argument on `resolve_segment`.** Switching channel in the wizard
  re-resolves, and the three channel cards derive their figures from one returned row set. A
  one-argument version with channel folded into the segment jsonb would have let the preview and the
  send disagree, and the bug would have shown up as "we messaged people who had opted out".
- **`campaign_recipients` having no insert policy for any role.** It turned "Senden" from a judgement
  call into a fact: this app *cannot* queue a send, so the disabled button is the truth rather than a
  policy choice a later boot could quietly reverse.
- **Seeding the four `automations` rows inactive.** The screen renders its four toggles on a fresh
  project with no first-run special case.
