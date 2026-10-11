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

The four seed accounts (`owner@` / `operator@` / `kitchen@` / `driver@shosho.test`) exist in both the
local stack and `shosho-staging`. **How you get a password changed in S2-05** — the seed no longer
sets a known one, so a fresh or reset project is never born with a credential that is in this public
repo:

- **Locally**, after `supabase db reset`, run `pnpm --filter @shosho/backend seed:local-logins` once
  (or just `pnpm test`, which runs it). It sets a documented local-only password on all four accounts
  and refuses to run against anything but a loopback Supabase URL, so run it freely. The value is in
  [`apps/backend/README.md`](../backend/README.md) → *Test logins*.
- **On `shosho-staging`**, the old shared password is still live — the seed's `on conflict do nothing`
  could not touch rows that already existed — and should be treated as a known-compromised credential
  that happens to still work. Once the owner runs `apps/backend/scripts/rotate-staging-passwords.mjs`
  the new values exist only in a gitignored file on their machine: **ask the owner**, there is no
  script either app can run to retrieve them. A staging login that suddenly fails is almost certainly
  this, not a bug to debug.

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
| `/customers` | owner, operator | Kunden: search from the first character (name / phone / e-mail / address), four segment tiles with live counts, sort on every stat column, tag filter, multi-select → bulk tag (one upsert + Rückgängig) and CSV export |
| `/customers/[id]` | owner, operator | Profil: contacts, both addresses, kitchen note, GDPR consents with date + source, stats, most-ordered items, merged `customer_events` timeline, note / complaint / compensation, data export, erasure request |
| `/website` | owner, operator | Website (CMS): banners with slot + window, business data, opening hours, delivery zones, SEO / cookie banner / robots / maintenance, the unpublished-changes counter, `publish_site()` and the publication history. **Settings fields are owner-write; banners and zones are owner/operator; publishing is owner-only** |
| `/marketing` | owner, operator | Marketing: KPIs, promo codes, campaigns list, automations, discount-rate chart |
| `/marketing/campaign/[id]` | owner, operator | the Kampagne wizard (`new` or a campaign id): segment → recipients from `resolve_segment` → channel → DE/EN message → timing → review. Drafting and scheduling work; **"Senden" is disabled** (see below) |
| `/reports`, `/settings` | owner, operator | "coming soon" placeholders (S4-05) |

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

## Security headers, CSP and the session cookie (S4-03)

`middleware.ts` sets this app's own headers on every response — the app no longer inherits whatever
Cloudflare happens to add (S7-01 finding 5). The policy and the reasoning live in
[`lib/csp.ts`](lib/csp.ts); read that file before changing any of it. The short version:

- **CSP is nonce-based and enforcing**, including `frame-ancestors 'none'` — the back-office must
  never be iframe-able. This depends on `app/layout.tsx` being `dynamic = "force-dynamic"`, which it
  already is for an independent reason (the image is built without Supabase values, so `publicEnv()`
  has to be read per request). **Do not make a route under `app/` static or ISR**: its cached HTML
  would carry a stale nonce and every script on the page would be blocked with no useful error.
- **HSTS, `upgrade-insecure-requests` and the `Secure` cookie flag are skipped on loopback.** Over the
  ssh tunnel the browser sees `http://localhost:8202`; HSTS with `includeSubDomains` there would pin
  *every* localhost port to https in that browser profile, and a `Secure` cookie would never come
  back, so sign-in would loop with no error. The decision is `isSecureContext()`, which reads the
  forwarded headers and fails closed. It deliberately does **not** use `request.nextUrl.hostname` —
  on Next 15.5.25 that is `"localhost"` for every request regardless of `Host`, which would mark
  production as loopback and silently drop both protections there.
- **Expect HSTS twice on `bo-shos.hellfiresol.com`.** TETA+PI's nginx sends its own
  (`max-age=86400`) in front of this app. Per RFC 6797 a user agent processes only the first, so it is
  a duplicate-header smell rather than a bug, and the host is S1's boundary (D-004) — not ours to fix.
- **The session cookie is not `HttpOnly`, on purpose.** `@supabase/ssr`'s browser client stores the
  session in `document.cookie`, and this app reads its data from client components through that
  client, so the token has to stay readable from JavaScript. A server-written `HttpOnly` cookie would
  be invisible to it at the first token refresh and every RLS-filtered query would quietly return
  empty. Full reasoning in [`lib/supabase/cookies.ts`](lib/supabase/cookies.ts); the finding is filed
  back to S7 in `/memory/boots/proposed/S7-S4-03-httponly-correction.md`.

The post-login `?next=` redirect is validated in [`lib/safeRedirect.ts`](lib/safeRedirect.ts) —
same-origin relative paths only. `tests/security.test.ts` covers each bypass (`//evil.example`,
`/\evil.example`, scheme payloads, tab/newline forms a browser strips before parsing).

