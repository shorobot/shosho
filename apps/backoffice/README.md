# SHOSHO — back-office (`apps/backoffice`)

Owner: **S4 Back-office**. The operator-facing app the kitchen runs on: staff sign-in, the live orders
board (Bestellungen), order detail with the timeline, history with CSV export, the role-specific
kitchen and driver screens, and the menu editor (Speisekarte, Artikel, Optionsgruppen) with photo
upload. Contract: [`/docs/api-contracts.md`](../../docs/api-contracts.md) §6.
Design: [`/docs/design/`](../../docs/design) (screens **BO · Bestellungen / Detail / Historie /
Speisekarte / Artikel / Zustände**). UI language: **German primary, EN toggle** in the nav rail.

```
apps/backoffice/
├── app/                    App Router: /login, /no-access, (shell)/{orders,orders/[id],orders/history,menu,menu/item/[id],menu/item/new,menu/options,kitchen,driver} + nav placeholders
├── components/             shell (nav, login), orders (board, card, dialogs), detail, history, kitchen, driver, menu (categories, table, bulk, editor, photos, options), ui (pill, badge, modal, states)
├── lib/                    supabase clients (@supabase/ssr), store (realtime orders), menuStore (menu load + write guard), orders / menu (pure logic), image (client photo pipeline), i18n, time, money, csv, sound
├── middleware.ts           refreshes the auth cookies, redirects anonymous requests to /login
├── tests/                  vitest — grouping, filters, timers, transition → button mapping
├── e2e/                    playwright smoke (needs a real backend, see below)
└── Dockerfile              standalone image for staging (96 MB budget)
```

## Run locally

