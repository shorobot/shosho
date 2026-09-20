# BOOT: S3-01 (Frontend) — guest site + ordering, v1

## Role
You are session S3 (Frontend) of SHOSHO. You build `apps/web`: the guest-facing Next.js site — menu, product, cart, checkout, order tracking — pixel-faithful to the design and wired to the real Supabase backend from S2-01.

## Context
Repo: https://github.com/shorobot/shosho (public). **Working tree (D-008):** from `/Users/bobbob/BOB/SERVER/SH.OS.` run `git fetch origin && git worktree add .worktrees/s3 -b s3-01 origin/main`, work ONLY in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s3`. Never touch the root checkout or other `.worktrees/`. Never bare `git stash`. PR `s3-01` → `main`. Repo language: English (D-006); UI copy: EN primary, DE for the legal footer, exactly as the design shows.
Read FIRST, in order:
1. `/memory/state.md`, `/memory/decisions.md`, `/memory/sessions.md`
2. `/docs/design/README.md` — brand tokens, screen inventory, product rules. Then open the canvas (`docs/design/shosho-site.dc.html`, see README for how) and study screens **Home, Product, Checkout, About, Mobile** and the "Zustände" screen's *website* section (empty states). The brandbook PDF is binding for colour, type, CTA shape and motion.
3. `/docs/api-contracts.md` **§5** — your data contract. Every read and RPC you need is there with exact shapes. §1–4 for background.
4. `apps/backend/README.md` — how to point at a Supabase project; `apps/backend/types/database.ts` — import types from `@shosho/backend/types/database`.
5. `apps/infra/README.md` — local env, how staging deploys (`shosho-web` image from `apps/infra/placeholder-web` today — you replace it).

Backend availability: `shosho-staging` Supabase project may not exist yet (owner item B). Until it does: run against local Supabase if you have Docker (`pnpm --filter @shosho/backend db:reset`), otherwise build against the types + a small mock layer behind one interface (`lib/api.ts`) so switching to the real client is a one-line change. Do not block on this.

