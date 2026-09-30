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
├── middleware.ts           security headers on every response (CSP with a nonce, HSTS, …) — see lib/csp.ts
├── lib/api.ts              the seam: ShoshoApi (getCatalog · quoteOrder · placeOrder · getOrderByToken · recordOrderAttempt)
├── lib/api-supabase.ts     real implementation (default)
├── lib/api-mock.ts         in-memory seed + faithful quote/place/track (NEXT_PUBLIC_API=mock)
├── lib/cart.tsx            cart state (localStorage) + debounced quote_order — totals are always the server's
├── lib/photos.ts           menu photos: bucket path → public URL (see "Photos" below)
├── lib/attempts.ts         record_order_attempt: session id, dedupe, payload (see "Funnel" below)
├── lib/csp.ts              the Content-Security-Policy and the other security headers
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

## Photos

`menu_items.photos` holds **bucket-qualified paths** — `menu/<item_id>/<n>.jpg`, which is what the
back-office uploader writes (api-contracts §1.2, §6.8). Seed rows may instead hold an absolute URL.

The pipeline is one hop, and it happens **once, in the data layer**:

```
menu_items.photos ──► lib/api-supabase.ts getCatalog()
                         resolvePhotos(r.photos, key => sb.storage.from('menu').getPublicUrl(key))
                      ──► MenuItem.photos: absolute URLs only
                      ──► components/ui/Photo.tsx  <Image fill sizes … />
```

So every surface — product card, product page, "Goes well with", cart line — receives URLs and no
component needs storage or env access. An item with no usable photo keeps the brand placeholder
(stone + dot grid); that is deliberate, not a failure. `lib/photos.ts` also refuses anything malformed
(`data:`, protocol-relative, traversal) rather than emitting a src that points somewhere else.

Two things that made the old bug invisible and are worth remembering:

- **`images.unoptimized` is on** (no `sharp` in a 96 MB container), so `next/image` emits the src
  unchanged: `images.remotePatterns` is never consulted and cannot be what blocks a photo. It is
  declared in `next.config.ts` anyway so the config is right if an optimizer ever becomes affordable.
  `sizes` is likewise inert today and kept for the same reason. `priority` sets `fetchpriority="high"`.
- **The rule that *can* silently block a remote photo is CSP `img-src`** — `lib/csp.ts`. It is derived
  from the runtime Supabase URL, with a `*.supabase.co` fallback.

Photos only ever reach the browser over https from the public `menu` bucket; nothing is proxied.

## Funnel — `record_order_attempt`

`order_attempts` and its RPC are S2-03's (api-contracts §1.7); the storefront is the only writer, so
every attempt figure in the back-office Berichte screen read `0` until this shipped. Two call sites,
one shared tracker (`lib/useAttemptReporting.ts`, mounted in `CartProvider`):

| When | Where | Dedupe |
|---|---|---|
| `place_order` was refused (`OrderRejectedError`) | `components/checkout/CheckoutClient.tsx` → `cart.reportRejection(problems)` | none — always recorded |
| the guest sits on a blocking `quote_order` state: out of zone, below the minimum, closed, item unavailable | `useAttemptReporting`, 1.5 s after the state settles | once per distinct problem state per visit |

`place_order` cannot write the row itself: PostgREST runs one transaction per request and its rejection
is a `raise`, so any row it inserted would roll back with it (§1.7). Hence the client call.

**`session_hash`** is an opaque `crypto.randomUUID()` in **`sessionStorage`** — not a cookie, not
`localStorage`, not a fingerprint, and never anything derived from the person. It dies with the tab and
exists only so the DB can de-duplicate and rate-limit (20 rows per session per minute), which is why no
consent banner is involved. Without storage (private mode) nothing is reported at all.

**Only what §1.7 lists is ever sent**: type, session hash, postal code, subtotal, `{item_id, qty}` and
the problem codes. No name, phone, email, street or comment — the table has a CHECK constraint that
would reject them loudly, and `lib/attempts.ts` is written so the question never arises. Do not widen
the payload without changing the contract first.

## Security headers

Set by `middleware.ts` on every response, so they no longer depend on Cloudflare defaults (S7-01
finding 5). `lib/csp.ts` holds the policy and the reasoning; `tests/csp.test.tsx` locks it down.

- **CSP is enforcing and nonce-based.** That is only safe because `app/layout.tsx` declares
  `dynamic = "force-dynamic"`: every HTML response is rendered per request, so the nonce in the header
  always matches the markup. **If a route is ever made static or ISR, its cached HTML will carry a
  stale nonce and every script on it will be blocked.** Read `lib/csp.ts` before changing that.
- `<PublicEnvScript />` is the one inline script this app writes; it reads the `x-nonce` request header.
- `style-src` keeps `'unsafe-inline'` — React `style={{…}}` attributes need it. Scripts do not get it.
- `connect-src` must keep the Supabase **wss:** origin or the tracking page's live updates die quietly
  and it looks like a Supabase outage rather than a CSP block.
- `Referrer-Policy` is `no-referrer` on `/order` and `/order/<token>` so the tracking token cannot ride
  along in a `Referer` (S7-01 finding 8); everything else is `strict-origin-when-cross-origin`.

Verify after a deploy:

```bash
curl -sI https://shos.hellfiresol.com/ | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```

## Tests

- `pnpm test` — vitest (jsdom): mock quote semantics, cart reducer, hours/slots, slug, problem copy,
  the photo URL resolver, the attempt-reporting trigger logic, and the security headers.
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
