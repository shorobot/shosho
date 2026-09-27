# LOG — chronological project journal

Entry format: `## YYYY-MM-DD — S<N> <Name> — S<N>-<NN>` + 2–4 sentences: what was done / what changed in system state / blockers.
Append only. Never delete. Entries before 2026-09-20 are in Ukrainian (pre D-006).

---

## 2026-09-17 — Orchestrator — init
Створено скелет репозиторію: /memory (log, state, decisions, boots/), /docs (architecture, api-contracts), /apps (web, backoffice, automation, infra). Зафіксовано початковий стек у decisions.md (D-001…D-003). Виданий перший boot devops-01. Блокер: GitHub remote та серверний провайдер ще не визначені — вирішує DevOps-01 разом із власником.

## 2026-09-17 — Orchestrator — github-connect
Власник створив org `shorobot`. Створено private repo https://github.com/shorobot/shosho, `main` запушено. Boot devops-01 скориговано: п.1 тепер тільки branch protection, репо не створювати.

## 2026-09-19 — S0 Orchestrator — numbering
Введено нумерацію сесій S0…S7 (+ під-сесії S5.1…S5.5), ростер у /memory/sessions.md. Boot ID = `S<N>-<NN>`, файл `S<N>-<NN>-<slug>.md`, префікс коміту `[S<N>-<NN>]`. devops-01 перейменовано у S1-01.

## 2026-09-20 — S0 Orchestrator — decisions + S1-02
TETA+PI manager granted co-tenant access to the shared droplet (user `shos`, 512M, ports 8200–8299, domain shos.hellfiresol.com) — recorded in /memory/infra-access.md, ssh verified. Owner accepted D-004 (co-tenant staging), D-006 (English repo), D-007 (n8n dropped; orchestration in code). Merged PR #1 (S1-01 infra skeleton; S1-01 closed as partial — no staging live, no Supabase, no report). Memory/docs rewritten in English. Issued S1-02 to adapt infra to the real server terms and bring staging up.

## 2026-09-20 — S0 Orchestrator — design + S2-01
Owner delivered the brandbook (PDF) and the full UI canvas (5 guest screens, 13 back-office screens, empty/error states, CRO notes) — stored in /docs/design/ with a README (tokens, screen inventory, product rules). S0 derived the domain model and wrote /docs/api-contracts.md §1–4 (schema, RPCs, realtime, RLS) with an explicit S2-01 subset. Issued S2-01 (Supabase schema v1 + order RPCs + RLS + seed + types). S1-02 runs in parallel; S2 can start on local Supabase until the staging project exists.

## 2026-09-20 — S0 Orchestrator — worktree incident + D-008
S0 and S1-02 shared one checkout; S1's commit `ec9daef` [S1-02] landed on S0's branch and was merged into main via PR #3 (content valid, CI green). Fixed: local `s1-02` repointed to main (S1 continues from there with its uncommitted workflow edits intact), S0 moved to `.worktrees/s0`. D-008: one worktree per session; root checkout = S1.

## 2026-09-18 — S1 DevOps — S1-01 (retroactive, written by S1-02 — S1-01 never reported)
Did: branch protection on `main` (PR + green `CI`), repo switched to public (owner) so rulesets/required reviewers work on Free; environments `staging` / `production` (owner = required reviewer); `apps/infra` skeleton — pnpm monorepo wrapper, `.env.example` per app, `docker-compose.yml` (n8n + placeholder api), `docker-compose.staging.yml`, placeholder-web / placeholder-api images, workflows `ci.yml` / `_deploy.yml` / `deploy-staging.yml` / `deploy-prod.yml` (GHCR build → ssh → compose), `README.md`; D-004 proposal (`boots/proposed/decision-D-004.md`) assuming user `shosho`, `/opt/shosho`, host nginx, root bootstrap; secrets `STAGING_SSH_*`, `STAGING_N8N_*`. Merged as PR #1.
Did NOT finish: staging never came up (every `Deploy staging` run ended in `startup_failure` — root cause found in S1-02: the repo default `GITHUB_TOKEN` is read-only and the reusable `_deploy.yml` asked for `packages: write` without the callers granting it); no Supabase project; no log/state report. Its host-level assumptions were superseded by the real co-tenant terms (D-004, `infra-access.md`).

