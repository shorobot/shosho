# SHOSHO — guest site (`apps/web`)

Owner: **S3 Frontend**. The public site: menu, product, cart, checkout, order tracking, About and the
DE legal pages. Next.js 15 (App Router, TypeScript strict), Tailwind v4 with the brand tokens,
`@supabase/supabase-js` with the anon key — guest checkout, no auth session. Data contract:
[`/docs/api-contracts.md` §5](../../docs/api-contracts.md). Design: [`/docs/design`](../../docs/design/README.md).

```
apps/web/
├── app/                    routes: / · menu/[slug] · checkout · order · order/[token] · about · impressum · agb · datenschutz · widerruf
├── components/ui/          design system: Pill (the only button), CategoryChip, ProductCard, QtyStepper, Logo (+ 1.3 s animation), EmptyState, Decor
├── components/site/        Header, Footer (DE), CartPanel, CartLines/Totals, PromoField, StatusBanners, MobileBar, CookieBanner, Maintenance
├── components/home|product|checkout|order|legal
├── lib/api.ts              the seam: ShoshoApi (getCatalog · quoteOrder · placeOrder · getOrderByToken)
├── lib/api-supabase.ts     real implementation (default)
├── lib/api-mock.ts         in-memory seed + faithful quote/place/track (NEXT_PUBLIC_API=mock)
├── lib/cart.tsx            cart state (localStorage) + debounced quote_order — totals are always the server's
├── lib/hours.ts            opening hours → open/closed, next opening, pre-order slots (Europe/Berlin)
├── lib/types.ts            domain types derived from apps/backend/types/database.ts
├── tests/                  vitest (unit) · tests/integration (real Supabase) · e2e/ (Playwright, mock API)
└── Dockerfile              standalone image, build context = repo root
```

## Run

```bash
pnpm install                                   # repo root
cp apps/web/.env.example apps/web/.env.local   # fill NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY — or set NEXT_PUBLIC_API=mock
pnpm --filter @shosho/web dev                  # http://localhost:3000
pnpm --filter @shosho/web lint && pnpm --filter @shosho/web typecheck && pnpm --filter @shosho/web test
pnpm --filter @shosho/web build && pnpm --filter @shosho/web start
```

Against local Supabase: `pnpm --filter @shosho/backend db:start`, then `supabase status` gives the URL
(`http://127.0.0.1:54321`) and anon key for `.env.local`.

## Env

| Variable | Where | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` / container env | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` / container env | anon key (public by design; RLS guards) |
| `NEXT_PUBLIC_SITE_URL` | `.env.local` / container env | canonical origin for metadata |
| `NEXT_PUBLIC_API` | `.env.local` | `supabase` (default) or `mock` |

The Docker image is built in CI **without** the Supabase values. `lib/env.ts` reads them at request
time on the server (`NEXT_PUBLIC_*` or the plain `SUPABASE_URL` / `SUPABASE_ANON_KEY` names) and hands
them to the browser via `<PublicEnvScript />` (`window.__SHOSHO_ENV__`). On staging they come from the
`.env` that `apps/infra/_deploy.yml` renders from GitHub Secrets.

If the project is unreachable, unconfigured, or the tables don't exist yet, `getCatalog()` returns
`online: false` and every page renders its empty state ("The menu is being prepared") — it never crashes.

## Mock layer — and how to switch it off

`lib/api.ts` picks the implementation once per runtime:

- `NEXT_PUBLIC_API=mock` → `lib/api-mock.ts`: the seed from `apps/backend/supabase/seed.sql` in memory
  (`lib/mock-data.ts`) plus a re-implementation of `quote_order` / `place_order` / `get_order_by_token`
  with the same problem codes. Orders live in `localStorage` and progress through the statuses on a
  timer so the tracking page moves. This is the **only** place the site computes a price.
- anything else (default) → `lib/api-supabase.ts`: the real RPCs. Switching off the mock = remove the
  line from `.env.local` (or set `NEXT_PUBLIC_API=supabase`). Nothing else changes: the UI talks to the
  `ShoshoApi` interface only.

## Product rules the UI relies on (all enforced server-side by `quote_order` / `place_order`)

- Totals, discounts, delivery fee, zone, promised time: only from `quote_order` (debounced 300 ms on
  every cart change; the product page prices its "Add to order" button with a one-line quote too).
- `problems[]` are surfaced inline: `unavailable` / `invalid_options` on the cart row, `closed` as the
  "pre-orders only" banner, `promo_invalid` under the code field, `out_of_zone` / `below_min_order` in
  the delivery step (with "Switch to pickup").
- `settings.kitchen.status.paused` → "Sold out today", ordering disabled. `settings.site.maintenance` →
  maintenance page. `settings.site.cookie_banner` → consent bar (no analytics exist in v1).
- Categories without an on-sale item are hidden. Product URLs are `/menu/<name>-<sku>` and resolve by
  the SKU suffix (`menu_items` has no slug column).
- Payment: v1 has no provider — every method submits `payment_status: 'pending'`; "Payment is captured
  on delivery confirmation" is shown as in the design.

## Tests

- `pnpm test` — vitest (jsdom): mock quote semantics, cart reducer, hours/slots, slug, problem copy.
- `pnpm test:integration` — the same contract through `lib/api-supabase.ts` against a running Supabase
  (`NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` set; writes a test order — never against production).
- `pnpm exec playwright install chromium && pnpm test:e2e` — smoke flow menu → product → checkout →
  tracking with the mock API, desktop + iPhone 375 px.

## Docker

```bash
docker build -f apps/web/Dockerfile -t shosho-web .        # from the repo root
docker run --rm -p 8200:3000 --memory 96m -e NEXT_PUBLIC_SUPABASE_URL=… -e NEXT_PUBLIC_SUPABASE_ANON_KEY=… shosho-web
```

`node:22-alpine`, `output: 'standalone'`, no dev deps, no `sharp` (`images.unoptimized`), V8 heap capped
via `NODE_OPTIONS` to stay under the 96 MB container limit of `docker-compose.staging.yml`.