```bash
pnpm install                              # repo root
cp apps/backoffice/.env.example apps/backoffice/.env.local
# fill NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — either the staging project
# (URL + anon key are public values; ask S0/S1 or read them from the deployed site's env script)
# or a local stack: cd apps/backend && pnpm db:start && pnpm exec supabase status
pnpm --filter @shosho/backoffice dev      # http://localhost:3001
```

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test` (vitest), `test:e2e` (playwright).
The `node (backoffice)` CI job runs `lint`, `typecheck`, `test`.

Only the **anon key** is used, plus a staff auth session — RLS does the guarding (§4). The
service-role key must never reach this app.

## Test logins

The four seed accounts from [`apps/backend/README.md`](../backend/README.md) → *Test logins*
(`owner@` / `operator@` / `kitchen@` / `driver@shosho.test`, shared password there). They exist in
both the local stack and `shosho-staging`.

| Role | Lands on | May do |
|---|---|---|
| `owner` (Inhaber) | `/orders` | everything; the only role that may flip **Stoßzeit** (`settings.kitchen.rush`) |
| `operator` | `/orders` | board, detail, history, phone orders, pause/resume intake, all transitions |
| `kitchen` (Küche) | `/kitchen` | `Zubereitung starten` / `Fertig` only (enforced by `set_order_status`) |
| `driver` (Fahrer) | `/driver` | `Zugestellt` on own deliveries only |

A signed-in user without an active `staff` row lands on `/no-access`. Inviting a new member is a
Supabase Auth admin action (§6.6): create the user in **Supabase → Authentication → Users**, then
insert the matching `public.staff` row (`id` = the auth user's id, `name`, `role`, `active = true`).
Automation is a later boot.

## Routes

| Route | Roles | What it is |
|---|---|---|
| `/login` | — | email + password (Supabase Auth), session in cookies |
| `/orders` | owner, operator | the Bestellungen board: online/pause, prep time, rush, sound, phone order, KPIs, search + filter chips, columns **In Arbeit / Unterwegs / Erledigt heute / Vorbestellungen** |
| `/orders/[id]` | owner, operator | detail: allergy banner, customer (n-th order via `customer_stats`), delivery block, positions (read-only in v1), totals incl. tip + VAT, **Verlauf** from `order_events`, actions, print |
| `/orders/history` | owner, operator | Historie: 14-day default range, status / payment / type / driver filters, amount sort, sum row, CSV export |
| `/kitchen` | kitchen (owner/operator may look) | ANGENOMMEN / IN ZUBEREITUNG / FERTIG with big touch targets |
| `/driver` | driver (owner/operator may look) | own deliveries, maps link, tap-to-call, cash to collect, Zugestellt — mobile-first (375 px) |
| `/menu` | owner, operator | Speisekarte: categories (kana, counts, drag-sort, `schedule`, activate), items table (thumb, price, cost, margin, availability, stoplist, completeness flags), filters + search, bulk actions, shared option groups |
| `/menu/item/[id]`, `/menu/item/new` | owner, operator | Artikel editor: Basis, Fotos, Verkauf, Küche, Recht, Optionen, Empfohlen dazu, live card/detail preview, margin panel, unsaved guard, Duplizieren |
| `/menu/options` | owner, operator | shared option groups with usage counts; saving one warns how many items it changes |
| `/customers`, `/website`, `/marketing`, `/reports`, `/settings` | owner, operator | "coming soon" placeholders (S4-03+) |

## How the data flows

- **Reads**: `from('orders').select('*, order_items(*), order_events(*)')` scoped per role (§6.1) —
  operator/owner get today's orders + everything still active + everything finished today + pending
  pre-orders; kitchen gets `accepted|preparing|ready`; driver gets `ready|out_for_delivery` (RLS
  narrows that to their own).
- **Realtime**: one channel per tab on `orders`, `order_items`, `order_events`; every event
  re-fetches that order row (never a local diff), plus a 60 s safety reload and a reload when the tab
  becomes visible. A dropped channel renders the design's *Verbindung unterbrochen* state with
  **Neu verbinden**.
- **Writes**: only `rpc('set_order_status')`, `rpc('kitchen_pause')`, `rpc('place_order')` (phone
  orders, `channel: 'phone'`) and — for the owner — `settings.kitchen.rush`. The UI applies the new
  status optimistically and reconciles with the row the RPC returns; `forbidden_for_role`,
  `illegal_transition` and `driver_required` are surfaced as toasts and the card is re-fetched.
- **Sound**: a synthesised chime (no asset) on a new order, per role — new for operators, newly
  accepted for the kitchen, newly assigned for drivers. Stored in `localStorage`, off by default;
  browsers need the toggle click before audio may play.

## The menu editor (S4-02)

**Roles.** Every `/menu*` route is `owner` / `operator` only — `kitchen` and `driver` are redirected
to their own screen by the route's `requireRole`, and the nav never offers the link. Inside the
screens, `canWrite` additionally hides every control that writes, so a role that reached a page some
other way sees a read-only catalogue. RLS is the real guard (§4, `menu_*` staff-write policies): a
denial comes back as a toast reading *„Nicht erlaubt: Änderungen an der Speisekarte sind dem Inhaber
und dem Operator vorbehalten."* rather than a raw Postgres error. The service-role key is not used.

**Reads.** One load per visit through `<MenuProvider>` (`lib/menuStore.tsx`): `menu_categories`,
`menu_items`, `option_groups(*, options(*))` and `menu_item_option_groups`, plus the derived item
count per category and linked-item count per group. No realtime — the menu is not a live surface.

**Writes** are direct CRUD (§6.5) and go through `run()`, which turns any failure into one sentence.

**Bulk actions** (price ±%, move category, hide/show, stoplist, duplicate) are each **one confirmed
request** — a single `upsert` (or `insert`) carrying the whole selection, never a loop of per-row
writes. Every action keeps the rows it replaced, so **Rückgängig** is one `upsert` of the snapshot
(or one `delete` of the created ids for a duplicate). Note that ±% is deliberately *not* undone by
re-applying the inverse percentage: +10 % then −10 % does not land on the original cent.

**Stoplist** is `stoplist_until = today` (§6.5) and resets itself at midnight — nothing to schedule.
An item with today's date is hidden from the site, and a category whose last active item is stopped
disappears from the site with it, which is the rule the design states.

### Photo pipeline (§6.8)

```
file → type/size gate → decode → optional focal crop → downscale ≤1600 px → re-encode ≤~1 MB
     → storage.from('menu').upload('<item_id>/<n>.<ext>')
     → menu_items.photos = [... 'menu/<item_id>/<n>.<ext>']       (bucket-qualified, §1.2)