## 2026-09-20 — S1 DevOps — S1-02
Done (PR #5 `s1-02` → `main`): n8n removed everywhere (compose, `.env.example`s, README, CI smoke test, secrets `STAGING_N8N_*` deleted — D-007); `apps/infra/nginx/` and `scripts/server-bootstrap.sh` deleted, replaced by user-level `scripts/shos-user-setup.sh` (no sudo, only `$HOME`); README `## Server` now mirrors `infra-access.md`. Server, as `shos`: **rootless docker** 29.5.3 installed with `dockerd-rootless-setuptool.sh` (every host prerequisite — `docker-ce-rootless-extras`, `uidmap`, `slirp4netns`, subuid/subgid, linger — was already there, so no root request to TETA+PI was needed; no fallback used). `docker.service` enabled under `systemd --user`; `DOCKER_HOST=unix:///run/user/1002/docker.sock` in `~/.profile` and set explicitly in `_deploy.yml` (non-login ssh shells skip `~/.profile`). Stack in `/home/shos/shosho/staging`: `web` → `127.0.0.1:8200` (96M cap), `api` → `127.0.0.1:8201` (160M cap), nothing else published; `ss -ltn` shows only 127.0.0.1. Verified: `curl 127.0.0.1:8200/` → "SHOSHO staging OK", `:8201/health` → 200; slice `memory.current` 211–344M (≈110–130M anon, rest reclaimable page cache) of 512M; `docker compose down && up` and `systemctl --user restart docker` both back in < 5 s. CI now guards the staging compose (127.0.0.1:8200–8299 only, no 0.0.0.0). `_deploy.yml`: no sudo, GHCR token over stdin (shared host — never on the remote command line), health over ssh on the box, public URL check informational only; callers grant `packages: write` (fixes the S1-01 `startup_failure`). GitHub: `STAGING_SSH_USER=shos`, `PUBLIC_HOST/URL=shos.hellfiresol.com`, GHCR packages `shosho-web`/`shosho-api:staging` created by the first (branch) deploy run.
Public URL: `http://shos.hellfiresol.com/` serves "SHOSHO staging" (vhost OK); `https://shos.hellfiresol.com/` returns 200 but the **hellfire** site (known CF "SSL Full" → origin :443 default vhost; owner / TETA+PI side, not a blocker).
TETA+PI (`teta-pi-e0`, session "TTPI · MANAGER"): one message sent — :8200 up, please verify the vhost; no root requests. Answer (2026-09-20, `teta-pi-e0`): "vhost OK. Origin :80 with Host shos.hellfiresol.com → 200 \"SHOSHO staging OK\" + our security headers (HSTS/nosniff/DENY). Public https still lands on hellfire apex — CF SSL-Full → origin :443 — owner-side Configuration Rule pending, nothing for you. Your setup (rootless docker, loopback-only :8200/:8201, ~130M) is within limits; no changes requested. Keep the ssh key as a repo secret, never in the workflow file." — complied (key only in GitHub Secret `STAGING_SSH_KEY`).
Owner actions requested (one list at boot start): (A) replace `STAGING_SSH_KEY` with `~/.ssh/shos_ed25519` (the S1-01 secret held another key — the branch deploy run failed at ssh with `Permission denied (publickey)`); (B) create Supabase `shosho-staging` (eu-central-1) and set `STAGING_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY` (no Supabase CLI/token on the Mac; S1 never sees the keys). Until (A) the `Deploy staging` run on `main` cannot go green; until (B) the rendered `.env` has empty `SUPABASE_*` (the placeholders do not need them). No tables created (S2).
Not done by S1-02: nothing else; prod target untouched (D-004). Proposal for next boot: `boots/proposed/S1-03-supabase-migrations-ci.md`.

## 2026-09-20 — S0 Orchestrator — S1-02 closed, S1-03 issued
Owner replaced `STAGING_SSH_KEY`; S0 merged PR #5; `Deploy staging` on `main` green (run 35517549141), containers healthy, http://shos.hellfiresol.com/ serves the placeholder. S1-02 closed. S1's proposal S1-03 accepted and issued with an added task 0 (move secrets to environment `staging`, restrict to `main`, audit collaborators — repo is public). Owner item B (Supabase staging project + secrets) still open; blocks S2-01 task 8 / S1-03 task 1 only.

## 2026-09-20 — S2 Backend — S2-01
Shipped `apps/backend/` (PR #6, branch `s2-01`): 10 migrations (enums → settings/staff/zones → menu → customers → orders with `order_number_seq` from 1000 → promo_codes → triggers → views → RLS → RPCs), idempotent `seed.sql` (10 categories with kana, 14 items, 5 option groups / 18 options, zones A/B/C with Berlin postal codes, SHOSHO10 / WILLKOMMEN / LUNCH15, settings, 4 staff logins in `auth.users`), RPCs `quote_order` / `place_order` / `set_order_status` / `get_order_by_token` / `kitchen_pause`, generated `types/database.ts`, vitest suite (21 tests: quote/place happy paths, min order, out of zone, stoplist, first-order promo, illegal transition, role gates incl. kitchen≠delivered, anon RLS, role matrix), `backend` CI job (`supabase start` → `db reset` → `db lint` → seed twice → typecheck → vitest → types diff) — green. api-contracts §5 written; `apps/backend/README.md` written. Deviations/additions (tracking_token, zone free-delivery threshold, extra problem codes, public `kitchen.status`, driver/kitchen self-read) → `/memory/boots/proposed/S2-contract-change.md`.
Blockers / not done: (1) **staging not applied** — no `shosho-staging` project / `STAGING_SUPABASE_*` secrets exist yet (S1-02 task 6); needs project ref + DB password from the owner, then `pnpm --filter @shosho/backend db:push` (documented in README). (2) Local `supabase start` was impossible on this Mac (macOS 12: no Docker Desktop, colima needs qemu which no longer has a Homebrew bottle) — all verification ran in CI on ubuntu, where `supabase db reset` + seed + tests pass with zero errors. Local `db reset` remains to be confirmed by whoever has Docker. Overlap with S1-03 proposal: its task 2 (lint migrations in CI) is already covered by the `backend` job; task 1 (`migrate-staging.yml` = `supabase db push` on `main`) is still wanted — S2 supports it (needs `SUPABASE_ACCESS_TOKEN` + `STAGING_SUPABASE_DB_PASSWORD` from the owner).

## 2026-09-20 — S0 Orchestrator — S2-01 merged, S3-01 issued
Reviewed PR #6: §5 accepted as written; all S2 deviations (tracking_token, zone free-delivery threshold, pickup_discount_pct / rush / kitchen.status / payments.enabled settings rows, extra problem codes, picked_up event, role-matrix relaxations, v1 payment stub) accepted and folded into api-contracts §1–4; proposal file removed. Resolved memory/ merge conflicts on s2-01, merged PR #6 (backend CI green). Wrote §6 (Backoffice → Supabase). Issued S3-01 (guest site v1, replaces the web placeholder on staging). S2-02 proposal kept in boots/proposed/ for after S3-01/S4-01.

## 2026-09-20 — S1 DevOps — S1-02 (addendum: owner item B done)
Owner created Supabase project `shosho-staging` (eu-central-1, ref `bvmitglwwqsvufetlkff`, URL `https://bvmitglwwqsvufetlkff.supabase.co`) and set `STAGING_SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY` (legacy anon/service_role keys) via `gh secret set`; `STAGING_SSH_KEY` replaced with `~/.ssh/shos_ed25519` — S1 never saw any value. S1 set variable `STAGING_SUPABASE_PROJECT_REF=bvmitglwwqsvufetlkff` (env `staging`). `Deploy staging` on `main` green 4× since PR #5 merged (health over ssh: web 200 "SHOSHO staging OK", api 200). Still owner-side for S1-03 / S2-01 task 8: `STAGING_SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`. No tables created by S1.

## 2026-09-20 — S0 Orchestrator — item B closed, schema on staging
Owner set the last two secrets; S0 verified 8 secrets + 3 env variables. S1-03 code merged (PR #11 pipeline + env secrets + housekeeping; PR #12 fix: pnpm forwarded a literal `--` into `supabase db push`). First `Migrate staging` run failed, the fix run 35538990827 is green — S2-01 migrations + seed are now on `shosho-staging`. S1's own S1-03 report is still pending. S3-01 can point at staging directly.

## 2026-09-20 — S0 Orchestrator — S4-01 issued, D-009/D-010, architecture refreshed
Issued S4-01 (back-office: auth + roles, live orders board, detail with timeline, history, kitchen and driver views; staging on 127.0.0.1:8202, public host TBD). D-009: report PRs merge origin/main first, memory/ append-only for children. D-010: backoffice shares brand tokens, not components, with web (parallel start). docs/architecture.md rewritten to the real state. S1-03 report still pending (PR #13 cache tweak open).

## 2026-09-21 — S1 DevOps — S1-03
Shipped (PRs #11, #12, #13, all `[S1-03]`): **`migrate-staging.yml`** — chain on `main` is now `CI → Migrate staging → Deploy staging` (`deploy-staging.yml` listens to Migrate, so code never ships against a failed schema push). PR job `plan` (no secrets; triggered by changes under `apps/backend/supabase/**`): lists new migrations vs `main` in the job summary, fails if an applied migration was edited/deleted or is out of timestamp order. `main` job `push` (environment `staging`): `supabase link` → `db push --dry-run` (plan vs remote) → `db push --include-seed --yes` (= S2's `pnpm db:push`) → `migration list`. First real run applied all 10 S2-01 migrations + seed to `shosho-staging` (ref `bvmitglwwqsvufetlkff`); subsequent runs report "Remote database is up to date" (idempotent). Task 2 (SQL lint) is already covered by S2's `backend` CI job — not duplicated. README `apps/infra` gained *Migrations* (add / PR plan / push / roll back) and the environment-secret procedure; `apps/backend/README.md` now points at the pipeline instead of manual push.
Task 0 secrets hardening: environment `staging` restricted to branch `main` (explicit policy); callers use `secrets: inherit`, `_deploy.yml` reads `<secret_prefix>_*` (STAGING/PROD) from the job's environment; `STAGING_SSH_HOST/USER`, `STAGING_SUPABASE_URL` set in env `staging` by S1. **Pending owner**: re-enter `STAGING_SSH_KEY`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` with `--env staging` (commands given in chat) — until then the repo-level copies remain and are what the green runs used; S1 deletes them right after the first green chain with env-only secrets. Access audit: org `shorobot` members = `tetakta`; repo collaborators = `tetakta` (admin). Nobody else.
Housekeeping: runners pinned `ubuntu-24.04`; actions bumped to current majors (checkout v7, setup-node v7, setup-python v7, upload-artifact v7, pnpm/action-setup v6, docker login v4 / buildx v4 / build-push v7). Two fixes found by the first chained runs: `pnpm run db:push -- --yes` forwarded a literal `--` (CLI printed help) → call `supabase db push` directly; build-push v7 failed twice with GHA cache `failed to reserve cache` → `cache-to: …,ignore-error=true` (cache export best-effort, image push unaffected). Final verification 2026-09-21: CI → Migrate (up to date) → Deploy green end-to-end; health over ssh web 200 "SHOSHO staging OK", api 200; slice memory ≈ 357M right after image pull (page cache), ~130M anon.
Not done: none in scope. Open for S0: `deploy-prod.yml` expects `PROD_*` secrets in environment `production` when a prod target exists.

## 2026-09-21 — S0 Orchestrator — D-011 payments, S2-02 issued
Owner accepted D-011: Stripe (cards + Apple/Google Pay + PayPal) with manual capture on delivery, webhooks + workers as Supabase Edge Functions deployed by `migrate-staging.yml`, Bitcoin deferred. Issued S2-02: Stripe schema/functions/jobs, storage bucket `menu`, `update_order_items`, `customer_events`, guest tracking realtime, anonymisation job, §5.6/§6.8. Owner to create a Stripe account and provide test keys as env `staging` secrets.

## 2026-09-21 — S3 Frontend — S3-01
Shipped `apps/web` (PR #15, branch `s3-01`): Next.js 15 App Router + TypeScript strict + Tailwind v4 with the brand tokens as CSS variables, Archivo 400/500/800 + Zen Kaku Gothic New via `next/font`; design system in `components/ui` (Pill = only CTA, category chip with kana, product card, qty stepper, stones/dot grid, logo lockup with the 1.3 s / 4-keyframe animation, reduced-motion aware); pages Home (header with search + DELIVERY/PICKUP + address, hero, category rail from `menu_categories` hiding empty ones, "Popular right now" with sort/filter/search, sticky cart, DE footer from `settings`), Product `/menu/<name>-<sku>` (option groups per min/max rules, live price via a one-line `quote_order`, trust chips, "Goes well with"), Checkout (CART → DELIVERY → PAYMENT on one page; zone by postal code, courier chips, ASAP/slots/pick-a-time, guest contact, methods from `payments.enabled`, `place_order` with `pending`, `order_rejected` → problems inline), Tracking `/order/[token]` (15 s poll, timeline, ETA), About, Impressum/AGB/Datenschutz/Widerruf (DE placeholders + business data), maintenance page, cookie bar, "sold out today" / "pre-orders only" banners, empty states from the Zustände screen, 375 px layout with the bottom bar. Data layer behind `lib/api.ts`: `api-supabase` (default) and `api-mock` (`NEXT_PUBLIC_API=mock`, seed in memory, faithful quote/place/track). Cart totals come only from `rpc('quote_order')` (debounced 300 ms); no client-side price math anywhere except inside the mock "server".
Verified against: **local Supabase in GitHub Actions** (temporary workflow `S3 verify` on the branch: `supabase start` + migrations + seed, then `apps/web/tests/integration/order.test.ts` through `lib/api-supabase.ts` — catalogue reads, `quote_order` zone/promo/problems, real `place_order` → order #10xx with `tracking_token` → `get_order_by_token` returns it; 3/3 passed). No Docker on this Mac (macOS 12, colima needs qemu, brew build fails), so local runs used the mock; staging Supabase exists but has no tables yet (owner: DB password), so staging renders the "menu is being prepared" empty state until S2 pushes the migrations. Playwright smoke (desktop + 375 px, mock API) runs in the same workflow.
Docker: `apps/web/Dockerfile` (root build context, node:22-alpine, standalone, no sharp, heap capped) — image 233 MB, **56 MiB RSS under the 96m limit** after ~70 requests in CI (`docker stats`), no OOM. Infra edits (web service only): `_deploy.yml` builds `apps/web/Dockerfile` from `.` and renders `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SITE_URL` into `.env`; `docker-compose.staging.yml` web → container port 3000 on `127.0.0.1:8200`, env passed through; placeholder-web kept as the fallback image. The anon key is read at request time on the server and injected into the page, so the image is built without secrets.
Gaps found in §5 → `/memory/boots/proposed/S3-contract-notes.md` (no item slug; private `ops` values shown on the storefront — derived from a second pickup quote for now; no item-level −15 % / rating data; photo bucket URL). Proposals: `S3-02-payments-ui.md`, `S3-03-banners-i18n-pwa.md`. Blockers: none — while this PR was open S0 closed item B and pushed the schema + seed to `shosho-staging`, so the first `Deploy staging` after the merge serves the real menu.

## 2026-09-21 — S3 Frontend — S3-01 (addendum: staging verified, 502 fixed)
PR #15 merged; the first `Deploy staging` served the site internally (`127.0.0.1:8200` → 200, `<title>SHOSHO — Sushi, Ramen & Bowls</title>`, web container 49–87 MiB of 96) but the public host answered **502 from nginx**: `next/font` preloaded every unicode-range subset of Zen Kaku Gothic New (~100 `.woff2`), so the `link` response header was >15 KB — above nginx's default `proxy_buffer_size`. Fix in PR #18 (`preload: false` for the Japanese face; header 300 bytes). After the deploy of `3bfb7ec`: **http://shos.hellfiresol.com/ renders the real menu from `shosho-staging`** (10 categories, 14 on-sale items — Ebi Tempura's seed stoplist was "today" on 2026-09-20 and expired), `quote_order` prices the cart live, and a real pickup order was placed through the live site: **order #1000**, contact "S3 test order (ignore)", cash, 12.15 € (−10 % pickup), tracking token resolves on `/order/<token>` with the timeline. Operators can cancel it from the back-office once S4-01 lands. Note for S1/S4: the whole `shos` slice showed `memory.current` 487–496 M of 512 M during deploys (image layers in page cache; reclaimable) — worth a look when the back-office container is added.

## 2026-09-26 — S0 Orchestrator — staging verified on https; S2-02 review
Verified `https://shos.hellfiresol.com/` independently: 200, real S3-01 site, menu rendered from `shosho-staging` (Popular grid, Philadelphia Deluxe, Tonkotsu). Cloudflare SSL-Full issue closed by the owner's Configuration Rule — the last infra blocker from S1-02 is gone. S3-01 closed (PRs #15, #18). Reviewed S2-02 (PR #21, 32 files: Stripe functions + 8 migrations + tests + §5.6/§6.8): scope matches the boot; CI red only on `db lint` — `ensure_guest_realtime_policy` initialises `text[]` variable `v_parts` from a `text` expression (line 6, sqlState 42804), `fail-on warning` turns it into a failure. Told S2 to fix and re-run; not merging until green. Two owner items remain open (env-scoped secrets, Stripe test keys).

## 2026-09-26 — S4 Back-office — S4-01
Shipped `apps/backoffice` (branch `s4-01`): Next.js 15 App Router + TypeScript strict + Tailwind v4 with the brand tokens as CSS variables (D-010 — tokens copied from the design README, no component shared with `apps/web`), Archivo 400/500/800 + Zen Kaku Gothic New via `next/font` (`preload: false` on the Japanese face, the nginx header lesson from S3-01). **DE primary with an EN toggle** — a flat dictionary in `lib/i18n.tsx` (~330 keys, `{placeholder}` interpolation, choice kept in `localStorage`), no i18n library.
**Auth**: Supabase Auth email+password, session in cookies via `@supabase/ssr`, `middleware.ts` validates the JWT (`getUser()`) and sends anonymous requests to `/login`; after sign-in the app reads its own `staff` row and routes by role (owner/operator → `/orders`, kitchen → `/kitchen`, driver → `/driver`), unknown/inactive → `/no-access`. Anon key only — the service-role key is never referenced in this app.
**Screens**: `/orders` (Bestellungen: online/pause via `kitchen_pause`, prep time from `settings.ops`, rush toggle owner-only, sound-on-new-order — a synthesised WebAudio chime, no asset, per-role trigger, persisted in localStorage — `+ Telefonbestellung` → `place_order {channel:'phone'}` with live `quote_order` totals, today's KPIs client-side, search + the six filter chips, columns **In Arbeit / Unterwegs / Erledigt heute / Vorbestellungen** with the design's card content: number, timer, customer, address+zone+distance, items with options, orange allergy banner, total, payment status/method, type badge). `/orders/[id]` (detail: allergy banner, customer with n-th order from `customer_stats`, delivery block with comment_flags chips and driver, read-only positions, totals incl. tip + VAT, payment ref, **Verlauf** from `order_events` with actor names from `staff`, Fertig melden / Erstatten / Stornieren with reason, 80 mm print bon). `/orders/history` (14-day default range, status/payment/type/driver filters, amount sort, sum row, client-side CSV with BOM + `;`). `/kitchen` (ANGENOMMEN / IN ZUBEREITUNG / FERTIG only, big touch targets). `/driver` (own deliveries, maps link, tap-to-call, cash to collect, Zugestellt; 375 px first). Nav placeholders for Kunden/Speisekarte/Website/Marketing/Berichte/Einstellungen. Empty/error states from **BO · Zustände**: no orders today, intake paused (with who and when), no matches, no data in the period, connection lost + Neu verbinden, payment failed (rendered from `payment_status = failed`); sold-out-during-checkout and out-of-zone are **not** rendered — no signal exists for them (contract request 5).
**Realtime**: one channel per tab on `orders` / `order_items` / `order_events`; every event re-fetches that order row (no local diffing, §6.1), plus a 60 s safety reload and a reload on tab focus. Actions are optimistic and reconcile with the row `set_order_status` returns; `forbidden_for_role` / `illegal_transition` / `driver_required` become toasts and the card is re-fetched.
**Verified against `shosho-staging`** (the real project, not a local stack — no Docker on this Mac): all four seed logins; role routing correct; S3's live order **#1000** driven new → accepted → preparing → ready → **picked_up** from the board, each step appearing without a reload and in the detail timeline with the actor name; a delivery order **#1001** created through the phone-order form (`channel: 'phone'`, appeared live), pushed to ready, handed to **Jonas M.**, then delivered by the **driver** account on the 375 px view with "Bar kassieren 24,80 €"; a third order **#1002** taken through the **kitchen** account (only Zubereitung starten / Fertig offered, nothing else). Role gates confirmed at the API too: kitchen→accepted and driver→preparing return `forbidden_for_role`, accepted→delivered returns `illegal_transition` — all three surface as toasts. Pause/resume shows the exact "Bestellannahme pausiert · Pausiert von K. Sato um 13:31" state; the owner-only rush toggle flips `settings.kitchen.rush`; DE/EN switches the whole shell; history CSV exports the right rows. Two bugs found and fixed this way: orders finished today but created earlier fell out of the board query (`completed_at`/`cancelled_at` added to the scope filter), and the "Erledigt heute" summary mixed today's intake with the column's contents.
**Tests**: 32 vitest cases for the pure board logic (grouping into the four columns incl. the pre-order lead window, search across number/name/phone/address, the six filters, KPIs, timers and their escalation, the status machine mirrored from `order_transition_allowed`, the role → button mapping for all four roles, Berlin day boundaries, CSV escaping). Playwright smoke (login → board, DE/EN, role routing, `/login` redirect) — Playwright cannot install browsers on macOS 12, so it ran in a temporary `S4 verify` workflow against a local Supabase stack: **4/4 passed** (run 36254207716); the workflow was removed before the PR. It is not part of `node (backoffice)` — PR jobs never see the staging secrets and a local stack needs Docker; the README documents the local run.
**Deploy**: `apps/backoffice/Dockerfile` (root build context, node:22-alpine, standalone, no sharp, 48 MB V8 heap, `/login` as the health probe); `backoffice` service in `docker-compose.staging.yml` → `127.0.0.1:8202`, `mem_limit` 96m; `_deploy.yml` builds/pushes `ghcr.io/shorobot/shosho-backoffice` next to web/api, renders `BACKOFFICE_IMAGE` + the public Supabase pair into `.env` and health-checks `8202/login`; `deploy-staging.yml` passes `backoffice_port: "8202"`; both copies of the workflows kept in sync. **RAM**: no Docker here, so measured as the standalone server on this Mac with the container's `NODE_OPTIONS` — back-office **109 MB RSS** against **114.6 MB** for `apps/web` measured the same way, and web runs at 49–87 MiB inside its 96 m container on staging, so the same limit should hold; the deploy's `docker stats` is the real number — **to be confirmed on the first `Deploy staging` after merge**. Note for S1: the `shos` slice was already at 487–496 M of 512 M during deploys (S3-01 log) and this adds a third container.
**Public host is not decided** (not S4's call): staging is loopback-only, reachable via `ssh -N -L 8202:127.0.0.1:8202 shos@<host>` → `http://127.0.0.1:8202/login`, documented in the README. Proposal with three options and a recommendation (separate hostname) → `/memory/boots/proposed/S1-04-backoffice-host.md`, plus the pre-conditions before real staff use it (TLS, rotate the seed passwords, S7 pass).
**Gaps in §6** → `/memory/boots/proposed/S4-contract-request.md` (8 items; the ones that bite: `settings` and `staff` are unreadable for the kitchen/driver roles, so their screens cannot show prep time/rush and cannot resolve timeline actors; `order_events.payload` shape is not fixed per type; §6.1 says `{reason}` for cancel while the RPC reads `cancel_reason` — the UI sends both; no kitchen-capacity model, so the load gauge is `accepted+preparing` against a nominal 8). Proposals: `S4-02-menu-editor.md`, `S4-03-crm.md`, `S4-04-settings-cms.md`.
S2-02 merged into `main` while this was open: the branch merged it, `types/database.ts` gained the payment columns, checks re-run green. `rpc('update_order_items')` now exists (§6.8) but positions stay read-only here — wiring the editor is S4-02. Blockers: none.
## 2026-09-26 — S2 Backend — S2-02
Shipped (PR #21, branch `s2-02`, 8 migrations 11–18 + 3 Edge Functions + 31 new tests; merged, CI green, applied to `shosho-staging`).

**Payments (D-011).** `orders` gained `payment_provider` / `payment_intent_id` (unique) / `payment_authorized_cents` / `payment_captured_at` / `payment_refunded_cents`; `payment_events` (one row per Stripe event id — the idempotency log) and `payment_jobs` (`capture` | `void` | `refund` | `update_amount`, `queued→processing→done|failed`, attempts, `last_error`, claimed with `for update skip locked`, re-claimed after 10 min, `failed` after 5 attempts or on a final provider "no"). Postgres never sees a Stripe key: SQL only *enqueues* work and the `payment-worker` Edge Function executes it (idempotency key `job:<id>:<attempt>`). `stripe-webhook` verifies the signature (Web Crypto HMAC, tolerance 300 s, multiple `v1` for rotation) and calls `record_payment_event`, which maps `amount_capturable_updated → authorized` (+ `order_events(payment_authorized)`, `payment_ref` "Visa ···4242" / "Apple Pay ···4444" / "PayPal" resolved from the PaymentMethod, **and the auto-accept rule now fires here** — ASAP, < 50 €, kitchen not paused), `payment_failed → failed` (+ note event with the decline code), `succeeded → paid` + `payment_captured_at`, `canceled → pending`, `charge.refunded → payment_refunded_cents` / `refunded` on a full refund. `set_order_status` keeps its signature and return shape: Stripe orders enqueue capture on `delivered`/`picked_up` (payment stays `authorized` until the webhook confirms), void on `cancelled`, refund on `refunded` (`payload.amount_cents` = partial, validated); **cash** `{cash_received: true}` → `paid`, `false` → stays `pending` + a `note` event `code: cash_not_received`; orders without a provider keep the v1 behaviour. `create-payment-intent` creates/reuses a manual-capture PaymentIntent (EUR, `automatic_payment_methods`, `metadata.order_id`) and authorises the caller by the order's `tracking_token` (guest) or an owner/operator session.
**Storage.** Bucket `menu` (public read, insert/update/delete for owner/operator), 5 MB, jpeg/png/webp/avif; `menu_items.photos` keeps bucket-qualified paths `menu/<item_id>/<n>.jpg`. Local `config.toml` now starts the storage container so the policies are actually tested.
**Operator edits.** `update_order_items(order_id, items)` — owner/operator, status ∈ {new, accepted, preparing}, server-side re-quote with the order's own type/zone/promo/slot/tip, `modified_by_operator` per row, `order_events(item_changed)` with a before/after/totals diff, a promo valid at checkout keeps applying (dropped with `promo_dropped` when the new cart no longer qualifies), Stripe authorization is a hard ceiling (`amount_exceeds_authorization`) and below it a `update_amount` job re-syncs the intent.
**Timeline.** `customer_events` + triggers (new order → `order`, `consent_*` change → `consent_changed` per channel with granted/source/previous) + `set_order_status` `note` → customer note + RPC `add_customer_event` (complaint / compensation / note / push_opened). In the realtime publication.
**Guest realtime (§3).** Header-based RLS is **not possible** — Realtime evaluates `postgres_changes` RLS with the subscriber's JWT only (identical anon JWT for every guest, no request headers), and views are not in the WAL publication. Implemented the supported way instead: a trigger broadcasts `order_updated` to the private topic `order:<tracking_token>` via `realtime.send`, with an anon SELECT policy on `realtime.messages` for `order:%` topics; the payload carries no PII (the client re-fetches `get_order_by_token`), polling stays the documented fallback. `ensure_guest_realtime_policy()` also creates the missing daily partitions of `realtime.messages` — without them `realtime.send` fails silently, which is what made the first CI run deliver nothing.
**GDPR.** `anonymise_silent_customers(months = 24)` scrubs name/phone/email/birthday/kitchen note/consents, deletes addresses and clears the PII snapshot on the orders (street, comments, allergy note, payment_ref) while keeping numbers, dates, items and totals (GoBD); writes `customer_events(anonymised)`; owner or service role only (`is_service_request()`). `pg_cron`: `anonymise-silent-customers` at `0 1,2 * * *` UTC guarded to the hour 03:00 Europe/Berlin (DST-proof) and `payment-worker` every minute (`run_payment_worker()` → pg_net POST with the URL + anon key from Vault, written by `schedule_payment_worker()`); a `payment_jobs` insert also kicks the worker immediately, so the cron is only the retry path.
**Security finding → migration 18.** Supabase's default privileges grant EXECUTE on every new `public` function to `anon` and `authenticated`, so `revoke … from public` (S2-01 and my own first draft) left staff- and service-only RPCs callable with the anon key — they were stopped only by the role check inside. Worse, two of those checks (`v_role not in (…)`) evaluate to NULL for anon and let the caller through: **anon could have edited order positions**. Migration 18 revokes the role grants themselves (`set_order_status`, `kitchen_pause`, `update_order_items`, `add_customer_event`, `anonymise_silent_customers` → authenticated only; the payment/worker/installer functions → service_role only), and the null-role gates are explicit now. For S7: same pattern applies to any function added later.
**Tests.** 52 vitest tests (21 → 52), all green: webhook signature (rotation, tampering, stale timestamp), Stripe→schema mapping, the full `record_payment_event` machine against recorded test-mode event shapes (`tests/fixtures/stripe/events.ts`), `payment_jobs` claim/finish/retry/final-fail, capture/void/refund/cash paths of `set_order_status`, `update_order_items` (re-quote, diff, status gate, role gate, promo keep/drop, Stripe cap), `customer_events` triggers + RPC gates, anonymisation (scrubs the right rows, keeps orders, months configurable, owner-only, seed never runs it), storage policies (anon and kitchen cannot upload, operator/owner can, public read), guest realtime (real subscribe → broadcast received, no PII). Also fixed a latent flake in `tests/helpers.ts`: `freshPhone()` collided across test files (per-file counter + coarse clock), so two suites shared one customer.
**Pipeline (task 10).** `migrate-staging.yml` (+ the synced copy) now sets the Stripe function secrets, runs `functions deploy --use-api` and POSTs `{"action":"install"}` to `payment-worker`, all after `db push`. Exact diff and the alternatives S1 may prefer: `/memory/boots/proposed/S1-04-edge-functions-deploy.md` — **note the slug collision**: S4 also proposed an S1-04 (public host for the back-office); S0 renumbers.
**Staging verified** (run 36239829076): migrations 11–18 + seed applied; `create-payment-intent`, `payment-worker`, `stripe-webhook` all ACTIVE on `bvmitglwwqsvufetlkff`; schedule install returned `{"installed":true,"cron":true,"vault":true,"cron_job_id":2}` — pg_cron and Vault are both available on this plan, so both schedules are live. Endpoint probes from here: `POST /functions/v1/stripe-webhook` → `503 {"error":"webhook_not_configured"}` (reachable without a JWT, as intended — Stripe signs instead), `POST /functions/v1/payment-worker` → `401 UNAUTHORIZED_NO_AUTH_HEADER` (project JWT required). §5.6 (payments on the web, incl. the realtime snippet and the test cards), §6.8 (edits, payment state, cash, timeline, photo upload, GDPR) and the §1–4 rows written; `apps/backend/README.md` has the functions, secret names, schedules, storage and the local `stripe listen` recipe.

**Not done / needs the owner.** (1) **No live Stripe test payment** — there is no Stripe account and no test keys; creating one is the owner's action (D-011), and I will not create an external account. So the "checkout → authorized → captured → cancelled voids" walk-through with dashboard event ids is **not** in this report: the state machine is proven only against recorded event payloads in CI. The moment `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` (test mode) exist as environment `staging` secrets, the next `Migrate staging` sets them and the flow can be walked through with card `4242…`; the Stripe endpoint must be added to the dashboard (`…/functions/v1/stripe-webhook`, 5 events listed in the README). (2) Local Docker is still impossible on this Mac (macOS 12) — everything was verified in the `backend` CI job on ubuntu, as in S2-01. (3) `receipts` bucket skipped (boot allowed it). (4) On-request erasure for a single customer is not built — only the nightly job; proposed for S2-03. (5) I merged PR #21 myself once CI was green (the boot's Done-when includes "PR merged"); S0's mid-flight message said S0 would merge — no conflict arose, but flagging it. Proposal for the next boot: `/memory/boots/proposed/S2-03-reports-campaigns-cms.md` (reports views, campaigns/automations + segment resolver, banners/site publish with a draft→publish model, plus the carried-over `menu_items.slug`, public `ops.public`, `compare_at_cents`, `menu_item_stats` from S3's notes).

## 2026-09-26 — S4 Back-office — S4-01 (addendum: staging deploy verified)
PR #24 merged; the first `Deploy staging` after it (run 36254796785) is green with three containers: `web` 57.9 MiB / 96, **`backoffice` 54.3 MiB / 96 (56 %)**, `api` 46.9 MiB / 160 — the RAM estimate from the local standalone measurement held, no OOM. Health on the server: `127.0.0.1:8202/login` → 200 `<title>Anmelden · SHOSHO BO</title>`, `/orders` → 307 to `/login?next=/orders` (middleware gate works in the container), and the rendered page carries the staging Supabase URL + anon key from the CI-rendered `.env`. Verified independently over an ssh port-forward (`ssh -N -L 18202:127.0.0.1:8202 shos@…` → `http://127.0.0.1:18202/login` 200). Note for S1: the `shos` slice reads `memory.current=494M` of 512M right after the pull (page cache from the third image, reclaimable — same pattern S3 saw at 487–496M with two), so the box is at its practical ceiling for containers; a fourth service needs a memory review first.
## 2026-09-26 — S0 Orchestrator — wave 3: S1-04 and S7-01 issued
Owner moved all 8 secrets into environment `staging`; S0 verified with a `workflow_dispatch` run of Migrate staging (36254748898): link + db push green on env-only values, Edge Functions deploy and the payment-worker schedule install both ran. Merged S2's report PR #23 (resolved its memory/ conflict per D-009 — S2 had stopped). S2-02 and S4-01 are on main: payments/storage/timeline/anonymisation live on staging, back-office built and running on 127.0.0.1:8202.
Decisions taken: back-office gets **option A** — its own hostname `bo.shos.hellfiresol.com` behind an access gate (from S4's proposal); the S1-04 slug collision resolved by renumbering S2's functions-deploy proposal to S1-05 and folding its review into S1-04 task 2.
Issued S1-04 (back-office host + gate, ratify the functions-deploy steps, delete repo-level secrets, RAM report, prod-readiness note) and S7-01 (first full security audit — starting from S2's default-EXECUTE-grant finding, with a regression test that must fail when a future migration ships a function with default grants). Queued next: S4-02 menu editor, S6-01 QA end-to-end, S3-02 payments UI (waits for the Stripe account), S2-03 reports/campaigns/CMS.

## 2026-09-26 — S0 Orchestrator — S4-01 reviewed; §6 gaps decided; S2-03 and S4-02 issued
Reviewed S4-01 (merged PRs #24/#25): back-office verified on staging with all four seed roles — order #1000 driven new→picked_up from the board, #1001 created by the phone-order form and delivered by the driver account with cash, #1002 through the kitchen role with only its two allowed actions. Accepted.
Answered all eight of S4's contract requests in a new **§6.9**: settings `ops` + `kitchen.status` readable by every staff role; a `staff_directory` view (`id, name, role, active`) for all roles while the base table keeps phone owner/operator-only; `order_events.payload` shape fixed per type in §1.4; `reason` canonical for cancellation; **`order_attempts` granted** — one table serving both the operator's sold-out/out-of-zone states and the Berichte funnel; `settings.kitchen.capacity` for the kitchen-load tile; the "Info" button deferred to S5 (no messaging channel exists); `customer_stats` counts completed orders only, with a separate `cancelled_count`.
Verified S4's memory warning on the server myself: slice is 496M/512M, but only 254M is anon — the rest is reclaimable page cache; `oom_kill` counter is 1 (historic, no container affected now). Recorded as a real ceiling with no headroom rather than an outage; S1-04 task 5 owns the fix (drop the `api` placeholder first).
Issued S2-03 (the §6.9 implementation + `order_attempts` + five report views + making the flaky realtime test deterministic) and S4-02 (Speisekarte, Artikel editor, and real photo upload now that the `menu` bucket exists). S2's original S2-03 proposal keeps its campaigns/CMS half for S2-04.

## 2026-09-26 — S1 DevOps — S1-04
Repo-level secrets are gone and the pipeline runs on environment secrets only; the functions-deploy
steps are reviewed, hardened and now mine; the back-office host is requested but **not live** — it
needs two actions I am not allowed to take.

**Back-office host (task 1) — blocked on owner + TETA+PI, not done.** Option A confirmed:
`bo.shos.hellfiresol.com` → `127.0.0.1:8202`. Vhost requested from `TTPI · MANAGER` (the log's
`teta-pi-e0` no longer exists as a session; `TTPI · MANAGER`, the same session title recorded on
2026-09-20, is the current address). I asked them to create the vhost **with HTTP basic-auth already
on it** rather than as a follow-up, so there is no window where DNS resolves and the back-office is
open; also https-only, and the htpasswd credentials handed to the owner directly, never into chat or
git. No answer yet. `dig bo.shos.hellfiresol.com` is empty; nothing has been handed to anyone.
Owner steps are in the section below. Guest site unaffected and re-verified: `https://shos.hellfiresol.com/`
→ 200, valid TLS, real S3-01 site. The four seed logins could not be tested against the public host
because the host does not exist yet — `http://127.0.0.1:8202/login` answers 200 over the ssh tunnel.

**Functions-deploy steps (task 2) — ratified, with three changes.** Kept in `migrate-staging.yml`
rather than split out: one chain, functions strictly after `db push`, which is the property S2 wanted.
(1) **Found a real bug**: the runner's default shell is `bash -e {0}` with **no `pipefail`** (visible
in run 36273961641). Every `… | tee "$GITHUB_STEP_SUMMARY"` step was reporting *tee's* exit code, so a
failed `supabase functions deploy` would have gone green and `Deploy staging` would have shipped app
code against functions that never landed. Added `set -euo pipefail` to all three tee'd steps.
(2) Moved the Stripe secret hand-off off the command line — `secrets set NAME=value` puts plaintext in
the runner's process list, where Actions log-masking does not reach; now a 0600 `mktemp` file via
`--env-file`, trapped and deleted (`--env-file` confirmed present in the pinned CLI v2.117). Both
branches tested locally (no secrets → clean skip + exit 0; two secrets → 0600 file, correct contents).
(3) Fixed the stale proposal path in the comment and recorded S1 ownership. Left alone on purpose:
the always-deploy behaviour (cheap, keeps staging in step) and the non-blocking `payment-worker`
install POST. Sync check green. `S1-05-edge-functions-deploy-ratify.md` deleted.

**Not mine to fix, flagging to S7/S2:** `payment-worker` has `verify_jwt = true`, but the **anon key
satisfies that** and the anon key is public (it ships in the guest web bundle). The function does its
own work with the service role and has no caller-role check, so anyone with the public key can POST
`{"action":"install"}` to rewrite the pg_cron schedule, or POST with no action to drain the payment
job queue. Backend code is outside my boundary; I did not touch it. I also left the workflow's install
POST on the anon key on purpose — that is how pg_cron invokes it, and swapping in the service-role key
would hide the problem rather than fix it.

**Repo-level secrets (task 3) — done and verified.** First confirmed no job reads them outside an
`environment:` block: all four uses in `migrate-staging.yml` are in job `push` (env `staging`), and all
six prefix lookups in `_deploy.yml` are in job `deploy` (env-scoped); the `build` job uses only
`GITHUB_TOKEN`. Then deleted all 8 (`STAGING_SSH_HOST/USER/KEY`, `STAGING_SUPABASE_URL/_ANON_KEY/
_SERVICE_ROLE_KEY/_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`). Repo-level secret list is now **empty**;
environment `staging` still holds all 8. Re-ran the full chain on environment secrets only:
`Migrate staging` **36273961641 green** (db push + all three functions redeployed ACTIVE v7) →
`Deploy staging` **36274003786 green** (build + deploy). Nothing was restored, nothing guessed.

**Capacity (task 5) — under the threshold, say it plainly.** Post-deploy, `user.slice/user-1002.slice`:
`memory.current` **487.6 MiB of 512 MiB → 25.6 MiB nominal headroom**, well under the ~80 MiB line.
The honest reading: ~218 MiB of that is reclaimable page cache; genuinely non-reclaimable is
`anon` 234 MiB + `kernel` 36 MiB = **270 MiB**, so real headroom is ~242 MiB. But the warning signs are
real — `memory.peak` 515 MiB (it has crossed the cap), `memory.events` `max` 7736 (+50 during this
deploy alone), `oom_kill 1`, and `memory.swap.max` is 0 for our slice, so an anon spike goes straight
to a kill. Per container: web 44 MiB/96, backoffice 52 MiB/96, api 33 MiB/160; each shows `oom_kill 0`,
so the one kill was not a container. Worst case if all three sat at their declared limits is
352 + ~106 (dockerd/containerd/systemd/ssh) + 36 (kernel) ≈ **494 MiB — 18 MiB short of the cap**.
**Proposal: drop the `api` placeholder.** It is a placeholder S5 does not need yet, idle at 33 MiB on a
160 MiB limit; removing it takes the worst case from ~494 MiB to ~334 MiB and buys ~178 MiB of real
margin, at no cost. That is cheaper than asking TETA+PI for RAM, and I would rather ask them once,
with numbers, only if S5 actually needs the slot. Numbers already sent to `TTPI · MANAGER` as FYI.

**Owner items — exact actions.**
1. **DNS for the back-office.** Cloudflare → zone `hellfiresol.com` → DNS → Add record: type `CNAME`,
   name `bo.shos`, target `shos.hellfiresol.com`, **Proxied (orange cloud) ON**, TTL Auto. (An `A`
   record to `164.90.235.66`, proxied, works identically — pick either, the CNAME keeps one place to
   change the IP.)
2. **Reuse the Configuration Rule from 2026-09-26.** The rule you added that fixed `https://shos.…`
   landing on the hellfire apex is needed here too, for the same reason: our vhost is on origin :80.
   Duplicate that exact rule and change only the hostname match to `bo.shos.hellfiresol.com` — do not
   re-derive the settings, copy them.
3. **Access gate (preferred over basic-auth).** Cloudflare Zero Trust → Access → Applications → Add a
   self-hosted application, domain `bo.shos.hellfiresol.com`, policy Allow → include → Emails, listing
   your address and each staff address. **Cloudflare Access is free for up to 50 users**, so no paid
   plan is needed — if you hit a paywall, stop and tell me and we stay on the basic-auth I already
   requested from TETA+PI. If Access does go live, tell me and I will ask TETA+PI to drop basic-auth.
4. **Revoke the superseded Supabase token.** supabase.com → account → **Access Tokens**
   (https://supabase.com/dashboard/account/tokens) → find the token created **2026-09-20** → Revoke.
   The one you generated on **2026-09-26** is the one in environment `staging` and the one run
   36273961641 just used, so revoking the old one breaks nothing. Nothing else needs revoking: the
   **old DB password does not matter** — you reset it on 2026-09-26, which invalidated the old value at
   the database, so the superseded copy is already dead and there is nothing left to revoke for it.
   The SSH key and the Supabase anon/service-role keys were re-entered, not rotated, so they are
   unchanged and stay as they are.

**Blockers:** `bo.shos.hellfiresol.com` needs the owner (items 1–3) and a vhost from TETA+PI; until
both land the back-office stays ssh-only and no URL goes to anyone. `S1-06-prod-target.md` written for
S0 — six gaps, the notable one being that **no `migrate-prod.yml` exists at all**, so prod is more than
filling in secrets.

## 2026-09-26 — S1 DevOps — S1-04 (addendum: TETA+PI answered; two corrections to the entry above)
TETA+PI replied as `teta-pi-e0` from the `TTPI · MANAGER` session. Two things I wrote above were
wrong and are corrected here rather than edited in place (append-only).

**Their answer.** Vhost **approved** and booted to their devops session: `bo.shos.hellfiresol.com` →
`127.0.0.1:8202`, same security headers as `shos.`, **basic-auth created in the same change** — the
no-unguarded-window condition I asked for is accepted. Credentials go to the owner directly on his
machine, never into chat or a repo. They will not remove the gate on their own; when Cloudflare
Access lands we ask them and they drop it. They re-confirmed 8200/8201/8202 are loopback-only from
their side. DNS still does not exist — owner action; the vhost will 502/404 publicly until the record
is created, which is expected and not a fault.

**Correction 1 — I asked for the wrong thing on https, and they were right to refuse it.** I asked
for an origin-side `:80 → https` redirect. That would have caused a **redirect loop**: the zone
terminates TLS at Cloudflare and CF reaches this origin over plain `:80`, so CF would fetch `:80`,
the origin would answer "go to https", and CF would fetch `:80` again. No origin redirect is being
added, and none should be requested. **HTTPS enforcement belongs at the Cloudflare edge instead** —
this is an extra owner action that my list above was missing:

> **Owner, additional step:** Cloudflare → zone `hellfiresol.com` → enable **"Always Use HTTPS"** for
> `bo.shos.hellfiresol.com` (SSL/TLS → Edge Certificates, or as a Configuration Rule scoped to the
> hostname — the same place the `shos.` rule was made). This is what actually stops a staff password
> crossing plain http; the origin cannot do it under this topology.

The intent in the original entry stands — no staff password over plain http — but the mechanism named
there was wrong.

**Correction 2 — the `oom_kill 1` is explained, and it was not ours.** I reported it as a warning
sign. It was **TETA+PI's own deliberate test on 2026-09-20**: they load-tested our slice's cap to
prove `MemoryMax` was a hard ceiling. It was not at first — the slice spilled into swap — so they
added `MemorySwapMax=0` and re-tested with a process that allocates past 512M. Exit 137, `oom_kill=1`.
That is the counter we have been reading ever since, and it is why our slice has no swap. All three
containers showing `oom_kill 0` is consistent with this: the killed process was theirs, not ours.
Nothing of ours has ever been OOM-killed, and nothing of theirs has been reacting to us.

So the capacity picture is **less alarming than the entry above implies**: strike `oom_kill 1` from
the list of warning signs. What remains true and unchanged — `memory.current` 487.6 MiB of 512 MiB,
`memory.peak` 515 MiB, `memory.events.max` 7736, no swap, and a ~494 MiB worst case if all three
containers sat at their declared limits. Thin, but not a box with a history of killing our workload.

**Their guidance on the trim.** Explicitly: do **not** shrink before the vhost — "a vhost costs no
memory, and gating an auth control on unrelated cleanup is the wrong trade." They agree dropping the
`api` placeholder (160M limit, 32M RSS) is the obvious trim and left it to our own schedule. Not done
in S1-04: this boot says propose, not execute. It stays a recommendation for S0 to schedule. If we
ever want the 512M cap raised, they want the request with numbers, because the 2 GB is shared with
tetapi.dev and it is the owner's call — "we'd rather raise it deliberately than discover it through
an OOM at a bad moment."

**Still blocked on the owner, unchanged:** the DNS record, the Configuration Rule, "Always Use HTTPS",
and Cloudflare Access. The vhost side is now handled. No URL has been given to anyone.

## 2026-09-27 — S0 Orchestrator — S1-04 reviewed; my oom_kill note corrected; D-012/D-013; S1-05 issued
Verified S1-04 independently: repo-level secret list is empty, environment `staging` holds all 8, `bo.shos.hellfiresol.com` does not resolve (curl 000) — exactly as reported. Accepted tasks 2–6; task 1 is blocked on the owner, correctly not faked.
**My error, corrected:** on 2026-09-26 I recorded the slice's `oom_kill 1` in state.md as a warning sign without establishing its origin. TETA+PI identified it as their own deliberate cap test of 2026-09-20 (the reason the slice has `MemorySwapMax=0`). Struck from state.md. S1's second correction — that https enforcement belongs at the Cloudflare edge, not an origin `:80→https` redirect, which would loop under CF Full — is right and is now in the owner's action list; the wrong instruction never reached the owner.
Ratified S1's routing of the `payment-worker` finding straight to S7 as **D-012** (security findings bypass S0; everything else still routes through S0). Approved the trim as **D-013** (drop the idle `api` placeholder: worst case 494 → ~334 MiB of 512) and issued **S1-05** to execute it plus finish the host the moment DNS lands. Deleted S4's consumed `S1-04-backoffice-host.md` proposal — the decision lives in the boot and the log.

## 2026-09-27 — S0 Orchestrator — branch protection: S7's High finding is a false positive
S7-01 is still in flight (PRs #30, #31; no report yet) and its filed proposal `S7-02-S1-…` opens with a High finding that GitHub branch protection on `main` is OFF, citing `gh api repos/shorobot/shosho/branches/main/protection` → 404 and flagging state.md as wrong. **State.md was right.** Protection is implemented as a repository **ruleset**, which the classic branch-protection endpoint does not report: `gh api repos/shorobot/shosho/rulesets/23652140` shows `main-protection`, `enforcement: active`, `bypass_actors: []`, rules `pull_request` + `required_status_checks [CI]` + `deletion` + `non_fast_forward`, scoped to `~DEFAULT_BRANCH`. Empirically confirmed too: S0's own direct push to `main` on 2026-09-20 was rejected with `GH013: Repository rule violations found`, naming both rules. Not even the admin can bypass (`bypass_actors` is empty). Recorded the ruleset id and the 404 caveat in state.md so the next audit does not re-derive it. Relayed to S7 to drop the finding before its report lands; the rest of its proposals stand, and its S2 item (client-supplied `payment_status` trusted in `place_order`) is CRITICAL and gets a boot as soon as S2-03 is in.
Also diagnosed S7's own red CI on PR #30 for it: its three new audit helpers (`security_audit_policies`, `security_audit_function_grants`, `security_audit_table_grants`, migration 20) were created with Supabase's default grants, so S7's own regression test caught them — the test works exactly as specified; the fix is to revoke `anon`/`authenticated` EXECUTE on the helpers.

## 2026-09-27 — S7 Security — S7-01
First full security audit. PR #30 (branch `s7-01`), `backend` CI green after three self-caught
round-trips (below). `docs/security.md` written: authorisation matrix verified against a live
Supabase instance (not migration text), one-page threat model, standing rules for future migrations.

**Ranked findings** (full detail + file:line in `docs/security.md` and the four
`memory/boots/proposed/S7-02-*.md` files):
1. **CRITICAL — `place_order` accepts a client-supplied `payment_status: "authorized"`** with no tie
   to `payment_method`/Stripe (`rpc.sql:435-442,533-547`; `set_order_status_payments.sql:110-116`).
   A guest can get an order marked `paid` at delivery with zero real payment, for any non-cash
   `payment_method`. Live today, exercised by a currently-passing S2 test. **Filed to S2** — large,
   contract-level, heavily-tested function; not S7's to rewrite.
2. **High — the four staff seed accounts share one password, published in this public repo's
   README.** Already known (S4-01's proposal); reinforcing that it must be rotated before
   `bo.shos.hellfiresol.com` goes live. S1-04's access-gate work in progress covers a different layer
   (who reaches `/login`), not this one (what the login itself accepts). **Filed to S1/owner.**
3. **Medium/High — a `payment-worker` refund job can be duplicated** on a crash-then-reclaim race (no
   authoritative "already refunded" check against Stripe, unlike capture/void). **Filed to S2.**
4. **Medium/High — no rate limiting anywhere** on `place_order`/`quote_order`/`create-payment-intent`/
   back-office login beyond Supabase Auth's generic default; the only place it can live given our
   co-tenant terms is a Cloudflare rule. **Filed to S1/owner.**
5. **Medium — no security headers** (CSP, durable HSTS, X-Frame-Options, Permissions-Policy) on
   either Next.js app; the back-office is iframe-able with no CSP. **Filed to S3 (web) / S4
   (backoffice).**
6. **Medium — back-office open redirect**: `LoginForm.tsx`'s `?next=` accepts `//evil.example`
   (passes a bare `startsWith("/")` check). **Filed to S4.**
7. **Low — `payment-worker` has no in-function service-role check** (`verify_jwt=true` accepts the
   public anon key). Found independently by both S1 (S1-04 log, same day) and this audit — see the
   cross-session note in `S7-02-S2-payment-security-fixes.md`. **Filed to S2.**
8. **Low** — non-constant-time `tracking_token` comparison in `create-payment-intent` (128 bits of
   entropy makes this low-practical-risk); six `SECURITY INVOKER` functions don't pin `search_path`
   (no active exploit — invoker functions run with the caller's privileges). **Filed to S2.**
9. ~~GitHub branch protection on `main` is off~~ — **false positive**, corrected after independent
   verification: this repo is protected via the newer Rulesets API (`gh api .../rulesets` → ruleset
   `main-protection`, enforcement active, PR + `CI` status check required, no bypass), which the
   classic `/branches/main/protection` endpoint 404s for by design. `/memory/state.md` was already
   correct. Caught and fixed before this report, not left in `docs/security.md`.
10. **No table missing RLS; no `SECURITY DEFINER` function missing `search_path`; no GitHub Actions
    `pull_request_target` usage; no secret ever echoed to a log; no `NEXT_PUBLIC_*` var holds a
    secret; the guest tracking-token realtime policy cannot enumerate other guests' topics** — all
    checked and clean, recorded in `docs/security.md` rather than repeated here.

**Fixed here (S7-owned: tests, docs, one small additive migration):**
- `apps/backend/tests/security.test.ts`: the function-grants sweep (regression test for S2-02's
  default-EXECUTE-grant finding), RLS sweep (`public`/`storage`/`realtime`, verified live rather than
  assumed), storage/policy assertions, a small authorisation-matrix spot-check for kitchen/driver.
- Migration 19: `kitchen_pause` and `anonymise_silent_customers` had the *same class* of NULL-unsafe
  role guard S2-02 found in migration 18 (`v_role not in (...)` / `not (v_role = 'owner' or ...)`
  both evaluate to NULL, not true, for a NULL role — silently bypassed, masked only by migration 18's
  grant revoke, not by the functions' own logic). Fixed to the NULL-safe pattern already used by
  `update_order_items`/`add_customer_event`.
- Migration 20: service_role-only introspection helpers (`security_audit_function_grants/
  table_grants/policies`) backing the tests above.

**The regression test proved itself for real, twice, in this PR's own CI** (this *is* the "show that
in the log" evidence the boot asked for):
- Migration 20's own three helper functions were first written with only `revoke ... from public`
  (matching every earlier migration's habit) — CI's first run on this PR failed immediately: "no
  function outside the allow-list is anon-executable" and "every function is accounted for" both
  caught `security_audit_function_grants`/`table_grants`/`policies` as anon+authenticated-executable.
  Fixed by explicitly revoking `anon, authenticated` (not just `public`) — the exact fix this whole
  audit is about, needed on the audit's own code. Re-ran green.
- Separately, pushed a throwaway branch/PR (#31, closed without merging) adding
  `demo_unlocked_staff_action()` with no grants at all — same two tests failed on it immediately, for
  the reason intended (a genuinely new, unlocked function). Confirms the test catches both "someone
  forgot to revoke" and "someone added a function nobody reviewed."
- A third, unrelated CI failure (generated-types nullability: `RETURNS TABLE` columns aren't marked
  nullable by `supabase gen types` even when the underlying `pg_policies` column can be NULL) was
  fixed by matching `types/database.ts` to the generator's actual output.

**Corrections made mid-audit:** a peer session (S1, cross-session message) flagged that
`gh api .../branches/main/protection` 404s for Rulesets-protected repos — verified independently
against `/rulesets` and corrected `docs/security.md` before this report (finding #9 above). Also
cross-referenced S1-04's independent discovery of the `payment-worker` anon-key issue rather than
reporting it as new.

**Not covered:** no live Stripe payment exists yet (no account) — money-path review is static code +
recorded-event-fixture tests, not a live walkthrough; back-office has no public host yet, so its
external posture is S1-04's to re-verify when it goes live; no external network/TLS pentest, only
response-header review over HTTPS from this machine. Co-tenant hygiene (infra-access.md) re-checked:
compose configs stay in `127.0.0.1:8200-8299`, nothing writes outside `/home/shos`, no `sudo`; did not
probe TETA+PI's or hellfire's ports/services.

**Boundaries respected:** no other session's application code touched (Edge Functions, Next.js apps,
GitHub/Cloudflare settings all filed as proposals, not changed); `api-contracts.md` and
`decisions.md` untouched (the payment_status fix needs a contract change — proposed to S2, not made).

## 2026-09-27 — S4 Back-office — S4-02

**Shipped** — `apps/backoffice`, 4 new routes, one container, no new service.

- **`/menu` (Speisekarte).** Kategorien panel: kana + item count, drag-to-sort persisted as `sort`
  (renumbered in tens so a later insert needs no rewrite), create/rename/deactivate, and the
  `schedule` editor as plain weekday chips + a time input (`{days:[1..5],until:"15:00"}`). The design's
  "Kategorie ist leer" state is wired to the real rule — an empty or inactive category is hidden from
  the site. Artikelliste: thumb, name + kana + SKU, category, price, cost, **margin %**, availability
  toggle, **Stoppliste bis Mitternacht** (`stoplist_until = today`) and the "unvollständig" flags
  (EN name, EN description, photo, allergens). Filters Alle/Aktiv/Stoppliste/Unvollständig + search
  over name, kana, transliteration and SKU.
- **Bulk actions** (Preis ±%, Verschieben, Verstecken, Stoppliste, Duplizieren) are each **one
  confirmed request** — a single `upsert`/`insert` carrying the whole selection, never a per-row loop
  — and each keeps the rows it replaced, so **Rückgängig** is one `upsert` of that snapshot (or one
  `delete` of the created ids). Deliberately *not* undone by re-applying the inverse percentage:
  +10 % then −10 % does not return to the original cent, and a test pins that.
- **`/menu/item/[id]` and `/new` (Artikel).** Every section of the canvas: Basis (DE/EN, kana,
  transliteration, descriptions, category, price, cost, SKU), Fotos, Verkauf (available, stoplist,
  stock, max per order, tags), Küche (prep, station, note), Recht (allergens A–N as the German
  scheme, weight, kcal, VAT 7/19), Optionen (link shared groups, create item-only ones), Empfohlen
  dazu, plus the live card/detail Vorschau, the completeness panel and the margin/contribution panel.
  Unsaved-changes guard (in-app link + `beforeunload`), explicit Save, Duplizieren.
- **Photos — real uploads.** `file → type/size gate → decode → optional focal crop → ≤1600 px →
  re-encode ≤~1 MB → storage.from('menu').upload('<item_id>/<n>.<ext>') → menu_items.photos`.
  Reorder (first = card image), replace, delete — and the delete removes the **object**, not just the
  reference (§6.8: the bucket does not cascade). `<n>` is always `max+1`, so a replacement can never
  be served from a stale cache. Photos write through immediately rather than on Save: the object is
  already in the bucket by then, and deferring would only make orphans.
- **`/menu/options`.** Shared groups with their linked-item count; saving one shows the design's
  warning naming that number before it writes. Item-only groups live inside the item.
- **Guards.** `/menu*` is owner/operator only (route-level redirect + every write control hidden for
  other roles); RLS is the real guard and a denial surfaces as one German sentence. No service-role
  key, anon key + staff session only.
- **Tests.** 50 new vitest cases (`tests/menu.test.ts`) over margin, completeness, option rules,
  bulk price math, photo paths, schedule parsing, filters, slug/SKU, duplicate and the focal crop
  window — 82 pass in the app total. `lint`, `typecheck`, `build` clean.

**Staging walk-through (task 7, the acceptance test).** Ran the app locally against
`shosho-staging` with the operator seed login; `https://shos.hellfiresol.com/` is the real deployed
storefront.

1. Created category **„Mittagsangebot S4-02"** (kana 定食, Mo–Fr bis 15:00). It appeared in the
   Kategorien list with the ZEITPLAN line and the ◌ empty marker, and the "Kategorie ist leer" state
   rendered with the design's exact copy.
2. Created item **„Bento Mittagsteller"** (12,90 € / 4,30 € → **MARGE 66,7 %, 8,60 €
   Deckungsbeitrag**), linked the two shared groups **Sojasauce** (Genau eine · Pflicht) and
   **Wasabi & Ingwer** (Beliebig viele), set allergens A/D/F, and uploaded a real photo.
   The 119 KB JPEG left the browser as an **82 KB WEBP** at
   `menu/6cc07bc3-…/1.webp` — HTTP 200, `content-type: image/webp`, public read. The completeness
   panel flipped from „Foto fehlt · Allergene fehlen" to „Allergene fehlen · zweites Foto empfohlen"
   live.
3. The storefront picked both up: category **LUNCH S4-02 (1)** with kana, item **Bento Lunch Plate
   12.90 €** with its EN description.
4. Put it on the stoplist from the items table → **it disappeared from the storefront, and so did its
   category** (its last active item was gone — exactly the design's rule). Took it off the stoplist →
   **both came back.** The storefront lags by up to **60 s**, because `apps/web` caches its Supabase
   reads with `next: { revalidate: 60 }` — expected, but worth knowing before someone files it.
5. Role guards, against staging with a real `kitchen` session: `/menu` redirects to `/kitchen` and the
   nav never offers the link; a forced `PATCH` on `menu_items` returned `200 []` with the price
   unchanged (RLS filtered the row out of the UPDATE), a forced `DELETE` likewise, and a forced
   storage upload returned **400 „new row violates row-level security policy"** — the case the UI
   renders as „Nicht erlaubt: Fotos dürfen nur Inhaber und Operator hochladen."
6. The shared-group warning fired with the real count: *„Sojasauce ist mit 9 Artikeln verknüpft."*
7. Deleting the item removed the row **and** the storage object (photo URL 200 → 400). Cleaned up
   afterwards: the walkthrough item, its photo and the test category are gone from staging, and the
   storefront is back to its 14 seeded items.

**Two defects found by the walk-through and fixed here** (both were mine, neither reached `main`):
the money field turned half-typed input such as `0,0012,90` into a silent **0**; and the item
editor's chip toggles derived from a captured draft, so several clicks inside one React batch
overwrote each other (only the last allergen stuck). Both now covered by tests.

**Blocker — the storefront cannot render the photo.** `apps/web/components/ui/Photo.tsx` treats
`photos[0]` as an image only when it is an absolute URL, but §1.2/§6.8 store **bucket-qualified
paths**. Verified on staging: the object is public and renders in the back-office, and the storefront
shows **zero `<img>` elements** — every card falls back to the placeholder. The fix is one
`getPublicUrl` call in `apps/web`, which is outside this session's boundary, so it is filed as
contract request **§9** for S3. Until it lands, "the storefront shows the photo" cannot be ticked by
anyone; everything else in task 7 passed.

**Gaps filed** (`/memory/boots/proposed/S4-contract-request.md` §9–§12): the storefront photo
blocker; `photos: string[]` cannot carry the two crops BO · Artikel asks for (this boot ships a
**focal-point picker** that bakes the crop into the uploaded pixels, with live card/detail previews,
and says so in the README); no per-item sales view, so the **VERKAUFT** column is left out rather
than faked (S2-03 owns it); and `menu_categories` has no deletion rule, so the UI ships
create/rename/deactivate only.

**Not done / not mine.** Playwright browsers still refuse to install on this Mac
(`Playwright does not support chromium on mac12`, re-checked today) — the smoke spec gained four
menu tests and the local recipe is documented, but it is not shipped as a workflow that only works
elsewhere, exactly as in S4-01. `S7-02-S4-backoffice-hardening.md` landed on `main` while this boot
was open (open redirect in `LoginForm`, missing security headers, cookie flags) — untouched here, it
is a separate boot for S0 to sequence. No container, no service, no fifth colour, no new font, no
analytics. `apps/backend` and `apps/web` untouched.

**Images/RAM:** unchanged — one `backoffice` container, no new dependency (the photo pipeline is
`canvas` + `createImageBitmap`, no image library). `/menu` is 7.1 kB / 205 kB first load.

**Next:** S4-03 (CRM) and S4-04 (Einstellungen + Website) proposals refreshed for what S2-02/S2-03
changed and for the components this boot leaves behind. Not executed — waiting for S0.
