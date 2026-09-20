# BOOT: S4-01 (Back-office) — staff login, live orders board, order detail, kitchen & driver views

## Role
You are session S4 (Back-office) of SHOSHO. You build `apps/backoffice`: the operator-facing Next.js app the kitchen runs on — sign-in, the live orders board (Bestellungen), order detail with timeline, history, and the role-specific kitchen / driver views. Menu, CRM, marketing, settings screens are later boots.

## Context
Repo: https://github.com/shorobot/shosho (public). **Working tree (D-008):** from `/Users/bobbob/BOB/SERVER/SH.OS.` run `git fetch origin && git worktree add .worktrees/s4 -b s4-01 origin/main`, work ONLY in `/Users/bobbob/BOB/SERVER/SH.OS./.worktrees/s4`. Never touch the root checkout or other `.worktrees/`. Never bare `git stash`. PR `s4-01` → `main`; before any PR that touches `/memory`, `git merge origin/main` first (D-009). Repo language: English (D-006). **UI copy: German primary with an EN toggle**, exactly as the design shows (labels like Bestellungen, Annehmen, Zubereitung starten, Fertig, An Fahrer übergeben, Storniert, Abholung…).
Read FIRST, in order:
1. `/memory/state.md`, `/memory/decisions.md` (D-008, D-009, **D-010** — you share tokens, not components, with `apps/web`), `/memory/sessions.md`
2. `/docs/design/README.md` — tokens, screen inventory, product rules. Open the canvas (`docs/design/shosho-site.dc.html`) and study **BO · Bestellungen, BO · Detail, BO · Historie, BO · Einstellungen (team & roles only), BO · Zustände (back-office section)**. The brandbook PDF is binding.
3. `/docs/api-contracts.md` **§6** — your data contract (§6.1–6.3 are this boot). §1–4 for the schema and the RPC transition rules.
4. `apps/backend/README.md` — test logins (`owner@ / operator@ / kitchen@ / driver@shosho.test`, password in the README), how to run locally; `apps/backend/types/database.ts` — import types from `@shosho/backend/types/database`.
5. `apps/infra/README.md` — how staging deploys. Staging Supabase `shosho-staging` already has schema + seed; `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` come from the `STAGING_SUPABASE_*` secrets (S3-01 adds them to the deploy render step — coordinate via S0 if it is not there yet; do not edit `_deploy.yml` yourself).
6. Peek at `apps/web` on `origin/s3-01` (read-only) for how S3 set up Tailwind tokens and fonts, so both apps look like one brand. Do not import from it.

