# SHOSHO — back-office (`apps/backoffice`)

Owner: **S4 Back-office**. The operator-facing app the kitchen runs on: staff sign-in, the live orders
board (Bestellungen), order detail with the timeline, history with CSV export, and the role-specific
kitchen and driver screens. Contract: [`/docs/api-contracts.md`](../../docs/api-contracts.md) §6.
Design: [`/docs/design/`](../../docs/design) (screens **BO · Bestellungen / Detail / Historie /
Zustände**). UI language: **German primary, EN toggle** in the nav rail.

```
apps/backoffice/
├── app/                    App Router: /login, /no-access, (shell)/{orders,orders/[id],orders/history,kitchen,driver} + nav placeholders
├── components/             shell (nav, login), orders (board, card, dialogs), detail, history, kitchen, driver, ui (pill, badge, modal, states)
├── lib/                    supabase clients (@supabase/ssr), store (realtime), orders (pure board logic), i18n, time, money, csv, sound
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
| `/customers`, `/menu`, `/website`, `/marketing`, `/reports`, `/settings` | owner, operator | "coming soon" placeholders (S4-02+) |

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

## End-to-end smoke

`e2e/smoke.spec.ts` signs in with the seed logins and checks the board, the DE/EN toggle, role
routing and the `/login` redirect. It needs a real backend, so it is **not** part of the CI job:

```bash
cd apps/backend && pnpm db:start          # or point .env.local at shosho-staging
cd ../backoffice && pnpm exec playwright install chromium
pnpm --filter @shosho/backoffice test:e2e
```

Playwright cannot install its browsers on macOS 12 (`chromium on mac12` is unsupported), so on that
host run it in CI instead — the temporary `S4 verify` workflow on the `s4-01` branch did exactly that
against a local Supabase stack.

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

- Positions are read-only until `update_order_items` exists (S2-02).
- Kitchen load is a placeholder (`accepted + preparing` against a nominal capacity of 8) — there is
  no capacity model yet.
- "Info" (notify the customer) on an out-for-delivery order is not wired — no messaging channel yet.
- The CRM link on the detail screen is a placeholder until S4-03.
- XLSX export is a later boot; CSV is client-side.
- Gaps found in §6 are written up in `/memory/boots/proposed/S4-contract-request.md`.
