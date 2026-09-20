# API CONTRACTS — SHOSHO

The single place where contracts between layers are fixed. Changed ONLY through S0.
A child session that needs a contract change → writes a proposal to /memory/boots/proposed/.

Derived from `/docs/design/` by S0 on 2026-09-20; reconciled with what S2-01 actually shipped (PR #6) on 2026-09-20 — §1–4 now describe the **implemented** schema; items marked S2-02 are not built yet. Source of truth for column names: `apps/backend/supabase/migrations/` + `apps/backend/types/database.ts`.

## 1. DB schema (Supabase / Postgres, schema `public`)

Conventions: `id uuid pk default gen_random_uuid()`, `created_at/updated_at timestamptz`, money in **integer cents**, enums as Postgres enums, i18n as paired columns `*_de` / `*_en` (+ `*_ja` for kana where the design shows it). All tables have RLS on.

### 1.1 Settings & team — S2-01
| Table | Key columns | Notes |
|---|---|---|
| `settings` | `key text pk`, `value jsonb` | single-tenant key/value: `business` (name, address, phone, email, impressum, ust_id), `opening_hours` (per weekday + holidays), `ops` (prep_default_min=22, rush_extra_min=15, preorder_max_days=7, auto_accept_paid_under_cents=5000, pause_allowed, pickup_discount_pct=10), `payments` (private: provider, payout) and **`payments.enabled`** (public: methods, tip_presets_cents, capture), `kitchen` (private: paused_by, paused_at, rush bool) and **`kitchen.status`** (public: paused, since — written by `kitchen_pause()`), `site` (seo title/desc, cookie_banner, robots, maintenance). Public allow-list = `settings_public_keys()`: business, opening_hours, site, payments.enabled, kitchen.status |
| `staff` | `id uuid pk = auth.users.id`, `name`, `role staff_role`, `phone`, `active` | `staff_role`: `owner`, `operator`, `kitchen`, `driver` |
| `delivery_zones` | `code text` (A/B/C), `name`, `areas text`, `min_order_cents`, `fee_cents`, `free_delivery_over_cents int null` (null = never free), `promised_minutes`, `active`, `postal_codes text[]` | zone resolution v1 = by postal code list; polygon later |

### 1.2 Menu — S2-01
| Table | Key columns | Notes |
|---|---|---|
| `menu_categories` | `slug`, `name_de`, `name_en`, `name_ja`, `sort int`, `active`, `schedule jsonb null` | schedule e.g. `{"days":[1,2,3,4,5],"until":"15:00"}` (lunch) |
| `menu_items` | `sku text unique` (RL-014), `category_id`, `name_de/en`, `name_ja`, `transliteration`, `description_de/en`, `base_price_cents`, `cost_cents`, `photos jsonb` (storage paths), `available bool`, `stoplist_until date null`, `stock_remaining int null`, `max_per_order int null`, `tags text[]` (new/hit/spicy/vegetarian), `prep_minutes`, `station text`, `kitchen_note`, `allergens text[]` (A–N), `weight_g`, `kcal_per_100g`, `vat_delivery_pct` (7), `vat_onsite_pct` (19), `sort`, `recommended_item_ids uuid[]` | "on sale" = `available AND (stoplist_until IS NULL OR stoplist_until < today) AND category.active` |
| `option_groups` | `name_de/en`, `shared bool`, `min_select int`, `max_select int null`, `required bool` | rules from design: any (0,null), exactly one (1,1), 0–3 (0,3) |
| `options` | `group_id`, `name_de/en`, `price_cents` (0 = free), `sort`, `active` | |
| `menu_item_option_groups` | `item_id`, `group_id`, `sort` | m2m |

### 1.3 Customers (CRM) — S2-01 core, timeline S2-02
| Table | Key columns | Notes |
|---|---|---|
| `customers` | `name`, `phone text unique` (E.164), `email`, `kitchen_note` (allergy — copied onto every order), `tags text[]` (VIP/ALLERGIE/KATERING/PROBLEM), `birthday date null`, `is_company bool`, `consent_email/push/phone jsonb null` (`{granted_at, source}`), `anonymised_at null` | created automatically by `place_order` when phone is new |
| `customer_addresses` | `customer_id`, `label`, `street`, `floor_apt`, `postal_code`, `city`, `zone_id null`, `is_default` | |
| `customer_events` (S2-02) | `customer_id`, `type` (order/complaint/compensation/note/push_opened/…), `payload jsonb`, `actor_id null` | profile timeline |
| view `customer_stats` | orders_count, spent_cents, avg_cents, last_order_at, days_silent | for CRM list/segments |

### 1.4 Orders — S2-01
| Table | Key columns | Notes |
|---|---|---|
| `orders` | `number int unique` (sequence, #2418), `channel order_channel`, `type order_type`, `status order_status`, `payment_status payment_status`, `payment_method payment_method`, `payment_ref text` ("Visa ···4417"), `customer_id null`, `contact_name`, `contact_phone`, `address jsonb null` (snapshot: street, floor_apt, postal_code, city), `zone_id null`, `distance_km null`, `courier_comment`, `comment_flags text[]` (leave_at_door/dont_ring/call_on_arrival/no_wasabi), `allergy_note` (snapshot of customer.kitchen_note), `scheduled_for timestamptz null` (null = ASAP), `promised_minutes`, `accepted_at/by`, `preparing_at`, `ready_at`, `driver_id null`, `out_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `subtotal_cents`, `discount_cents`, `delivery_fee_cents`, `tip_cents`, `total_cents`, `vat_cents`, `promo_code text null`, `tracking_token text unique` (16 random bytes hex; guest tracking) | enums: `order_channel` website/phone/instagram/facebook/lieferando/wolt · `order_type` delivery/pickup · `order_status` new/accepted/preparing/ready/out_for_delivery/delivered/picked_up/cancelled/refunded · `payment_status` pending/authorized/paid/failed/refunded · `payment_method` card/apple_pay/google_pay/paypal/bitcoin/cash |
| `order_items` | `order_id`, `item_id null`, `name snapshot`, `qty`, `unit_price_cents`, `options jsonb` (snapshot `[{group, option, price_cents}]`), `line_total_cents`, `modified_by_operator bool` | |
| `order_events` | `order_id`, `at`, `type text` (created/payment_authorized/accepted/preparing/item_changed/ready/handed_to_driver/delivered/picked_up/cancelled/refunded/note), `actor_type` (customer/staff/system), `actor_id null`, `payload jsonb` | the "Verlauf" timeline; written by triggers on status change and by RPC |

### 1.5 Promotions — S2-01 (promo codes only)
| Table | Key columns | Notes |
|---|---|---|
| `promo_codes` | `code text unique` (upper), `kind` percent/fixed, `value` (pct or cents), `min_order_cents`, `applies_to jsonb` (`{"scope":"all"|"category"|"first_order", "category_id":…, "days":[…], "until":"15:00"}`), `usage_limit int null`, `used_count`, `valid_from/to`, `active` | |
| `campaigns`, `automations`, `banners`, `site_publications` (S2-02 / S4) | — | later |

### 1.6 Sequences / triggers — S2-01
- `orders.number` from `order_number_seq` starting at 1000.
- `set_updated_at` on every table.
- On `orders.status` change → insert `order_events`; on `promo_code` use → `promo_codes.used_count += 1`; on `stoplist_until < today` — nothing (computed at read).
- Nightly job (pg_cron or S5 later): reset expired stoplists is not needed (date compare); anonymise customers 24 months silent (S2-02).

## 2. RPC (Postgres functions, `security definer`, exposed via PostgREST) — S2-01
| Function | Caller | Contract |
|---|---|---|
| `quote_order(payload)` | anon (web) | input: items `[{item_id, qty, option_ids[]}]`, `type`, `postal_code?`, `promo_code?`, `scheduled_for?` → returns lines with snapshots, subtotal, discount, fee, total, zone, promised_minutes, problems `[{code, item_id?, reason?}]` (unavailable, invalid_options, below_min_order, out_of_zone, closed, promo_invalid, empty_cart, invalid_input). Pure, no writes. Full shape in §5.2. |
| `place_order(payload)` | anon (web) | same input + `contact {name, phone}`, `address?`, `courier_comment`, `comment_flags[]`, `payment_method`, `tip_cents`. Re-runs quote server-side (never trust client totals), rejects if problems, upserts customer by phone, creates order (+items, +event `created`), returns `{order_id, number, total_cents, tracking_token, status}` (status `accepted` when auto-accept applied). Accepts `payment_status` pending/authorized + `payment_ref` as reported by the client in v1; staff callers may set `channel` (phone). Payment authorization itself = S2-02 (Stripe). |
| `set_order_status(order_id, new_status, payload?)` | staff | enforces the allowed transitions and role gates (kitchen: preparing/ready only; driver: delivered on own orders); writes event with `actor_id = auth.uid()`; `preparing` sets `promised_minutes` from settings + rush. Returns the full updated `orders` row. v1 payment stub: delivered/picked_up → `paid`; cancelled resets authorized → pending (replaced in S2-02). |
| `get_order_by_token(token)` | anon | guest order tracking (status + ETA), no PII beyond what the guest entered. |
| `kitchen_pause(paused bool)` | operator/owner | flips `settings.kitchen.paused`, event. |

## 3. Realtime — S2-01
- Channel `orders` (postgres_changes on `orders`, `order_items`, `order_events`) for staff — the board and the detail view update live.
- Guest tracking: `orders` filtered by `id` = own order, via token-scoped RLS (S2-02).

## 4. RLS — S2-01
| Role | menu_* / delivery_zones / settings public keys | orders / customers | staff / settings private |
|---|---|---|---|
| `anon` | select (only on-sale items, active categories, active zones, public settings keys) | none directly — only via RPC | none |
| `authenticated` staff `operator`/`owner` | all | all; `promo_codes` all | owner: all; operator: read |
| `kitchen` | select (same as anon) | select orders; `preparing`/`ready` only via `set_order_status` (no direct UPDATE) | own `staff` row only |
| `driver` | select (same as anon) | select own orders (`driver_id = auth.uid()`); `delivered` via `set_order_status` | own `staff` row only |
| `service_role` (automation, S5) | all | all | all |

## 5. Web → Supabase (S3 reads this) — written by S2 in S2-01, reviewed by S0

Client: `@supabase/supabase-js` with the **anon** key, no auth session (guest checkout). Types: `import type { Database } from "@shosho/backend/types/database"` (file `apps/backend/types/database.ts`). Money = integer cents. Times = ISO timestamptz; the DB reasons in `Europe/Berlin`. Additions to §1–4 that S3 relies on are listed in `/memory/boots/proposed/S2-contract-change.md`.

### 5.1 Reads (tables / views, RLS-filtered for anon)
| Call | Returns | Notes |
|---|---|---|
| `from('menu_categories').select('id, slug, name_de, name_en, name_ja, sort, schedule').order('sort')` | active categories | hide a category client-side when it has no on-sale item (product rule) |
| `from('menu_items').select('*').order('sort')` or `from('menu_items_on_sale')` | **on-sale items only** (available, not stoplisted today, category active) | `photos` = storage paths (jsonb array), `tags` (`new`/`hit`/`spicy`/`vegetarian`), `allergens` A–N, `recommended_item_ids` for "Goes well with" |
| `from('menu_item_option_groups').select('item_id, group_id, sort, option_groups(id, name_de, name_en, min_select, max_select, required, options(id, name_de, name_en, price_cents, sort))')` | option groups per item with active options | rules: any = (0,null), exactly one = (1,1,required), 0–3 = (0,3); `price_cents = 0` → show "free" |
| `from('delivery_zones').select('code, name, areas, min_order_cents, fee_cents, free_delivery_over_cents, promised_minutes, postal_codes')` | active zones | for the address step / "free delivery over 35 €" hint; the authoritative resolution is inside `quote_order` |
| `from('settings').select('key, value').in('key', ['business','opening_hours','site','payments.enabled','kitchen.status'])` | public settings | `business` (name, address, phone, email, impressum, ust_id) · `opening_hours` (`{mon..sun: [["11:00","23:00"]], holidays: []}`) · `site` (seo, cookie_banner, robots, maintenance) · `payments.enabled` (`{methods: payment_method[], tip_presets_cents: int[], capture}`) · `kitchen.status` (`{paused: bool, since}` → "sold out today") |

Anything else (`orders`, `customers`, `staff`, `promo_codes`, private settings) returns **no rows** for anon by design.

### 5.2 `rpc('quote_order', { payload })` — pure, call on every cart change
```ts
payload: {
  type: 'delivery' | 'pickup',
  items: [{ item_id: uuid, qty: number, option_ids?: uuid[] }],
  postal_code?: string,          // delivery: resolves the zone
  promo_code?: string,           // case-insensitive
  scheduled_for?: string | null, // ISO; null/absent = ASAP
  tip_cents?: number,
  contact?: { phone?: string },  // optional; lets first_order promos be checked early
}
→ {
  ok: boolean, type, scheduled_for,
  lines: [{ item_id, sku, category_id, name, name_de, name_en, name_ja, qty, unit_price_cents,
            options: [{ group_id, group, group_de, option_id, option, option_de, price_cents }],
            options_cents, line_total_cents, prep_minutes, allergens }],
  subtotal_cents, pickup_discount_cents, promo_discount_cents, discount_cents,
  delivery_fee_cents, tip_cents, total_cents, vat_cents,
  zone: { id, code, name, min_order_cents, fee_cents, free_delivery_over_cents, promised_minutes } | null,
  promised_minutes: number | null,
  promo: { code, kind: 'percent'|'fixed', value, discount_cents, scope } | null,
  problems: [{ code, item_id?, option_id?, group_id?, reason?, ... }]
}
```
Problem codes: `unavailable` (item; `reason` = `schedule` | `max_per_order` | `stock` when relevant) · `invalid_options` (option not offered for the item / inactive, or group `min`/`max`/`selected` violated) · `below_min_order` (`min_order_cents`, `subtotal_cents`) · `out_of_zone` (`postal_code` or `reason: postal_code_missing`) · `closed` (`reason` = `kitchen_paused` | `outside_hours` | `slot_too_soon` | `slot_too_far` | `slot_outside_hours`) · `promo_invalid` (`reason` = `unknown` | `expired` | `not_yet_valid` | `limit_reached` | `min_order` | `wrong_day` | `too_late` | `category_not_in_cart` | `not_first_order`) · `empty_cart` · `invalid_input` (`field`). A quote with problems still returns lines/totals for display; `place_order` will refuse it. `closed` with `outside_hours` = show "pre-orders only" and let the guest pick a slot.

### 5.3 `rpc('place_order', { payload })` — checkout submit
```ts
payload: quote payload + {
  contact: { name: string, phone: string, email?: string },   // phone: any German format, stored E.164
  address?: { street, floor_apt?, postal_code, city? },        // required for delivery; postal_code drives the zone
  courier_comment?: string,
  comment_flags?: ('leave_at_door' | 'dont_ring' | 'call_on_arrival' | 'no_wasabi')[],
  payment_method: 'card' | 'apple_pay' | 'google_pay' | 'paypal' | 'bitcoin' | 'cash',
  payment_status?: 'pending' | 'authorized',   // v1: what the payment step reported; default 'pending'
  payment_ref?: string,                        // e.g. "Visa ···4417"
  tip_cents?: number,
}
→ { order_id: uuid, number: number, total_cents: number, tracking_token: string, status: 'new' | 'accepted' }
```
Failure: PostgREST error with `message = 'order_rejected'` and `details` = JSON string of the same `problems[]` as the quote (parse it). Nothing is written in that case. On success the customer is upserted by phone, the order is `new` (or `accepted` when auto-accept applied: authorized/paid, ASAP, total < 50 €, kitchen not paused). Store `tracking_token` in local storage and route to the tracking page with it.

### 5.4 `rpc('get_order_by_token', { token })` — tracking page (poll every ~15 s; realtime for guests = S2-02)
```ts
→ null | {
  order_id, number, status, type, payment_status, payment_method,
  scheduled_for, promised_minutes, eta,            // eta: ISO or null when finished/cancelled
  created_at, accepted_at, preparing_at, ready_at, out_at, completed_at, cancelled_at,
  contact_name, address, courier_comment, comment_flags,
  items: [{ name, qty, unit_price_cents, options, line_total_cents }],
  subtotal_cents, discount_cents, delivery_fee_cents, tip_cents, total_cents, vat_cents, promo_code,
  events: [{ at, type }]                             // created, accepted, preparing, ready, handed_to_driver, delivered / picked_up, cancelled, refunded
}
```
No phone, no staff ids, no internal notes are returned.

### 5.5 Not for the web
`set_order_status`, `kitchen_pause` require a staff session (S4). Storage bucket for `photos` is not created in S2-01 — S3 renders `photos[]` paths against a public bucket `menu` once S4-01/S2-02 creates it; until then use placeholder art.
## 6. Backoffice → Supabase (S4) — written by S0 after S2-01

Client: `@supabase/supabase-js` with the anon key + a **staff auth session** (Supabase Auth email/password; seed logins in `apps/backend/README.md`). Role comes from `staff.role` via `auth_role()`; the UI reads its own `staff` row for "who am I". Types from `apps/backend/types/database.ts`.

### 6.1 Orders board (Bestellungen) — operator / owner
- Initial load: `from('orders').select('*, order_items(*), order_events(*)')` filtered by day (`created_at >= today`) or `status in (...)`; pre-orders = `scheduled_for is not null and status in ('new','accepted')`.
- Live: `channel('orders').on('postgres_changes', {schema:'public', table:'orders'|'order_items'|'order_events'})` — the publication exists. Re-fetch the row on every event; do not diff locally.
- Actions → `rpc('set_order_status', {order_id, new_status, payload})`. Transitions: `new→accepted|cancelled`, `accepted→preparing|cancelled`, `preparing→ready|cancelled`, `ready→out_for_delivery|picked_up|cancelled`, `out_for_delivery→delivered|cancelled`, completed+paid → `refunded` (owner/operator). Payload: `{driver_id}` for out_for_delivery, `{reason}` for cancelled, `{note}` free text, `{cash_received: true}` for cash on delivered (v1 ignores). Returns the updated row.
- Pause intake: `rpc('kitchen_pause', {paused: bool})`. Rush toggle / prep time: `from('settings').update({value})` on keys `kitchen` / `ops` (owner) — operator reads only in v1; S0 may relax in S4-01.
- Phone order: `rpc('place_order', {...payload, channel: 'phone'})` from a staff session.
- Kitchen board (role `kitchen`): same reads, only `preparing` / `ready` actions.
- Driver view (role `driver`): `from('orders')` returns own deliveries only; action `delivered`.

### 6.2 Order detail (Detail) — `orders` + `order_items` + `order_events` + `customers` (by `customer_id`). Editing positions = S2-02 (`update_order_items`); until then read-only positions. Refund/cancel via `set_order_status`.

### 6.3 History (Historie) — `from('orders')` with range/status/payment/type/driver filters + `order_items(count)`; export = client-side CSV/XLSX from the same query.

### 6.4 Customers (Kunden / Profil) — `from('customers').select('*, customer_addresses(*)')` + view `customer_stats` (orders_count, spent_cents, avg_cents, last_order_at, days_silent) for segments and sorting. Tags / kitchen_note / consents: direct `update` (operator, owner). Timeline (`customer_events`) = S2-02; v1 shows the customer's orders only.

### 6.5 Menu (Speisekarte / Artikel) — direct CRUD on `menu_categories`, `menu_items`, `option_groups`, `options`, `menu_item_option_groups` (operator, owner). Stoplist = `menu_items.stoplist_until = today`. Photos: bucket `menu` does not exist yet (S2-02) — upload UI disabled until then.

### 6.6 Settings (Einstellungen) — `settings` rows by key (owner write). Team = `staff` rows (owner write); inviting a user = Supabase Auth admin — S4-01 documents the manual path, automation later.

### 6.7 Not in v1 (needs S2-02 / later boots): campaigns, automations, banners/site publish, reports views, devices, payment provider settings.
## 7. Automation / FastAPI webhooks (S5) — later
