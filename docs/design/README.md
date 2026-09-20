# DESIGN — source of truth for UI

- `brandbook.pdf` — brand guidelines 2026 (logo, palette, type, element kit, motion). Binding for S3 and S4.
- `shosho-site.dc.html` — Claude Design canvas with every screen. Open locally: `python3 -m http.server 8765` in this folder → `http://127.0.0.1:8765/shosho-site.dc.html`. Top nav switches screens.
- `uploads/` — photos and sketches referenced by the canvas.

## Brand tokens (from brandbook)
| Token | Hex | Use |
|---|---|---|
| Shoyu Cream | `#FBF7F2` | 70 % of surface, page background |
| Nori Ink | `#16192B` | 20 %, text, inverted plates |
| Arita Blue | `#2E86D6` | 8 %, secondary |
| Tobiko Orange | `#F26B21` | 2 %, accent dot, CTA |
| Sky Wash | `#8FC4EE` | stones, grids |
| Sakura Blush | `#F6CFD8` | soft stones |
| Warm Sand | `#FDEEE2` | cards, price |

Type: **Archivo** (Latin) — 800 names/prices, 500 descriptors wide-tracked, 400 body; no weights between 500 and 800. **Zen Kaku Gothic New** (Japanese) — kana headlines ≥ 2× the Latin subhead. Pill = the only CTA shape. Motion: micro 120–200 ms, screen 320 ms, `cubic-bezier(.22,1,.36,1)` in / `(.4,0,1,1)` out, no springs. Logo animation 1.3 s, 4 keyframes. Palette is closed — no fifth colour.