```

- Accepted: `image/jpeg | png | webp | avif`. Anything else is refused by name, and a file over the
  bucket's 5 MB is refused by size — but the client compresses so far below that limit that it is a
  backstop, not a constraint (the walkthrough's 119 KB JPEG left as an 82 KB WEBP).
- PNG stays PNG (flat art, transparency); everything else is re-encoded to WEBP where the browser
  can write it, JPEG otherwise. Quality steps down 0.82 → 0.5 until the blob fits.
- `<n>` is always `max(existing) + 1`, so replacing a photo writes a **new** object and can never be
  served from a stale cache. The replaced object is deleted in the same step.
- Deleting a photo (or an item) removes the object too — the bucket does not cascade (§6.8).
- Photos write through **immediately**, not on the form's Save: by then the object is already in the
  bucket, and deferring the row update would only create orphans.
- **Crops.** The design asks for separate card and detail crops. `menu_items.photos` is an array of
  path *strings*, which cannot carry a second crop or a focal point, and the schema is S2's. So this
  boot ships a **focal-point picker**: the operator clicks the point that matters, sees live card
  (4:3) and detail (4:5) previews, and the choice is baked into the uploaded pixels. Two genuinely
  separate crops need a contract change — filed in
  [`/memory/boots/proposed/S4-contract-request.md`](../../memory/boots/proposed/S4-contract-request.md).

### Option groups

Shared groups (`shared = true`) are listed on `/menu` and `/menu/options` with the number of items
linked to them; saving one shows the design's warning naming that number before it writes. Item-only
groups are created and edited inside the Artikel editor and are never listed as shared.

### What is deliberately missing

- **`VERKAUFT` / sold per item.** There is no reports view yet (S2-03 owns it). The column is left
  out rather than filled with a number the operator would trust.
- **`Importieren`** on the Speisekarte header — no import format is specified anywhere yet.

## End-to-end smoke

`e2e/smoke.spec.ts` signs in with the seed logins and checks the board, the DE/EN toggle, role
routing, the `/login` redirect and — since S4-02 — the Speisekarte and its filters, every section of
the Artikel editor plus its unsaved-changes guard, the shared-option-group warning, and that
`kitchen` is bounced off `/menu`. It needs a real backend, so it is **not** part of the CI job:

```bash
cd apps/backend && pnpm db:start          # or point .env.local at shosho-staging
cd ../backoffice && pnpm exec playwright install chromium
pnpm --filter @shosho/backoffice test:e2e
```

Playwright cannot install its browsers on macOS 12 (`chromium on mac12` is unsupported — re-checked
2026-09-27 during S4-02, `pnpm exec playwright install chromium` still refuses), so on that host run
it in CI instead — the temporary `S4 verify` workflow on the `s4-01` branch did exactly that against
a local Supabase stack. S4-02 was verified by hand against `shosho-staging` instead; the walkthrough
is written up in [`/memory/log.md`](../../memory/log.md).

## Staging

The image is built and pushed by `Deploy staging` as `ghcr.io/shorobot/shosho-backoffice:staging` and
runs as the `backoffice` service of `apps/infra/docker-compose.staging.yml` on **`127.0.0.1:8202`**
(`mem_limit` 96m, co-tenant terms in [`/memory/infra-access.md`](../../memory/infra-access.md)).

**There is no public URL yet** — the host/subpath for the back-office is S1's call
(proposal: `/memory/boots/proposed/S1-04-backoffice-host.md`). Until then reach it over an ssh
port-forward:

```bash
ssh -N -L 8202:127.0.0.1:8202 -i ~/.ssh/shos_ed25519 shos@<STAGING_SSH_HOST>
# then open http://127.0.0.1:8202/login
```

Because the back-office is loopback-only, the browser talks to Supabase directly from the operator's
machine — the forwarded port only serves the app itself.

## Design notes

- Brand tokens (7 colours, Archivo + Zen Kaku Gothic New, motion) are copied into `app/globals.css`
  as CSS variables — D-010: the two apps share tokens, not components. No fifth colour: the order
  states reuse the canvas's alert/amber/green accents defined there.
- The pill is the only CTA shape; cards carry a 5 px status edge and escalate to the alert colour
  when an order is overdue or has been waiting too long.
- Empty and error states come from **BO · Zustände**: no orders today, intake paused, no matches, no
  data in the period, connection lost, payment failed. *Item sold out during checkout* and
  *address out of zone* are not rendered in v1 — there is no signal for them yet (see the contract
  request below).

## Known gaps (v1)

- **The storefront does not render uploaded photos yet.** `apps/web/components/ui/Photo.tsx`
  treats `photos[0]` as an image only when it is an absolute URL, but the contract stores
  bucket-qualified paths (`menu/<item_id>/<n>.webp`, §1.2/§6.8), so every card falls back to the
  placeholder. Verified on staging 2026-09-27. The fix is one `getPublicUrl` call in `apps/web`,
  which this session may not touch — filed for S3 in
  [`/memory/boots/proposed/S4-contract-request.md`](../../memory/boots/proposed/S4-contract-request.md).
- Menu changes reach the storefront after up to **60 s** — `apps/web` caches its Supabase reads with
  `next: { revalidate: 60 }`. Expected, not a bug; worth knowing before someone reports it as one.
- Categories can be created, renamed and deactivated, not deleted — deletion needs a rule for the
  items inside them, which no screen specifies.
- Positions are read-only. `rpc('update_order_items')` landed with S2-02 while S4-01 was open (§6.2/§6.8) — wiring the editor is a later boot.
- Kitchen load is a placeholder (`accepted + preparing` against a nominal capacity of 8) — there is
  no capacity model yet.
- "Info" (notify the customer) on an out-for-delivery order is not wired — no messaging channel yet.
- The CRM link on the detail screen is a placeholder until S4-03.
- XLSX export is a later boot; CSV is client-side.
- Gaps found in §6 are written up in `/memory/boots/proposed/S4-contract-request.md`.