## Tasks
1. **Scaffold** `apps/web`: Next.js 15 App Router, TypeScript strict, Tailwind v4 with the brand tokens as CSS variables (`--cream #FBF7F2`, `--ink #16192B`, `--blue #2E86D6`, `--orange #F26B21`, `--sky #8FC4EE`, `--blush #F6CFD8`, `--sand #FDEEE2`), fonts Archivo (400/500/800 only) + Zen Kaku Gothic New via `next/font`. `pnpm` workspace member `@shosho/web`. `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. ESLint + typecheck + a minimal Vitest/Playwright setup that the existing `node (web)` CI job picks up (check what `ci.yml` runs and match its script names).
2. **Design system primitives** (`components/ui`): Pill CTA (the only button shape), category chip with kana, product card (badge BESTSELLER / NEW / −15 %, kana over name, price, `+ Add`), qty stepper, stone shapes / dot-grid decorations as CSS, logo lockup (+ the 1.3 s 4-keyframe animation on first load, respecting `prefers-reduced-motion`). Motion tokens from the brandbook (120–200 ms micro, 320 ms screen, the two cubic-beziers, no springs).
3. **Home** `/`: header (logo, Menu/Sets/About/Contacts, search, DELIVERY/PICKUP toggle, address field), hero banner (static content in v1 — banners table is later), category rail (from `menu_categories`, hide categories with no on-sale item), "Popular right now" grid with sort (popular/price) and filter (tags), sticky cart panel (desktop) / bottom bar (mobile), DE legal footer with hours from `settings.opening_hours` and business data from `settings.business`. Search filters items client-side by name/description.
4. **Product** `/menu/[slug]`: breadcrumb, kana + name, description, SIZE = option group with `required && max_select = 1` shown as segmented control, other groups as checkbox/radio per rules (`min/max_select`), free options show "free", qty, `Add to order` with live price, trust chips (prep_minutes, free delivery over zone threshold, 4 °C copy), "Goes well with" from `recommended_item_ids`.
5. **Cart** (client state, persisted to localStorage): lines with options, qty ±, promo code input, free-delivery progress bar, totals. **Every cart change calls `rpc('quote_order')`** (debounced ~300 ms) and the totals shown are the server's — never computed client-side. Surface `problems[]` inline (item unavailable → row highlighted with the reason; `closed/outside_hours` → "pre-orders only" banner; `promo_invalid` → reason under the code field).
6. **Checkout** `/checkout`: 3 steps CART → DELIVERY → PAYMENT as one page with a stepper. Delivery vs Pickup cards (pickup shows −10 %), address + floor/apt + postal code (drives the zone → shows zone fee/min order/time from the quote), courier comment + the 4 quick chips, WHEN: ASAP / next slots / pick a time (`scheduled_for`; respect `closed` reasons), contact name + phone (German formats; the RPC normalises), "Guest checkout — no account needed". Payment methods from `settings.payments.enabled.methods` rendered as the design's list; **v1 has no payment provider**: card/Apple/Google/PayPal/Bitcoin submit with `payment_status: 'pending'`, cash submits with `pending` too; show the design's line "Payment is captured on delivery confirmation". `Place order` → `rpc('place_order')`; on `order_rejected` parse `details` and show problems; on success store `tracking_token` and route to tracking.
7. **Tracking** `/order/[token]`: `rpc('get_order_by_token')`, poll every 15 s while not final. Status timeline (created → accepted → preparing → ready → out for delivery → delivered / picked up), ETA, items, totals, order number `#1234`. Empty/invalid token → the design's empty state pattern.
8. **About** `/about` (static copy from the canvas), **legal pages** `/impressum`, `/agb`, `/datenschutz`, `/widerruf` with placeholder DE text and the business data from settings. Cookie banner switch from `settings.site.cookie_banner` (simple consent bar; no analytics in v1). `settings.site.maintenance` → maintenance page. `kitchen.status.paused` → "sold out today" banner, ordering disabled.
9. **Mobile**: every page usable at 375 px; bottom cart bar; the Mobile screen in the canvas is the reference.
10. **Empty & error states** from the Zustände screen (website section): empty cart, address outside delivery area (offer pickup), closed today (offer pre-order), no search results. Every state names the reason and offers the next action.
11. **Deploy**: Dockerfile for `apps/web` (standalone output, ≤ 96 MB RAM at runtime — check with `docker stats`; use `output: 'standalone'`, no dev deps in the image). Replace `apps/infra/placeholder-web` as the `web` service in `docker-compose.staging.yml` / `_deploy.yml` (coordinate by editing only the `web` image build context; keep ports `127.0.0.1:8200`). Env for staging comes from the `STAGING_SUPABASE_URL` / `_ANON_KEY` secrets rendered into `.env` by `_deploy.yml` — add the two `NEXT_PUBLIC_*` names to the render step. If the Supabase project still does not exist at deploy time, the site must still build and render the menu from an empty state, not crash.
12. **Docs**: `apps/web/README.md` (run, env, structure, how the mock layer is switched off). Fill a short "S3 usage notes" list at the end of api-contracts §5 ONLY if you found a gap — as a proposal in `/memory/boots/proposed/`, not by editing §5.

## Boundaries
- Do NOT touch `apps/backend` migrations/RPCs. Need a change → `/memory/boots/proposed/S3-contract-request.md`.
- Do NOT build back-office screens, staff login, or anything under `apps/backoffice`.
- Do NOT integrate Stripe/PayPal/etc. — v1 is `payment_status: pending`.
- Do NOT invent product rules: prices, discounts, thresholds, opening hours all come from the DB via the quote. No client-side price math.
- Do NOT add a fifth colour, other fonts, or non-pill buttons. Do NOT add analytics/tracking scripts.
- Do NOT edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/api-contracts.md`, `/docs/design/*`.
- No secrets in the repo.

## Done when
- [ ] `pnpm --filter @shosho/web build` passes; `node (web)` CI job green (lint + typecheck + tests)
- [ ] Home, Product, Checkout, Tracking, About, legal pages implemented per design, desktop + 375 px
- [ ] Cart totals come only from `quote_order`; `place_order` creates a real order (verified against local or staging Supabase — say which in the log); tracking page shows it
- [ ] Empty/error states from task 10 present
- [ ] Docker image builds, runs under 96 MB, and `Deploy staging` on `main` serves the real site at `http://shos.hellfiresol.com/`
- [ ] `apps/web/README.md` written
- [ ] PR `s3-01` merged

## Reporting
1. `/memory/log.md`: `## <date> — S3 Frontend — S3-01` — what shipped, which backend you verified against, image size/RAM, gaps found in §5, blockers.
2. `/memory/state.md`: ONLY the S3 row.
3. Commits `[S3-01]`.

## Next step
Proposals (S3-02: payments UI once S2-02 lands, banners, i18n DE toggle, PWA, favourites) → `/memory/boots/proposed/S3-<NN>-<slug>.md`. Do not execute. After reporting — stop and wait for S0.