## Tasks
1. **Scaffold** `apps/backoffice`: Next.js 15 App Router, TypeScript strict, Tailwind v4 with the brand tokens as CSS variables (same 7 colours / 2 fonts as the design README), `pnpm` workspace member `@shosho/backoffice`, scripts `lint`, `typecheck`, `test` (the `node (backoffice)` CI job runs exactly those with `--if-present`), `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). i18n: a tiny dictionary (`de` default, `en`) with the DE/EN toggle in the header — no heavy i18n lib.
2. **Auth**: Supabase Auth email + password sign-in page; session in cookies via `@supabase/ssr`; middleware redirects unauthenticated users to `/login`. After login read own `staff` row (`name`, `role`) → header avatar + role, and route by role: owner/operator → `/orders`, kitchen → `/kitchen`, driver → `/driver`. Logout. Unknown role / no staff row → "no access" page.
3. **App shell** per design: left nav (Bestellungen, Kunden, Speisekarte, Website, Marketing, Berichte, Einstellungen — only Bestellungen is live in this boot; the rest render a "coming soon" empty state in the design's style), top bar with kitchen load placeholder, DE/EN toggle, user chip.
4. **Orders board** `/orders` (operator, owner) — the Bestellungen screen:
   - Header controls: Online/Pause toggle (`rpc('kitchen_pause')`; when paused show the design's "Bestellannahme pausiert" state), prep-time display from `settings.ops`, rush toggle (owner: update `settings.kitchen.rush`; operator: read-only), sound-on-new-order toggle (browser audio, persisted in localStorage), `+ Telefonbestellung` button (opens a minimal form → `rpc('place_order', {channel:'phone', …})`; keep it simple: items + qty, type, contact, address, payment cash/card).
   - KPI strip for today: orders, revenue, avg delivery minutes, cancelled — computed client-side from today's orders.
   - Search (number, name, phone, address) + filter chips (Alle / Lieferung / Abholung / Bezahlt / Offen / Vorbestellt).
   - Columns exactly as the design: **In Arbeit** (NEU → Annehmen/Ablehnen; ANGENOMMEN → Zubereitung starten; IN ZUBEREITUNG → Fertig, with elapsed/promised timer and "überfällig" state; FERTIG → An Fahrer übergeben (delivery, pick a driver from `staff` where role=driver) / Ausgegeben (pickup)), **Unterwegs** (driver, ETA, Zugestellt), **Erledigt heute**, **Vorbestellungen** (scheduled_for not null, sorted by time).
   - Card content: number, wait timer, customer name + phone, address line + zone + distance, items with options, **allergy_note banner** in orange when present, total, payment status + method, type badge.
   - **Realtime**: subscribe to `orders`, `order_items`, `order_events` (postgres_changes); on any event re-fetch the affected order row (§6.1). Reconnect handling → the design's "Verbindung unterbrochen" state with "Neu verbinden".
   - Actions call `rpc('set_order_status', …)` and use the returned row; optimistic UI allowed, but reconcile with the response.
5. **Order detail** `/orders/[id]` — the Detail screen: allergy banner, customer block (n-th order via `customer_stats`, phone, CRM link placeholder), delivery block (address, zone, ETA, comment, comment_flags chips, driver), positions (read-only in v1 — editing is S2-02), totals incl. tip and VAT line, payment ref, **timeline from `order_events`** (type, time, actor name via `staff`), actions Fertig melden / Erstatten / Stornieren (with reason) via `set_order_status`, print (browser print stylesheet for a kitchen bon — 80 mm width).
6. **History** `/orders/history` — the Historie screen: table with date range (default 14 days), status / payment / type / driver filters, sort by total, sum row, CSV export (client-side; XLSX may be a later boot).
7. **Kitchen view** `/kitchen` (role kitchen): only ANGENOMMEN / IN ZUBEREITUNG / FERTIG columns, big touch targets, actions limited to Zubereitung starten / Fertig, allergy banners prominent, sound on new accepted order. Realtime as above.
8. **Driver view** `/driver` (role driver): own orders (`driver_id = me`) in ready / out_for_delivery, address with a maps link, phone tap-to-call, cash amount to collect when `payment_method = cash`, action Zugestellt (`set_order_status(delivered, {cash_received: true})`). Mobile-first (375 px).
9. **Empty & error states** from BO · Zustände: no orders today, intake paused, no search results, connection lost, payment failed (render from `payment_status = failed`), item sold out during checkout (skip in v1 — no signal yet), out-of-zone (skip in v1). Every state names the reason and offers the next action.
10. **Tests**: Vitest unit tests for the board's grouping/filter/timer logic and the transition → button mapping; one Playwright smoke (login → board renders seed orders) if it can run in CI without Docker, otherwise document how to run it locally.
11. **Deploy**: Dockerfile (`output: 'standalone'`, ≤ 96 MB runtime RAM — measure). Staging runs on `127.0.0.1:8202` — add a `backoffice` service to `docker-compose.staging.yml` publishing only `127.0.0.1:8202:3000`, `mem_limit` 96m, and the image build/push for `shosho-backoffice` in `_deploy.yml` next to web/api **in the same pattern S1 used** (touch only what is needed; if S3-01 has already changed `_deploy.yml` on `main`, merge `origin/main` before editing). The public URL for the back-office (a subpath or a second hostname) is NOT yours to decide — write a proposal for S0/S1 (`/memory/boots/proposed/S1-04-backoffice-host.md`); until then it is reachable only via ssh port-forward (`ssh -L 8202:127.0.0.1:8202 shos@…`) and document that in your README.
12. **Docs**: `apps/backoffice/README.md` (run, env, roles, routes, how to reach staging). Gaps in §6 → `/memory/boots/proposed/S4-contract-request.md`, do not edit the contract.

## Boundaries
- Do NOT build Kunden, Speisekarte, Website, Marketing, Berichte, Einstellungen beyond the nav placeholders (S4-02+).
- Do NOT touch `apps/backend` migrations/RPCs or `apps/web`. Need a backend change → proposal.
- Do NOT edit positions of an order (no `update_order_items` yet).
- Do NOT expose the service-role key anywhere in the app. Anon key + user session only; RLS does the rest.
- Do NOT add a fifth colour or other fonts. Do NOT add analytics.
- Do NOT edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/api-contracts.md`, `/docs/design/*`, `/memory/infra-access.md`.
- No secrets in the repo.

## Done when
- [ ] `pnpm --filter @shosho/backoffice build` passes; `node (backoffice)` CI job green
- [ ] Login works with the 4 seed roles against local or staging Supabase (say which); role routing correct
- [ ] Orders board shows seed/new orders live: placing an order via `place_order` (from S3's site, a test script, or the phone-order form) appears on the board without reload; every transition button works and the timeline in detail reflects it
- [ ] Kitchen and driver views work with their roles and are refused the other actions (RLS/RPC errors handled gracefully)
- [ ] History with filters + CSV
- [ ] Empty/error states from task 9
- [ ] Docker image ≤ 96 MB RAM; `backoffice` service deploys to staging on `127.0.0.1:8202` and answers over ssh port-forward
- [ ] `apps/backoffice/README.md`; PR `s4-01` merged

## Reporting
1. `/memory/log.md`: `## <date> — S4 Back-office — S4-01` — what shipped, backend verified against, RAM, gaps in §6, blockers.
2. `/memory/state.md`: ONLY the S4 row.
3. Commits `[S4-01]`.

## Next step
Proposals (S4-02: Speisekarte + Artikel editor; S4-03: Kunden/Profil CRM; S4-04: Einstellungen + Website CMS; host/URL for the back-office → S1) → `/memory/boots/proposed/`. Do not execute. After reporting — stop and wait for S0.