## Screen inventory
### Guest site (`apps/web`, S3) — EN primary, DE legal footer
| Screen | What it contains |
|---|---|
| Home | header (Menu/Sets/About/Contacts, search, DELIVERY/PICKUP toggle, address), hero banner, category rail (10 categories with kana), "Popular right now" grid (sort/filter, badges BESTSELLER/NEW/−15%), sticky cart (qty ±, promo code, free-delivery progress, subtotal/discount/delivery/total, payment marks), DE legal footer (Impressum, AGB, Datenschutz, Widerruf, hours) |
| Product | breadcrumb, rating + orders/month, kana title, description, SIZE (8/16/24 pcs), BUILD YOUR ORDER options (+price / free), qty, Add, trust chips (ready in 20 min, free delivery > 35 €, 4 °C), "Goes well with" upsell, cart |
| Checkout | 3 steps CART → DELIVERY → PAYMENT; Delivery (60 min, free > 35 €) vs Pickup (ready 25 min, −10 %); address, floor/apt, courier comment + quick chips (leave at door, don't ring, call, no wasabi); WHEN asap / time slots / pick a time (pre-order); contact name + phone, **guest checkout, no account**; payment: card, Apple Pay, Google Pay, PayPal, Bitcoin, cash on delivery; summary; "Payment is captured on delivery confirmation" |
| About | story / how we work |
| Mobile | mobile layout of the above |

### Back-office (`apps/backoffice`, S4) — DE primary, EN toggle
| Screen | What it contains |
|---|---|
| Bestellungen (orders board) | kitchen load %, avg prep; online/pause toggle, prep time 22 min + rush +15; sound, phone-order button; KPIs (orders, revenue, avg delivery, cancelled); search + filters (all/delivery/pickup/paid/open/pre-order); columns: **In Arbeit** (NEU → accept/decline; ANGENOMMEN → start; IN ZUBEREITUNG → ready, overdue timer; FERTIG → hand to driver / handed out), **Unterwegs** (driver, ETA, stops, delivered), **Erledigt heute**, **Vorbestellungen**. Cards show allergy warning, payment status/method, zone, distance |
| Detail | one order: allergy banner, customer (n-th order, CRM link), delivery block (zone, ETA, comment, driver), positions (operator-editable, change log), totals incl. tip and 7 % VAT, payment ref, **timeline (Verlauf)**, actions: ready / refund / cancel, print, duplicate |
| Historie | table with filters (date range, status, payment, type, driver, amount), CSV/XLSX export, sum row |
| Kunden (CRM list) | segments (Stammkunden 3+, new this month, sleeping 60+ days, companies), sort, tags VIP/ALLERGIE/KATERING/PROBLEM, bulk: push / tag / voucher / export; columns orders, spend, avg, last |
| Profil (customer) | contacts, 2 addresses, kitchen note (allergy — shown on order card), **GDPR consents** (email / push / phone with date+source), export/delete data, stats, top items, timeline (orders, complaints, compensation, staff notes, push opened) |
| Kampagne (wizard) | recipients (segment, consent count), channel push/email/both, DE/EN message, deep-link target, timing (now/scheduled/best), preview, test send, last campaign stats |
| Speisekarte (menu) | categories drag-sort with kana + schedule (lunch Mo–Fr till 15:00), items table (price, cost, sold, available toggle, stoplist, incomplete flags), bulk actions, **option groups** (shared vs item-only; rules: any / exactly one / 0–3) |
| Artikel (item editor) | name DE/EN + kana + transliteration, description DE/EN, category, price, SKU, photos, availability / stoplist till midnight / stock / max per order, tags (new/hit/spicy/veg), kitchen (prep min, station, note), legal (allergens A–N, weight, kcal/100 g, VAT 7 % delivery / 19 % on-site), option groups, recommended items, preview, margin |
| Website (CMS) | unpublished-changes counter + publish; banners with slot + date range; business data; opening hours; **delivery zones (A/B/C: areas, min order, fee, promised minutes)**; SEO; cookie banner, robots, maintenance mode; publication history |
| Marketing | KPIs; promo codes table (percent / fixed, applies to, used/limit, validity); campaigns list with stats; automations (welcome, win-back 45 d, birthday, review after delivery); discount-rate chart |
| Berichte | period picker, KPIs, revenue by day (delivery/pickup/upsell), top items, funnel (menu→cart, cart→paid, upsell), XLSX |
| Einstellungen | team & roles (Inhaber, Operator, Küche, Fahrer), notifications (sound, auto-print 2 copies, overdue warning, daily report), payments (Stripe, Apple/Google Pay, PayPal, cash, Bitcoin, tip presets, payout), operations (prep 22 min, rush +15, pre-order 7 days, auto-accept paid < 50 €, allow pause), legal (Impressum, USt-IdNr, GoBD 10 y, TSE/KassenSichV, privacy: anonymise after 24 months), language, timezone, devices (tablets, printer), danger zone |
| Zustände | every empty / error state with copy and next action — reference for S3/S4/S6 |

## Product rules extracted (binding unless S0 changes them)
- Guest checkout, no account. Customer profile is created automatically from the first order (matched by phone).
- Delivery vs pickup; pickup −10 %; free delivery over 35 € (zone-dependent min order / fee / promised time).
- Pre-orders up to 7 days ahead; outside opening hours the site accepts pre-orders only.
- Order lifecycle: new → accepted → preparing → ready → out_for_delivery → delivered (delivery) / picked_up (pickup); cancelled / refunded at any point by operator. Every transition is a timeline event with actor.
- Payment captured on delivery confirmation (authorize at checkout). Cash on delivery requires driver confirmation.
- Auto-accept only paid orders under 50 € (setting). Operator can pause intake; site shows "sold out today".
- Stoplist resets at midnight. Category hidden on the site until it has an active item.
- Allergy note on customer profile propagates to every order card. Allergens A–N per item (German scheme).
- VAT 7 % delivery / 19 % on-site per item. GoBD 10-year retention of invoice data; customer data anonymised after 24 months without orders.
- Marketing only to customers with a recorded consent (channel, date, source); max one automated action per customer per week.
- Order number is a short sequential integer (#2418), shown everywhere.