### Checking the headers yourself

```bash
# over the tunnel: no HSTS, no upgrade-insecure-requests (both correct on loopback)
curl -sI http://127.0.0.1:8202/login | grep -iE 'content-security-policy|x-frame|referrer|permissions|strict-transport'

# how the real host is treated (the forwarded headers are what decide)
curl -sI -H 'X-Forwarded-Proto: https' http://127.0.0.1:8202/login | grep -i strict-transport
```

## Kunden / Profil (S4-03)

Pure logic lives in [`lib/crm.ts`](lib/crm.ts) and is unit-tested in `tests/crm.test.ts`; the data
layer is [`lib/crmStore.tsx`](lib/crmStore.tsx) (one load for the list, a per-profile loader with a
realtime subscription for the timeline).

- **Segments** come off `customer_stats`, which counts **completed orders only** (`delivered` +
  `picked_up`, §6.9 row 8): Stammkunden `orders_count >= 3`, schlafend `days_silent >= 60`, Firmen
  `is_company`. "Neu diesen Monat" is keyed on `customers.created_at` in Europe/Berlin, because the
  view exposes no first-order timestamp and a profile is created by `place_order` when the phone
  number is new — so the two coincide in practice. Stated because it is an assumption, not something
  the schema enforces.
- **`days_silent`** mirrors the view's SQL (`extract(day from now() - last_order_at)`), i.e. whole
  *elapsed* days, not a calendar-date difference. 47 hours ago is 1, not 2. Getting that wrong would
  move customers in and out of "schlafend" by time of day and disagree with the DB for the same row.
- **The timeline is a union, not a concatenation.** A trigger already writes one `order` event per
  order, so appending the orders as a second stream would show every one of them twice. `mergeTimeline`
  keys on order id, enriches each `order` event with the live order row (the event payload is written
  `after insert`, when the status is always `new`, but the design shows the current status), and
  synthesises an entry for any order with no event of its own.
- **Writes go through the RPC.** `customer_events` has a staff *read* policy and no write policy for
  anyone — a direct insert is refused with `42501` even for the owner. Use
  `rpc('add_customer_event', …)`; `payload.text` is required for a note and a complaint.
- **Consents are written through**, never patched locally, so the `customers_consent_changed` trigger
  records who changed which channel and from what source.
- **Unavailable actions are disabled with a reason.** "Push senden" / "Nachricht" have no messaging
  channel — per **D-016** customer messaging arrives with customer accounts (the notification bell
  first, then push), not with S5 — and "Gutschein senden" has no voucher issuing until S2-06. Both
  render disabled with a tooltip naming what is missing rather than as buttons that do nothing.
- **Erasure is a request, not an act.** There is no server-side single-customer erasure — only the
  nightly 24-month job (§6.8). "Daten löschen" files an auditable `note`
  (`payload.kind = 'erasure_request'`) on the customer's own timeline for an operator to action by
  hand, and the profile shows it as pending. GDPR Art. 17 starts a clock on the *date of the request*,
  so losing that date is the one outcome worth avoiding; a disabled button records nothing.
- **Completed orders may legitimately show as unpaid.** Since S2-04 a non-cash order with no payment
  provider reaches `delivered`/`picked_up` with `payment_status` untouched. Until the owner's Stripe
  keys exist that is correct — the profile says so in a note rather than hiding or coercing it.

## Website (CMS) — the draft/publish model (S4-04)

**Read this before changing anything on `/website`.** The screen's whole job is that nothing reaches
the storefront by accident, and the mechanism is easy to break invisibly.

### What is staged and what is not

| Edited here | Column | On save | Live when |
|---|---|---|---|
| business data, opening hours, SEO / switches | `settings.draft` | **full replacement** of what `value` would become | `publish_site()` |
| banners | `banners.draft` | **partial patch** of the changed columns only | `publish_site()` |
| delivery zones | — | written straight to `delivery_zones` | **immediately** |
| deleting a banner | — | row delete | **immediately** |

Zones are the one that surprises people: §8.7 added `draft` to `settings` and `banners` only, so
`delivery_zones` has no staging column at all. The panel and its dialog both say so rather than
letting an operator assume a zone edit is waiting for a publish. (The S4-04 boot described zones as
going "through `settings` keys, all into `draft`" — they do not; that is in the contract request.)

### The counter

`pendingChanges()` (lib/site.ts) counts rows with a non-null `draft` — the exact predicate
`publish_site()` uses to decide what to copy. They cannot drift, because neither is an estimate.
Saving a value identical to the live one writes `draft = null`, so an edit-and-undo does not leave a
phantom pending change.

### `anon` must never see a `draft`

The protection is a **column-level GRANT**, not RLS. `settings_public_read` already admits `anon` to
the `business` / `opening_hours` / `site` / `payments.enabled` / `kitchen.status` *rows*, and RLS is
row-level — it cannot hide one column inside a row it lets through. Migration 32 revokes `anon`'s
table grant on `settings` and re-grants exactly `(key, value, created_at, updated_at)`.

Do **not** add a view, an RPC or a `select *` that routes `draft` back to an anon-reachable surface.
Two tests hold this in place:

- `tests/site.test.ts` — the structural half, always runs: the column lists, and `leaksDraft()`
  refusing both `draft` and `*`.
- `tests/anonDraft.live.test.ts` — the behavioural half, against a real project with the anon key.
  It picks up `.env.local` automatically, and **skips with a printed reason** when there is no project
  (which is why `node (backoffice)` in CI runs the structural half only).

**Measured and worth knowing:** `anon` doing `select *` on `settings` gets `42501 permission denied
for table settings`, not a four-column row. Column privileges do not satisfy `SELECT *`, so the
revoke closed it twice over — but it also means **any anon consumer must name its columns**.
`apps/web/lib/api-supabase.ts` already does (`select("key, value")`), which is why the storefront is
unaffected; a future one that writes `select("*")` will get a confusing permission error. §8.7 reads
as though the four columns would come back, so this is in the contract request.

### Two traps the banner editor defends against

1. **A draft cannot clear a date.** `publish_site()` casts `(draft->>'valid_to')::timestamptz`; a
   JSON null means "keep the live value", and an empty string would raise *at publish time* and fail
   the whole publish — including every unrelated pending change. So `bannerDraftPatch()` refuses to
   stage such a clear, returns it in `clears`, and the editor offers an explicit immediate write with
   the reason. Text fields are different: a clear is staged as `""`, which publishes as an empty
   string and reads as absent.
2. **A replaced banner image keeps the old object.** The menu's photo editor deletes the replaced
   object at once, which is right there because the row is written at once. Here the live site still
   serves the old `image_path` until publish, so deleting it would break the storefront with an
   unpublished edit. The orphan is stated in the UI and listed under Known gaps.

A **new** banner is inserted with `active = false` and all of its content in `draft`: the row exists
(so an image can be uploaded under its id) but `banners_live` filters it out, and publishing merges
the content and flips `active`.

### Why a banner is or is not showing

The panel lists every banner with its state — **LIVE / GEPLANT / ABGELAUFEN / INAKTIV** and the
reason in words — and next to it exactly what `banners_live` returns right now. `banners_live` is
`active and in-window`, so a row present in the first list and absent from the second has its answer
in its own badge. The states come from the **live** columns, because that is what the view reads: a
staged `active: true` shows as a draft, not as live.

### Verifying a publish by hand

```bash
# 1. as owner, stage something and watch the counter move, then publish
# 2. the storefront's own credential must still see the OLD value while it is pending:
pnpm --filter @shosho/backoffice test   # tests/anonDraft.live.test.ts does exactly this
```
The full S4-04 staging walk-through (63 checks: stage → counter → anon-invisible → publish →
`site_publications` → storefront sees it → clean up) is recorded in `/memory/log.md`.

## Marketing (S4-04)

### The recipient count and the send are one call

Every recipient figure in the wizard comes from `rpc('resolve_segment', { p_segment, p_channel })`
with the campaign's **own** channel. §8.2 made `channel` a required argument so that "I forgot to say
which channel" is a syntax error rather than a silently too-broad answer, and so the count and a
future send resolve the same eligible set. Switching channel re-resolves; the per-channel figures on
the three channel cards are derived from the **same** returned rows, so comparing channels can never
show two numbers produced by two different queries.

Consent and `anonymised_at is null` are enforced *inside* the function, unconditionally. The screen
never re-implements a segment filter client-side.

**What the wizard therefore cannot show, and says so.** The design asks for "141 Empfänger · 118 mit
Einwilligung". `resolve_segment` applies consent first and never returns more rows, so the 141 does
not exist in any answer it can give — and re-deriving the segment in the browser would be the second
implementation §8.2 exists to prevent. The panel shows the reachable count, the push/email/both split
inside it, and an expandable note stating that the without-consent denominator is unavailable and
why, with the total customer-profile count as context (explicitly a different denominator). This is
the main item in the contract request.

### Nothing can send, and the screen says which piece is missing

"Senden" is **disabled on every channel**, with a tooltip naming each blocker:

| Blocker | Why |
|---|---|
| `no_sender` | S5 Automation has never started. `claim_campaign_recipients` is service_role-only (§8.3) and has no worker, so nothing drains `campaign_recipients`. |
| `no_push_store` | There is no push subscription store anywhere in the repo (D-016) — a push campaign has no address to send to even once a sender exists. |
| `no_smtp` | D-017: Supabase's built-in relay caps at 2 e-mails/hour project-wide, so e-mail waits for the owner's SMTP provider. |

On top of that, `campaign_recipients` has **no insert policy for any role** (§8.1), so this app could
not create the rows a send needs even if it tried. Drafting and scheduling are real and are saved —
`scheduled_for` records intent on a row S5 will read. A button that queued into nothing would be
worse than a disabled one.

The same rule governs automations: the toggle stores intent in `automations.active`, nothing runs
them, and the panel says that rather than implying a switch that starts sending. The weekly cap is
attributed where it lives — `campaign_recipients_enforce_weekly_cap()`, a `before insert` trigger,
not a rule in this UI.

### KPIs: a number, or a stated reason

Three of the four tiles are real, from `orders` over the last 30 days (promo revenue, codes redeemed,
discount rate as the share of completed orders carrying a discount — which is what the design's own
caption says). **Push open rate has no source at all** and renders as "nicht messbar" with the
reason, because `campaigns.stats` is only ever written by a sender. A `0 %` there would be a claim
about the marketing; the truth is that nothing has ever been sent. It becomes real the moment S5
ships, with no UI change.

The same rule runs through the screen: campaign stat columns show "—" rather than 0, a weekday with
no completed orders gets no bar rather than a 0 % one, and "Bester Zeitpunkt" is offered but marked
unavailable (it needs open rates from past campaigns).

## A write that changed nothing is not a write that succeeded

`lib/write.ts`'s `wrote()` is on every write on both screens, and it exists because of a measured
behaviour: a PATCH the row policy does not admit comes back `{ data: [], error: null }` — RLS filters
rows, it does not raise. `run()` only reports `error`, so without this check the screen would show a
success toast for a save that never happened. Confirmed on staging during S4-04: an **operator**
updating `settings` (owner-write) and a **kitchen** session updating `banners` both return `[]` with
no error. Every write therefore asks for `.select(...)` back and checks it.

This is also why the **route guards are what hold** and the RLS is the backstop, and why
`tests/guards.test.ts` tests the real page and layout modules rather than only the policies.

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

- Menu changes reach the storefront after up to **60 s** — `apps/web` caches its Supabase reads with
  `next: { revalidate: 60 }`. Expected, not a bug; worth knowing before someone reports it as one.
- Categories can be created, renamed and deactivated, not deleted — deletion needs a rule for the
  items inside them, which no screen specifies.
- Positions are read-only. `rpc('update_order_items')` landed with S2-02 while S4-01 was open (§6.2/§6.8) — wiring the editor is a later boot.
- Kitchen load is a placeholder (`accepted + preparing` against a nominal capacity of 8) — there is
  no capacity model yet.
- "Info" (notify the customer) on an out-for-delivery order is not wired — no messaging channel yet.
- Bulk tagging sends the customer rows this screen loaded, so a column another operator changed in
  the meantime is written back as we saw it. One upsert per action is the established pattern (never a
  per-row loop) and a single `update` cannot express a different tag array per row; the window is
  seconds and "Rückgängig" restores the prior snapshot.
- The Kunden list loads every customer and filters in the browser. Fine at the current scale (single
  digits on staging, ~1 000 in the design) and wrong at ten times that — move search and segments
  server-side before it gets there.
- "Importieren" on the empty Kunden state is not rendered: there is no import path yet, and the design's
  CTA would be a button that does nothing.
- Single-customer GDPR erasure is a filed request, not an execution — see above.
- XLSX export is a later boot; CSV is client-side.
- Replacing a banner image leaves the previous object in the `site` bucket until someone removes it by
  hand. Deliberate: the live storefront still serves the old path until the draft is published, so
  deleting it would break the site with an unpublished edit. Deleting the banner itself does remove
  its current object.
- A banner date cannot be cleared through a draft — the editor says so and offers an immediate write
  instead. See the publish-model section for the cast that makes this necessary.
- Banner drag-sort is a number field (`Sortierung`), not drag-and-drop as in the canvas. The ordering
  it produces is the same; the gesture is not.
- The campaign wizard cannot state how many customers a segment would match **without** the consent
  filter — `resolve_segment` cannot report it and re-deriving the segment client-side would be a
  second implementation of the thing §8.2 centralises. Contract request filed.
- No test send and no "send to myself" — both need a sender.
- `/website`'s right column shows the publication history; the canvas also has a live storefront
  preview iframe. Not built: the storefront has no preview-of-a-draft mode, and an iframe of the
  published site next to a staged edit would show the wrong thing with no way to tell.
- The nav still marks **Kunden** as `SOON` even though S4-03 shipped it. Left alone on purpose: S6-01
  (QA) is running against the shell right now and the boot fenced off nav edits beyond the two routes
  this boot flips. One word, whoever touches the nav next.
- Gaps found in §6 and §8 are written up in `/memory/boots/proposed/S4-contract-request.md`.
