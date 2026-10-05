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

## 2026-09-27 — S0 Orchestrator — S7-01 merged; S2-04 issued; D-014
Merged S7-01 (PR #30). The audit is the strongest report this project has produced: findings verified against a live catalogue rather than migration text, the regression test proved itself twice in its own CI (first on S7's own helper functions, which shipped with the default grants the audit exists to catch, then on a throwaway PR #31 adding an unlocked function), and S7 caught and struck its own branch-protection false positive after S0's correction rather than leaving it in `docs/security.md`.
Finding 1 is CRITICAL and live: `place_order` accepts a client-supplied `payment_status`, so a guest can have an order marked paid without paying. Issued **S2-04** ahead of everything else in S2's queue — it also carries the refund-reclaim double-issue, the `payment-worker` anon-key gap (found independently by S1 and S7), the small `search_path`/constant-time items, and the renumber + lint fix that `s2-03` needs. Recorded in state.md that no live Stripe account may be connected until it lands.
**D-014** after finding that `s2-03` and `s7-01` both created `20260926000019`/`...020`: Supabase keys applied migrations on the numeric prefix, so a colliding second file is silently skipped — a schema that looks migrated and is not. The second PR to merge renumbers; S1 should teach the `plan` job to catch duplicates.
Also routed: S7's four `S7-02-*` proposals — S1 gets rate limiting + staff password rotation, S3 gets web security headers, S4 gets the open redirect + headers + cookie flags. Those become boots after the current round.

## 2026-09-27 — S2 Backend — S2-03

Closed all eight §6.9 contract gaps S4-01 hit, added the rejected-checkout feed, shipped the Berichte
reports. PR #34 → `main`. Migrations **21–24** (19/20 went to S7-01 in the same hour — see the clash
below). `backend` CI green.

**Role access (§6.9 rows 1–2, 6).** `settings` now has three tiers instead of two:
`settings_public_keys()` (anon), `settings_staff_keys()` = that **plus `ops`** for every authenticated
staff role, and `payments` / `kitchen` staying owner/operator. The kitchen board finally reads
`prep_default_min`, `rush_extra_min` and `preorder_max_days` directly instead of inferring them.
`business` needed **no split** — it holds imprint data only (name, address, phone, email, impressum,
ust_id), all of it legally public, which is why it is anon-readable in the first place; what S0's "the
private half of `business`" really needs is the *rule*, now written in the README and the contract:
billing, payout or credential fields go into `payments` or a new private key, never into `business`.
View `staff_directory` (`id, name, role, active`) for every staff role, explicit column list, base
table untouched — so `staff.phone` stays owner/operator and a column added to `staff` later cannot
leak through the view. `settings.kitchen.capacity` landed as field `capacity` on the **public** key
`kitchen.status` (default 8), because the kitchen role has to read it and the private `kitchen` key
does not qualify; `kitchen_pause()` now merges that value instead of replacing the whole row.

**Event payloads (§1.4, §6.9 rows 3–4).** Every type writes what §1.4 documents.
`handed_to_driver` resolves `driver_name` from `staff`; `cancelled` carries `reason`; `refunded` an
`amount_cents` that is never null; `created {channel}`; `payment_authorized {payment_ref, provider,
amount_cents}` in all three writers (`place_order`, `record_payment_event`, the trigger path).
The keys the trigger cannot see — `station`, `cash_received`, `amount_cents` — are handed over by
`set_order_status` in the transaction-local GUC `shosho.status_payload`, which the trigger consumes
**and clears**, so a second status change in one transaction cannot inherit them (there is a test for
exactly that). `reason` is canonical and wins when a client sends both; `cancel_reason` is still
accepted, is still the column name, and is still mirrored into the payload for one release.
**No backfill** — rows written before today keep their old payloads, which §1.4 already requires
consumers to tolerate and the back-office already does.

**`order_attempts` (§6.9 row 5) — one writer, not two.** Table + RLS + `record_order_attempt(payload)`
for `anon`, rate-limited to `settings.ops.attempt_rate_limit_per_min` (default 20) per `session_hash`
per minute. PII-free **by construction**: no PII column exists, `items` is `[{item_id, qty}]` enforced
by a CHECK constraint (`order_attempt_items_ok`) and not merely by convention, `problems` is filtered
to the §5.2 keys, and the RPC rebuilds both arrays from scratch so anything extra a client sends is
dropped before the insert runs. `anon`'s table grant is revoked outright and there is no insert
policy at all.

> **The one thing in this boot that is not implementable as specified.** §6.9 row 5 (a) asks
> `place_order` to record a refusal *automatically*. It cannot: PostgREST runs one transaction per
> request and `place_order` rejects with `raise exception 'order_rejected'`, so any row it inserted
> first is rolled back with the error. Postgres offers no autonomous transaction on this stack —
> `pg_net`, `pg_cron` and `pg_notify` all enqueue transactionally, and `dblink` would mean storing a
> DB password in Vault for one insert. The alternative was changing `place_order` to return
> `{ok:false, problems}` instead of raising, which is a §5.3 contract change that would break the
> live guest site — S0's call, not mine. **Shipped instead:** the RPC is the single writer and
> `place_order`'s error now carries `hint = '… record it with rpc record_order_attempt'`, so the
> client turns the `problems[]` it just received into the row with one extra call. I deliberately did
> not ship a code path that provably never persists. Filed
> `boots/proposed/S3-record-order-attempt.md` with the two exact call sites for S3.

**Reports (§6.10).** `report_revenue_by_day`, `report_top_items`, `report_funnel`,
`report_delivery_times` — security-definer set-returning functions, not views, because a
`security_invoker` view is read through the caller's RLS and `orders` RLS is per-role: a **driver
would have silently received a partial revenue figure** instead of an error. One shared gate
(`reports_guard()`) admits any active staff role, `anon` revoked. `from_date`/`to_date` are Berlin
calendar dates, both ends inclusive (`from`/`to` are reserved words). Revenue is completed orders
only, with `cancelled_count` and `refunded_cents` alongside so a sum row reconciles against the bank.
`customer_stats` rebuilt per §1.3 — `delivered` + `picked_up` only, `cancelled_count` appended at the
end; all three existing consumers (§6.4, the CRM list, the detail screen's "14. Bestellung") keep
reading the same five columns, and a `new` order no longer inflates the count as it used to.

**Which funnel numbers are honest, which are placeholders** — asked for explicitly, so plainly:
- **WARENKORB → BEZAHLT: real.** `placed`, `paid`, `placed_to_paid_pct` come straight from `orders`.
- **ZUSATZVERKAUF: real.** The option half of every completed line, per period and per day.
- **MENÜ → WARENKORB: not computable, and deliberately absent.** It needs menu impressions /
  add-to-cart events and no table holds them. No column pretends to answer it. The route is the
  `site_events` sketch in my own S2-03 proposal file and it needs an S0 GDPR ruling first.
- **`attempts`, `attempts_with_problems`, `attempts_to_placed_pct`: placeholders.** The queries are
  real; the data is not, because nothing calls `record_order_attempt` yet. They read `0` / `null`,
  which means "nothing recorded", not "nothing happened" — the Berichte screen should label it so.

**Flaky test — fixed, root cause named.** `guest_realtime` assumed `status === "SUBSCRIBED"` means the
Realtime server's broadcast fan-out for that topic is ready to deliver the *next* `realtime.send()`.
It usually is; under load it is not, and a single update plus a fixed 10 s wait is then a coin flip
(`partitions_created: []` in the failure message was a red herring — it means the partitions already
existed). It now waits on a **real signal**: it nudges the order through the same trigger until a
message actually lands, proving the path is live, and only then performs the status change it asserts
on, matching by `status === 'accepted'` so a straggler cannot satisfy it. If the stack cannot
broadcast at all it skips with the capability JSON rather than failing a required check. Passed on
every run since.

**Collision with S7-01, and one of its assertions amended.** S7-01 merged migrations `…19` and `…20`
with the same timestamps as mine while this boot was running; mine renumbered to 21–24 and now run
after S7's. Two consequences worth recording:
- S7-01 independently found and fixed the same `kitchen_pause` NULL-role hole I had fixed (`NULL NOT
  IN (...)` is NULL, and plpgsql treats `IF NULL` as false, so the gate never fired). My migration
  replaces that function again to make `kitchen.status` merge — it **carries S7's guard over
  verbatim**; a future edit must not regress it. Credit is S7's, the audit found it first.
- S7-01's `security.test.ts` asserted *"kitchen/driver see only the public keys, never `ops`"* — the
  state before §6.9 row 1 was decided. That decision (S0, 2026-09-26) is what this boot implements,
  so the assertion is now stale and I amended it to guard what still matters: the private `payments`
  and `kitchen` keys staying out. Its grants sweep also needed the new functions added to its
  allow-lists on purpose (`record_order_attempt`, `settings_staff_keys`, `order_attempt_items_ok` →
  anon-callable; the four `report_*` + `reports_guard` → authenticated-only), which is the sweep
  working as designed. `docs/security.md` updated to match. **S7 should sanity-check both edits.**

**Also fixed in passing:** `db lint` caught `e` used as both a declared variable and a table alias in
`record_order_attempt` (42702) — the kind of thing only a real Postgres catches.

**Working conditions, for the record:** no Docker on this machine (colima needs `qemu`, not
installed, and installing it is not mine to decide), so the Supabase stack could not run locally at
all. Every SQL and test iteration went through the `backend` CI job, and `types/database.ts` was
regenerated from the job's `backend-types` artifact rather than locally. It worked, but each cycle
cost ~4 minutes instead of ~40 seconds — worth knowing before the next backend boot is planned.

**Blockers:** none new for S2. Still open from S2-02: owner's Stripe account + keys, without which no
live payment has been walked through. S7-01 filed a CRITICAL against `place_order`
(client-supplied `payment_status` — `S7-02-S2-payment-security-fixes.md`); **not touched here**, it
needs a §5.3 contract change and is its own boot.

**Boundaries:** no `apps/web`, `apps/backoffice`, `apps/infra` or workflow files touched; no applied
migration edited; `decisions.md`, `sessions.md` and `docs/design/*` untouched; §1–§6 edited only in
the sections task 9 named (plus the §1.1/§1.3/§1.4/§6.1/§6.4 pointer lines those changes made wrong,
and S7's two files above). `order_attempts` is documented as **§1.7**, not §1.5 — §1.5 is Promotions,
and renumbering would have broken cross-references.

**Next:** S0 has since issued **S2-04** for S7-01's CRITICAL payment finding, so campaigns /
automations / banners move behind it (S2-05 — S0 renames `boots/proposed/S2-03-reports-campaigns-cms.md`).
S2-04's brief also lists "the renumber + lint fix that `s2-03` needs": **both are already done in this
PR** — migrations renumbered to 21–24 per D-014 and the `db lint` 42702 fixed, so S2-04 inherits a
green branch and can go straight at the payment trust boundary. Also filed, neither executed:
`boots/proposed/S2-single-customer-erasure.md`, `boots/proposed/S3-record-order-attempt.md`.
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

## 2026-09-27 — S0 Orchestrator — S1-05/S2-03/S4-02 merged; S3-02 and S6-01 issued
Merged S1-05 (PR #36 — `api` placeholder dropped per D-013, pipefail sweep across the workflows), S2-03 (PR #34 — §6.9 implemented, `order_attempts`, report views; it also absorbed S2-04's renumber and the `db lint` fix, so `s2-04` starts green) and S4-02 (PR #37 — Speisekarte, Artikel editor, photo upload; its memory conflict resolved by S0 per D-009).
S4-02 surfaced the kind of defect this project had no one looking for: the back-office writes bucket-qualified photo paths exactly as §6.8 says, the storefront's `Photo.tsx` only renders absolute URLs, **both sides' tests pass, and no menu photo has ever been visible to a guest**. Filed by S4 as contract request §9 and now the headline task of **S3-02**, together with calling `record_order_attempt` (S2 built the table in S2-03; nothing writes to it, so every funnel figure reads 0) and S7's security-headers finding. Payments UI is deliberately held back to S3-03 until S2-04 lands and a Stripe account exists.
Issued **S6-01**, the first QA boot, aimed squarely at that class of bug: seams between sessions, independent re-verification of the load-bearing claims in this log rather than trust, the twelve product rules checked literally against the design, and a verdict with numbers on the `guest_realtime` flake that has now cost three unrelated PRs a re-run. S6 fixes nothing outside its own suite — a QA session that patches the code it tests stops being one.

## 2026-09-27 — S1 DevOps — S1-05
`api` is gone from staging and the deploy is green without it. The back-office host is **still
owner-blocked** — DNS does not resolve, so I did nothing to it. Reported in two PRs on purpose:
#36 carried the change, this entry needs numbers that only exist after the change is on `main`.

**The trim (task 1) — done, and `.env` got smaller too.** Removed the `api` service from
`docker-compose.staging.yml`, its build/push from `_deploy.yml`, the `:8201` health probe, and
`api_port` from both callers. On the server the container went with `--remove-orphans`; I deleted
`ghcr.io/shorobot/shosho-api:staging` by hand (`docker image prune -f` only touches dangling images),
which also returned ~200 MB of disk to a box we share. **I left the GHCR package alone** — deleting a
package version is not cheap to undo and costs nothing to keep, so `shosho-api` stays in the registry
with its last `staging` tag; S5 overwrites it. Nothing listens on 8201 any more (`curl` → 000) and
`ss` confirms only 8200 and 8202 are bound, loopback-only.

One thing beyond the literal task, worth a look: `_deploy.yml` was rendering
`SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` into the server's `.env`, and the `api` container
was **their only consumer**. They now have no reader at all, so I stopped rendering them. Verified on
the server — `.env` holds seven keys, none of them a service-role key. A service-role key sitting in a
file on a shared host with nothing reading it is pure exposure; this is not a finding about anyone's
code, just cleanup that D-013 made obvious. If S5 needs them, they go back scoped to that service, not
as a blanket render.

Kept on purpose: the **local** `docker-compose.yml` placeholder, `placeholder-api/`, and its CI jobs.
D-013 is about 160 MiB of staging RAM, not about local dev. Restore instructions for S5 are commented
in place in both `docker-compose.staging.yml` and `_deploy.yml`, naming D-013.

**Capacity (task 2) — the prediction held, but `memory.current` is the wrong number and I want to say
so plainly.** Both readings are mine, same box, same command, before and after the deploy:

| | before (3 containers) | after (2) | change |
|---|---|---|---|
| `memory.current` | 455.9 MiB | **456.4 MiB** | **+0.5 — it did not move** |
| `memory.peak` | 515.1 MiB | 515.2 MiB | +0.1 (historic) |
| `memory.events.max` | 7899 | 12749 | +4850 (this deploy) |
| `anon` (non-reclaimable) | 249.7 MiB | **191.5 MiB** | **−58.2** |
| `file` (reclaimable cache) | 170.7 MiB | 234.3 MiB | +63.6 |
| `kernel` | 35.7 MiB | 30.7 MiB | −5.0 |
| containers, actual | api 35.5 + web 58.8 + bo 53.8 = 148.1 | web 55.4 + bo 63.3 = **118.7** | −29.4 |
| containers, declared ceilings | 96+96+160 = 352 MiB | **192 MiB** | **−160** |

**Anyone checking this trim by reading `memory.current` will conclude it did nothing.** It sat at
~456 MiB before and after, because the kernel immediately took the freed memory as page cache — `file`
rose 63.6 MiB, almost exactly what `anon` gave up. In a cgroup with a hard `memory.max`, page cache
expands to the ceiling by design; `memory.current` measures how much cache the kernel felt like
holding, not how close we are to a kill. The number that protects us is **`anon` + `kernel`, which
fell from 285.4 to 222.2 MiB**.

**New worst case at declared limits: ~296 MiB of 512 MiB** (192 container ceilings + 72.8 non-container
anon — dockerd/containerd/rootlesskit/systemd/ssh — + 30.7 kernel), leaving ~216 MiB. Using S1-04's
more conservative overhead figure of ~142 MiB instead of today's measured 103.5, it is **~334 MiB**,
leaving ~178 MiB. So: prediction ~334, actual 296–334 depending on which overhead number you trust,
against a prior 494. **The prediction was met.** The cleanest way to state why it is exact: we removed
a 160 MiB ceiling, and 494 − 160 = 334.

Two things I am *not* dressing up. `memory.events.max` rose by **4850** during this deploy (S1-04's
deploy moved it by ~50): pulling two fresh ~330 MB images churns page cache against the ceiling, and
each reclaim counts. And `memory.peak` ticked up 96 KB, so the slice **did** touch ~515 MiB again
during the pull. Neither is an OOM: `oom_kill` is still **1** — TETA+PI's own cap test of 2026-09-20,
per the S1-04 addendum — and both containers report `oom_kill 0`. The trim was never going to reduce
`max` events, because cache will always grow into whatever ceiling exists. It reduced the floor, which
is the part that kills you.

**Back-office host (task 3) — still owner-blocked, but the origin half is now verified, not assumed.**
`dig bo.shos.hellfiresol.com` is empty for both A and CNAME — checked at the start of this boot, again
at the end, and again on 2026-09-28; `curl` → 000. Per the boot I did not force it, invented no
workaround, gave out no URL, and did not re-ask TETA+PI.

**Correction to what I first wrote here (TETA+PI, 2026-09-28):** I had this entry saying their vhost was
"approved and queued". It is not queued — **it has been live on the origin since 2026-09-26**
(teta-pi/infra #129), and I verified that myself rather than taking it on trust, which the boot
explicitly requires for the gate. No DNS is needed to test it:

```
curl -D - -H 'Host: bo.shos.hellfiresol.com' http://164.90.235.66/
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="SHOSHO back-office (staging)"
Strict-Transport-Security / X-Content-Type-Options: nosniff / X-Frame-Options: DENY
```

`/` and `/login` both answer **401 before the app renders anything** — the gate challenges, and it went
up in the same change as the vhost, so the no-unguarded-window condition I asked for in S1-04 held in
practice and not just on paper. Credentials are on the owner's machine only
(`~/.tetapi/shos-bo-basicauth`, 600); I did not request them and they belong nowhere near chat or git.

What this changes: **only the Cloudflare side is left.** I still cannot verify the edge half — valid
TLS at `bo.shos.…`, the challenge surviving the proxy, 200 behind the gate, the four seed logins — and
I will not claim any of it until DNS exists. Task 3 therefore stays on its "does not resolve" branch.

The guest site is unaffected and re-verified: `https://shos.hellfiresol.com/` → **200, valid TLS**
(`ssl_verify_result=0`), correct S3-01 title. No public plain-http login form exists, confirmed rather
than assumed: the only public hostname serving the back-office would be `bo.shos.…`, which does not
resolve, and `/login` on the guest host is 404. Over the ssh tunnel the back-office is healthy —
`:8202/login` 200 (`<title>Anmelden · SHOSHO BO`), `:8202/` 307 to login.

**The four owner actions, unchanged, in one block:**
1. **DNS** — Cloudflare → zone `hellfiresol.com` → DNS → Add record: `CNAME`, name `bo.shos`, target
   `shos.hellfiresol.com`, **Proxied (orange cloud) ON**, TTL Auto.
2. **Configuration Rule** — duplicate the rule added 2026-09-26 that fixed `https://shos.…` landing on
   the hellfire apex, changing only the hostname match to `bo.shos.hellfiresol.com`. Copy the settings,
   do not re-derive them.
3. **"Always Use HTTPS"** for that hostname (SSL/TLS → Edge Certificates, or a Configuration Rule
   scoped to it). This must be at the edge — an origin `:80→https` redirect would loop under CF Full
   (S1-04 addendum). This is what stops a staff password crossing plain http.
4. **Cloudflare Access** — Zero Trust → Access → Applications → self-hosted app,
   `bo.shos.hellfiresol.com`, policy Allow → include → Emails (your address + each staff address).
   Free ≤ 50 users. If it paywalls, stop and say so; we stay on TETA+PI's basic-auth. If it goes live,
   tell me and I ask TETA+PI to drop basic-auth — not before.

**A gate that did not exist when this boot was written.** S7-01 landed mid-boot and its
`S7-02-S1-…` proposal, task 2, says the four seed staff logins share one password that is **published
in this public repo** (`apps/backend/README.md`), and that `bo.shos.hellfiresol.com` must not go live
before it is rotated. I agree, and it changes the finish line: when DNS appears, the Cloudflare gate is
**necessary but no longer sufficient**. Rotation is not mine (it is seed data in `apps/backend`, S2's
file, and the live values are S7's item), so I did nothing to it — but whoever gets the "DNS is up"
boot must treat it as a precondition, not a follow-up. Flagging to S0 rather than acting.

**Pipefail sweep (task 4) — three more live instances of the class, all fixed.** The runner's shell is
`bash -e {0}`: errexit only, no pipefail, no nounset.
1. **`ci.yml`, the co-tenant port guard.** `grep … | grep -oE … | while read` reported only the
   while-loop's status, and ran the loop in a subshell. A staging compose that published **no ports at
   all** walked through this guard green — the guard that exists to keep us inside 8200–8299 for
   TETA+PI. Rewritten with `awk` (exit 0 on no match) and an explicit empty-list failure; tested both
   ways locally, and the negative case fails as it should.
2. **`ci.yml`, backend, two steps.** `eval "$(pnpm exec supabase status -o env | sed …)"` reports
   *eval's* status: a failed `supabase status` evaluated to nothing, exited 0, and the step ran on with
   `DB_URL` unset. **`pipefail` cannot fix this shape** — the substitution's status is discarded by
   `eval` regardless — so the fix is to assign first, then eval, and let `set -u` catch a missing var.
   Worth knowing for anyone who greps for `| tee` and thinks they are done.
3. **`migrate-staging.yml`, the plan step.** `last=$(git ls-tree … | sed | sort | tail -1 | cut …)`
   reported `cut`'s status, so a failing `git` left `last` empty and `${last:-0}` made every new
   migration's timestamp look newer — the migration-ordering guard would have passed silently.

Also upgraded the `_deploy.yml` health step from `set -e` to `set -euo pipefail` on **both** sides of
the ssh boundary; the remote `bash -s` is not the runner's shell and needs saying separately. Note
added to `apps/infra/README.md` covering all three shapes plus the ssh-heredoc case. Checked and left
alone: the compose smoke loop, where `[ "$api" = 200 ] && break` is an AND-list and correctly does not
trip `set -e`.

**`S1-06-prod-target.md` refreshed (task 5) — still a proposal.** Gap 1: env-only secrets are now a
proven shape, not advice, and `PROD_SUPABASE_SERVICE_ROLE_KEY` has no reader on a prod host either.
Gap 2: staging is two containers at ~296–334 MiB worst case, not three at ~494 — but that margin is
earmarked for S5's real FastAPI service, **not** for co-locating prod; D-004 stands. Gap 4:
`migrate-prod.yml` still does not exist, and must be written with `set -euo pipefail` throughout —
on prod this bug class is a silent partial release. Gap 6: the "does the api placeholder ship" question
is settled by D-013. **Gap 7, new: the `payment-worker` finding is a hard pre-prod gate — no `v*` tag
until S7 confirms it is fixed, and I will not build a pipeline that can ship it.** Also recorded the
ruleset-vs-classic-protection caveat so the prod-gate audit does not re-derive S7's false positive.

**CI honesty note.** `backend (supabase)` failed once on my branch on the known `guest_realtime` flake
(`partitions_created: []`, the exact signature in state.md) and passed on re-run. It was not my change:
the step reached vitest and ran 71 tests, 70 passing, so the rewritten `eval` exported `API_URL` and
the keys correctly. S2-03 has since made that test deterministic.

**On 8201, for the record.** TETA+PI observed 8201 still bound and flagged it, hedging that my deploy
might not have landed — their hedge was the right one. A full `ss -ltn` on the box (all users, not just
mine) shows **nothing bound to 8201**; only 8200 and 8202 are, both loopback, both `rootlesskit`. Their
reading predates the deploy. They confirm 8200–8299 stays ours and 8201 stays reserved.

**Blockers:** the back-office host needs the **owner's four Cloudflare actions** and nothing else —
TETA+PI's side is done and verified. The seed-password rotation above is now a second precondition
before it goes live. TETA+PI were told 8201 is idle and reserved — informational, no request, and I did
**not** ask for a cap increase; the trim was the answer.

## 2026-09-28 — S0 Orchestrator — S1-05 reviewed and independently verified; S4-03 issued
Re-verified S1-05's load-bearing claims rather than taking them: a `Host:`-header request to the origin returns `401 WWW-Authenticate: Basic realm="SHOSHO back-office (staging)"` on `/login`; the guest site still answers 200; `ss -ltn` shows only `127.0.0.1:8200` and `:8202` with `8201` free; two containers running; slice `anon` 216.7 MiB + slab 22.6 MiB. All as reported.
Two things in S1's report deserve recording. Its capacity note is the useful kind: `memory.current` did **not** move after the trim (455.9 → 456.4 MiB) because page cache expands into whatever a hard `memory.max` frees — reading that metric alone would have said the change did nothing, while the protective figure `anon`+`kernel` fell 285.4 → 222.2 MiB. And it went one step past the task for the right reason: `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` were being rendered into the server `.env` for the `api` placeholder that was their only reader, so it stopped rendering them — a service-role key sitting on a shared host with no consumer is pure exposure.
Corrected my own stale text: state.md still described the `api` placeholder on `:8201` and `shosho-api` in the pipeline, and implied the back-office vhost was queued when it had been live on the origin since 2026-09-26 — so the host was less blocked than this file claimed for two days. Also recorded the **second** go-live precondition that was only in S7's findings: the four staff seed logins share one password published in this public repo and must be rotated before `bo.` resolves.
Issued **S4-03**: S7's back-office hardening first (the `?next=` open redirect accepts `//evil.example`, no app-set security headers, cookie flags) because a DNS record could appear any day, then the CRM screens — with an explicit instruction not to ship buttons that lie: push, vouchers and on-request erasure have no backend yet and must render as unavailable rather than as controls that silently do nothing.

## 2026-09-28 — S2 Backend — S2-04

All four S7-01 backend findings fixed. PR #41 → `main`. Migrations **25–26**. `backend` CI green.

**Finding 1 (CRITICAL) — the payment trust boundary.** `place_order` believed whatever
`payment_status` its caller sent, and `anon` is the caller on the guest site. So
`rpc('place_order', { payment_method: 'card', payment_status: 'authorized' })` bought a free meal: a
`payment_authorized` event nobody had authorized, auto-accept straight into the kitchen queue when
under `auto_accept_paid_under_cents`, and `paid` the moment staff marked it delivered — Stripe never
involved at any point. Live on staging since S2-01.

It survived S2-01, S2-02 and two reviews for one reason worth naming: **a passing test asserted it
worked.** `place_order.test.ts` "auto-accepts authorized orders under 50 €" was green on every run.
A test that locks in a vulnerability is worse than no test, because it converts "nobody checked" into
"somebody checked and it was fine". S7 found it by reading the trust boundary rather than the suite.

Three things were each independently sufficient to cause it, so all three changed:
- **A guest order is created `pending`, full stop.** Anything else is **refused**
  (`problems: [{code: 'invalid_input', field: 'payment_status'}]`, nothing written) rather than
  silently coerced — a coerced order would look to an attacker like it had worked and would leave no
  trace; a rejected one is visible. A guest's `payment_ref` is dropped: unverified display text.
- **`authorized` is reachable from exactly one place** — `record_payment_event`, behind the
  signature-verified Stripe webhook. Not from any RPC, not for staff either. That word means "a
  provider is holding money we can capture", and only the provider can say it.
- **Completion is not evidence of payment.** `set_order_status`'s "v1 client-reported" branch marked
  any non-cash order without a provider `paid` on delivered/picked_up. Fixing the first two points
  would not have fixed this: today **no Stripe account exists**, so every card order on staging has
  `payment_provider is null` and was completing as `paid` having never been charged. It now completes
  with `payment_status` untouched plus an `order_events` note `code = 'payment_not_confirmed'` — the
  same shape as the cash `cash_not_received` flag the back-office already renders.

Staff keep one narrow power, because a phone order can genuinely be paid at the counter: `owner` /
`operator` may pass `payment_status: 'paid'` and a `payment_ref`. Not `authorized`. Every such order
writes an `order_events` `note` with `code = 'payment_recorded_by_staff'`, the method, the amount and
`actor_id = auth.uid()`, so "this order started out paid" always has a name against it. Auto-accept
now keys only off that, or off a real authorization arriving in the webhook.

**Finding 2 — refunds could pay out twice.** `capture` and `void` always asked Stripe for the
intent's live status first; `refund` had no equivalent, and `payment_jobs` re-claims after 10 minutes
with a *new* idempotency key (`job:<id>:<attempt>`), which Stripe treats as a genuinely new request.
Die between `refunds.create()` resolving and `finish_payment_job` committing and the customer is
refunded twice. Two guards: an **attempt-stable** key (`refund:job:<id>` — Stripe replays the
original response for 24 h, and this is the half that actually closes the race because it needs no
state of ours), plus a pre-check listing the intent's refunds for `metadata.job_id`, which still
works after the 24 h window has passed. The planner is a pure function, so
`tests/refund_idempotency.test.ts` plays the crash-then-reclaim sequence exactly — no Stripe account,
no network, no flakiness.

**Findings 3/7 — `payment-worker` accepted the public anon key.** `verify_jwt = true` only proves
*some* project JWT, and the anon key ships in the guest web bundle. Draining the queue now requires
the service-role key or `x-worker-secret` — 32 bytes the DB generates and keeps in Vault
(`payment_worker_secret()`, service_role only), which `run_payment_worker()` sends on every pg_cron
POST. **`{"action":"install"}` is deliberately still anon-reachable**: `migrate-staging.yml` calls it
that way, S1 owns workflows and has just hardened that file, so the token swap went to
`boots/proposed/S2-04-S1-payment-worker-install-token.md` instead of a cross-session edit. Nothing
breaks in the meantime and there is no window where anything is down — install now writes the
**service-role** key into Vault, so cron stops presenting a public credential the first time the
pipeline runs after this merges, and the install step was already non-fatal. When S1's one-line swap
lands, install gets the same check and no path accepts a public key.

**Findings 4/5 — the small ones.** `tracking_token` is compared in constant time via a shared
`timingSafeEqual` (the webhook signature was already doing this; now there is one helper and no
judgement call per call site). `search_path` pinned on the six `SECURITY INVOKER` functions, bodies
otherwise byte-identical to what is on `main` — verified by diffing each against its original.

**What S3 and S4 must do differently** (§5.3, §5.6, §2 and §6.8 updated — S0 please route):
- **S3 (web):** sending `payment_status` other than `pending` is now an **error**, not advice. §5.6
  already said not to, and the shipped checkout omits it, so the live site is unaffected — this makes
  the contract enforced. `place_order` now always returns `status: 'new'` for a guest; the
  `accepted` case moves to the webhook. Worth a glance at any code branching on that.
- **S4 (back-office):** a delivered non-cash order now stays `pending` and carries a
  `payment_not_confirmed` note. **While no Stripe account exists this is the state every card /
  wallet / PayPal order ends in** — it wants surfacing like the existing cash flag, or the Bestellungen
  board will look like everything is unpaid without explaining why. Also new:
  `payment_recorded_by_staff` notes on phone orders, worth showing in the Verlauf.

**Two tests rewritten, both for the same reason.** `place_order.test.ts` "auto-accepts authorized
orders under 50 €" (S7 named this one) and `payment_jobs.test.ts` "non-Stripe orders keep the v1
behaviour (delivered → paid)". Both asserted a half of finding 1. Neither was deleted — each now
pins the refusal, with a comment saying what it used to assert and why that was wrong, so nobody
"fixes" them back.

**Also corrected:** the README migration table was stale from S2-03's renumber — rows 19–22 named
files that no longer exist and S7's own 19/20 were missing entirely. Now 19–26 and accurate. My own
S2-03 error; it would have sent the next reader to the wrong file.

**Task 6 was already done.** S2-03 merged on 2026-09-27 with its migrations at 21–24 (D-014's rule,
which S0 wrote in response to that very collision) and the `db lint` 42702 alias fix. This boot
started from a clean `main`; migrations here are 25–26. Nothing to renumber.

**Not done / left alone:** S7's task 6 (HTTP-layer tests for the `Deno.serve` handlers) is still open
— it needs `supabase functions serve`, which needs Docker, which this machine does not have (colima
wants `qemu`; not mine to install). Everything this boot added is testable without it: the refund
planner and the caller check are pure functions with real tests, but the handler wiring around them
is still only covered by reading. Worth a boot when someone has a Docker host, or an S6 QA pass
against staging.

**On the red CI S0 saw at review time** (their 2026-09-28 entry): those four failures were this
boot's own work-in-progress, fixed in the two commits after that snapshot — the three
behaviour-change ones now assert the refusal with a comment saying what they used to assert, and the
fourth was my own bad regex, which matched the legitimate `return` after the comparison loop and is
now scoped to the loop line. S0's read of all four was exactly right.

**Blockers:** none. **No live payment has still ever run** — the owner's Stripe account is still the
gate, and per S0 none should be connected until this merges.

## 2026-09-28 — S0 Orchestrator — S2-04 reviewed, not yet merged; its payment-state change routed
Reviewed PR #41. The fix is the right shape: it closes the trust boundary rather than patching the symptom, and the subtle half is the one that matters — **completion is no longer evidence of payment**, so a non-cash order with no provider now finishes with `payment_status` untouched and a `payment_not_confirmed` note instead of quietly becoming `paid`. Not merged: `backend` CI is red on four tests, and three of them are the exact case S7 predicted — S2's own earlier tests assert the **old** behaviour (`event_payloads.test.ts` "payment_authorized (client-reported authorization)" and "refunded", `place_order.test.ts` lifecycle, all failing `expected 'pending' to be 'paid'`). The boot told S2 to make those assert the new refusal rather than delete them; that is the fix. The fourth is a self-test of the new constant-time comparison whose regex (`/for\s*\([\s\S]*?\breturn\b[\s\S]*?\}/`) matches its own implementation — a test-quality problem, not a security one.
Routed the consequences ahead of the merge so nobody builds against the old contract: S4's board and history will show completed orders as unpaid until Stripe exists (correct — display it honestly), S3 keeps sending `pending` and never `authorized`, S6 must not write tests for the old auto-accept rule. Recorded in state.md.

## 2026-09-29 — S0 Orchestrator — probed the origin before writing the go-live steps; step 2 corrected
The owner asked for the four Cloudflare actions step by step, so S0 probed the origin rather than restating S1-04's list. `Host: shos.hellfiresol.com` → 200 on **both** :80 and :443; `Host: bo.shos.hellfiresol.com` → 401 on :80 (TETA+PI's basic-auth vhost, working) and **404 on :443**, where the certificate is `CN=hellfiresol.com`. The `bo.` name is simply not on the origin's TLS vhost yet.
That makes S1-04's step 2 — "duplicate the 2026-09-26 Configuration Rule for `bo.`" — the wrong fix to reach for first. A rule of that kind pins the hostname to Flexible, i.e. Cloudflare fetches the origin over plain `:80` across the public internet, and on this hostname that traffic carries basic-auth credentials and staff passwords. The right fix is to have TETA+PI add `bo.shos.hellfiresol.com` to the origin's existing `:443` server block, as `shos.` already is, and leave the zone on Full. Recorded in state.md as superseding the earlier instruction; S1 owns the request. Flexible remains a fallback only if the origin genuinely cannot serve the name on :443, and would have to be removed before staff use it.
Unchanged: the DNS record, Always Use HTTPS and Access are still the owner's, and the shared staff seed password must be rotated before the name resolves (S7-01 finding 2).

## 2026-09-29 — S1 DevOps — S1-05 addendum: S0's "shos. already on :443" premise is wrong, checked byte-for-byte
S0's message asked me to request TETA+PI mirror `bo.shos.hellfiresol.com` onto the origin's existing
`:443` block "same as `shos.` already is." Before sending that request I probed the origin myself —
the boot requires verifying a gate rather than trusting it, and this is the same discipline. Status
codes agreed with S0's note; **response bodies did not**, so I went to MD5 rather than trust a 200.

```
origin :443, SNI=shos.hellfiresol.com    → MD5 6be6e264…  <title>HELLFIRE AI Solutions…</title>
origin :443, SNI=bo.shos.hellfiresol.com → MD5 6be6e264…  <title>HELLFIRE AI Solutions…</title>
origin :443, no SNI (bare IP)            → MD5 6be6e264…  <title>HELLFIRE AI Solutions…</title>
origin :80,  Host=shos.hellfiresol.com   → SHOSHO site (matches public, different MD5 — CF edge rewrites)
public https://shos.hellfiresol.com/     → SHOSHO site
```

All three `:443` responses are byte-identical to each other and to the bare-IP apex. **There is no
`shos.` or `bo.` server block on origin `:443` at all** — only `hellfiresol.com`/`www.` (cert
`CN=hellfiresol.com`, no other SANs). `shos.` was never "already on :443, reached over TLS" as
recorded — the 200 there is the **wrong site**. Public `https://shos.hellfiresol.com/` works today only
because Cloudflare is fetching our origin over **plain `:80`** — the zone (or a per-hostname rule) is
Flexible for us, whatever label the dashboard shows. This has presumably been true since the
2026-09-26 Configuration Rule and I did not catch it in S1-05's first pass.

Two consequences, not one:
1. **"Mirror what `shos.` has" has nothing to mirror.** `bo.` cannot be fixed by copying a working
   `shos.` :443 vhost, because none exists.
2. **The larger risk is the live guest site, not just `bo.` staying blocked.** If Full mode is switched
   on for either hostname before a real `:443` vhost exists, Cloudflare starts fetching `:443` and gets
   the apex — `https://shos.hellfiresol.com/` would start serving **HELLFIRE's marketing page** to
   every guest, 200, no error, nothing to alert on. That is worse than the failure this thread started
   out fixing.

Also worth a note for whoever re-derives this: my `:443`/bo. reading (200, wrong site) differs from
S0's (404). Possibly a probe-method difference (SNI vs none), possibly the picture changed in between —
either way the conclusion is unaffected: neither hostname is safely servable on `:443` today.

**Sent to TETA+PI (message, not a repo change):** add **both** `bo.shos.hellfiresol.com` and
`shos.hellfiresol.com` to a real `:443` server block, before either hostname's SSL mode is touched. A
Cloudflare Origin CA certificate is the natural fit — covers our subdomains, free, not coupled to the
hellfire cert's renewal. Flagged to S0 rather than editing `state.md`'s "Origin facts" / "Corrected step
2" prose myself — that is S0's section, not my row (D-002). I am not touching the CF side myself
(boundary, this boot); waiting on TETA+PI to confirm the `:443` block exists before anything changes.
## 2026-09-29 — S0 Orchestrator — S2-05 issued (seed credentials)
The owner asked for a micro-boot on the staff password rotation, so S0 established the surface first rather than handing S2 a one-line instruction: `shosho-test-2026` lives in `README.md:212`, `seed.sql:54,61`, `tests/helpers.ts:17` and as the fallback in `apps/backoffice/e2e/smoke.spec.ts:5`. Checked the assumption that mattered — `seed.sql` inserts the four `auth.users` rows `on conflict (id) do nothing`, so rotating today is **not** undone by the next `Migrate staging`; the real defect is that a fresh or reset cloud project is born with a password published on the internet. That puts the fix in the seed, not in a dashboard click, and S2-05 says so.
Shape asked for: the seed always writes a random password on any project, local developers get their known login from a small script run after `db reset`, the README keeps the emails and roles but stops publishing a credential, and the two hardcoded consumers read env with the local default. Staging's four users are rotated to distinct strong values written to a gitignored file on the owner's machine — the report carries the path, never the values. S2 also writes a short note for S4 and S6, who sign in with these accounts, so neither discovers the change through a failed login.
## 2026-09-29 — S3 Frontend — S3-02

**An uploaded menu photo is now visible on `https://shos.hellfiresol.com/`.** That box had been open
since S4-02 and nobody could tick it. PR #44 (`s3-02`), four commits.

**The photo bug, reproduced before it was fixed.** `menu_items.photos` has held bucket-qualified paths
(`menu/<item_id>/<n>.jpg`) since S2-02/S4-02; `Photo.tsx` rendered an image only when `photos[0]`
matched `/^https?:\/\//`, so every card fell back to the placeholder stone (S4 contract request §9).
I did not take that on trust — I uploaded a photo to staging through the operator seed login (the boot
authorised this; the back-office still has no public host), confirmed the object is public
(`HTTP 200`, `image/png`, 20 158 bytes) and that `menu_items.photos` held `menu/<id>/1.png`, then
counted the `<img>` elements the live site served: **zero**. Exactly S4's finding, still true.

**The fix resolves in one place — the data layer, not the component.** `getCatalog()` maps `photos`
through `supabase.storage.from('menu').getPublicUrl()`, so `MenuItem.photos` carries absolute URLs by
the time any surface sees it: card, product page, "Goes well with", and cart-line thumbnails (which
previously showed a decorative tint — they now show the real photo when the catalog knows the item).
No component touches storage or env. `lib/photos.ts` keeps the absolute-URL branch for the seed and
refuses malformed values (`data:`, `javascript:`, protocol-relative, traversal) rather than emitting a
`src` that points somewhere else. Items with no photo keep the brand placeholder — unchanged, correct.

**Three things about `next/image` worth writing down, because two of them are how this bug survived.**
1. `images.unoptimized` is on (no `sharp` in a 96 MB container), and under it `next/image` emits the
   `src` unchanged: **`remotePatterns` is never consulted**, so it was never what blocked the photo and
   declaring it fixes nothing on its own. I declared it anyway so the config is right the day an
   optimizer is affordable, and said so in the config. `sizes` is inert for the same reason and kept
   for the same reason.
2. The rule that **can** silently block a remote photo is CSP `img-src` — which this same boot added.
   Had the headers landed without the storage origin, I would have shipped the identical symptom from
   a new cause. They were built together and verified together.
3. Next 15 does **not** derive `fetchpriority` from `priority`; `priority` only disables lazy loading
   and asks React to preload (no preload link was actually emitted for these). The above-the-fold photo
   now says `fetchpriority="high"` itself.

**`record_order_attempt` — the funnel has data for the first time.** Two call sites sharing one tracker
in `CartProvider`: a refused `place_order` (it rejects by raising, so a row it wrote itself would roll
back — §1.7), and a guest sitting on a blocking `quote_order` state 1.5 s after it settles. Once per
distinct problem state, never per keystroke: the effect keys on an order-independent signature of the
problems, the tracker refuses a signature it has already sent, and that set is persisted in
`sessionStorage` so a reload does not re-file. A rejection also marks its state seen, so the quote side
cannot double-count it. `session_hash` is an opaque `crypto.randomUUID()` in `sessionStorage` — not a
cookie, not `localStorage`, not a fingerprint; with storage unavailable nothing is reported at all.

One judgement call worth flagging: **`out_of_zone` with `reason: postal_code_missing` is not reported.**
It is not a refusal, it is a guest who has not typed a postal code yet, and recording it would file a
row for every visit that ever opened the cart and drown the real signal.

**Both call sites verified on staging, with rows an operator can read.**
- Abandoned cart, postal `99999`: `{type: delivery, postal_code: 99999, zone_id: null,
  subtotal_cents: 1490, items: [{item_id, qty: 1}], problems: [{code: out_of_zone}]}`.
- A genuine mid-checkout race — cart filled and valid, then the item set `available = false` as the
  operator, then Place order: `place_order` refused and the client filed
  `problems: [{unavailable, item_id}, {empty_cart}, {below_min_order}]`, `zone_id` resolved,
  `subtotal_cents: 2980`. That is the "sold out during checkout" state S4 could not render (contract
  request 5). Availability restored to `true` afterwards.
- No PII in either row — no name, phone or street, though all three were entered in the form.
- `report_funnel` now reads `attempts: 2, attempts_with_problems: 2` instead of `0`.

**For S2, not blocking:** with two attempts and four pre-existing orders `report_funnel` returned
`attempts_to_placed_pct: 200.0`. The formula is fine, the window is not — `placed` counts a period the
attempt rows did not exist for. It will look wrong to an operator for as long as the two series have
different histories. S2's call whether that needs a floor or a note in the UI.

**Security headers (S7-01 finding 5) — served by the app now, CSP enforcing.** `middleware.ts` sets all
six on every response. What the live site served before came from Cloudflare defaults, including a
**one-day** HSTS max-age; nothing in this repo set anything.

The CSP is nonce-based and enforcing, **and that is only safe because `app/layout.tsx` declares
`dynamic = "force-dynamic"`** — every HTML response is rendered per request, so the header's nonce
always matches the markup. If any route is ever made static or ISR, its cached HTML will carry a stale
nonce and every script on it will be blocked. That precondition is written at the top of `lib/csp.ts`
and in the README, because it is the one way to break this badly and silently later. `next build`
confirms every route is `ƒ (Dynamic)` today.

`script-src` gets a nonce plus `'strict-dynamic'` and neither `'unsafe-inline'` nor `'unsafe-eval'`.
`style-src` keeps `'unsafe-inline'` — React `style={{…}}` attributes need it and scripts do not get it.
`font-src 'self'`: `next/font` self-hosts both faces at build time, so no Google host is allowed at all.
`img-src`/`connect-src` carry the Supabase origin derived from the **runtime** `SUPABASE_URL` — I
checked this rather than assuming, because `NEXT_PUBLIC_*` is inlined at build time and CI builds the
image without the secrets; a `*.supabase.co` wildcard is the fallback so a missing env degrades to
"any Supabase project" instead of a blank menu. `connect-src` keeps the `wss:` origin: S7's warning is
right, a too-strict one kills guest tracking's live updates and reads as a Supabase outage.
`<PublicEnvScript />` is the one inline script this app writes and now reads the `x-nonce` header.

HSTS is one year with `includeSubDomains` and deliberately **no `preload`** — submitting the apex to
the preload list is the owner's decision and is not quickly undone.

**Tracking token (S7 finding 8):** `Referrer-Policy: no-referrer` on `/order` and `/order/<token>`,
`strict-origin-when-cross-origin` elsewhere. Verified per route.

**Verification, on a standalone build against the real staging Supabase project** (the container's own
shape — `node .next/standalone/…/server.js` with runtime env, plus the `static`/`public` copy the
Dockerfile does): all six headers on every route, the photo loads, the site renders and hydrates, 11
Next chunks load under `'strict-dynamic'`, `window.__SHOSHO_ENV__` is populated (so the nonced inline
script ran), and the browser reported **no CSP violation**. The photo fills its box exactly — 169×126
in a 169×126 parent, no layout shift.

**Tests:** 73 green. 13 for the photo resolver (bucket path, absolute URL, empty, malformed, encoding,
and a check that our URL builder has not drifted from the SDK's `getPublicUrl`), 22 for the attempt
trigger logic (fires once per state, order-independent, survives a reload, silent without storage,
rejection always recorded), 20 for the headers and the `Photo` component. One note for whoever reads
`tests/csp.test.tsx`: vitest does not read `next.config.ts`, so `images.unoptimized` is off there and
`next/image` routes the src through `/_next/image` — the assertion is written to hold in both modes.

**S2-04 compatibility:** checked after merging `origin/main`. The client already sends
`payment_status: 'pending'`, which the new guard accepts; anything else is now refused. No change
needed, and no payments UI in this boot.

**Left on staging deliberately:** a test photo on `RL-014 Philadelphia Deluxe` (`menu/<id>/1.png`) so
the post-deploy check has something to show. It is my generated placeholder art, not food — the owner
should replace it with a real photograph through the back-office. Nothing else was left changed.

**Docs:** `apps/web/README.md` gained three sections — the photo pipeline (and why `remotePatterns` is
not the thing that blocks a photo), the two funnel call sites with the `session_hash` rules and the
"do not widen this payload without changing the contract" line, and the headers with the force-dynamic
precondition. No contract file touched; no gap found in §5 worth a proposal.

**Blockers:** none for S3. S3-03 (payments UI) still waits on the owner's Stripe account.

## 2026-09-29 — S1 DevOps — S1-05 addendum: TETA+PI confirms the finding, widened well past our zone
TETA+PI (`teta-pi-e0`) independently verified the `:443`/apex-collision finding and extended the same
probe to their own hosts before acting:

```
host                    public   origin:80   origin:443
api.tetapi.dev          113      113         30970   → CF fetches :80
app.tetapi.dev          10157    10157       30970   → CF fetches :80
shos.hellfiresol.com    104658   104415      30970   → CF fetches :80
```

Origin `:443` with SNI for `shos.`, `bo.shos.`, `hellfiresol.com`, `app.tetapi.dev` and
`api.tetapi.dev` **all** return the same 30970-byte hellfire apex body under `CN=hellfiresol.com`. So
the collision is not specific to our zone — every hostname on the shared box lands on the apex on
`:443` — and the cleartext CF→origin hop is not specific to our guest-order traffic either: by their
own account it carries their `pk_live_` API keys, JWTs, email login codes and device keys, today. Not
something S1 could have found or fixed — it is their infra, outside `/memory/infra-access.md`'s terms,
and I neither probed their hosts nor asked them to.

**Their fix, which they own and I am not touching:** a real Cloudflare Origin CA cert and `:443`
server blocks for `shos.` → `:8200` and `bo.shos.` → `:8202` (basic-auth unchanged) plus their own
`app./api./mcp.tetapi.dev`, **and** a default `:443` block that rejects unknown SNI instead of silently
serving whichever tenant's vhost sorts first — the piece that made a routing mistake into a cross-tenant
information leak. Ordering is agreed and matches what I asked for: `:443` blocks first, verified from
outside by both of us, only then does the owner touch any CF SSL-mode setting. They said they will tell
me when the blocks are in; I have not re-probed since — nothing has changed yet to check. My retraction
of the "duplicate the Flexible rule for `bo.`" advice reached them before anyone acted on it.

Nothing for S1 to do right now except wait and then verify. No repo change, no CF/nginx change on our
side — boundary unchanged.
## 2026-09-30 — S0 Orchestrator — S3-02 merged and independently verified on the live site
Resolved S3-02's `memory/` conflict (D-009) and merged PR #44. S3 could not merge it itself — `gh pr merge` was refused by its permission mode — so merging stays with S0 for that session.
First check after the merge showed zero `<img>` and no app CSP, which looked like a failed fix; it was not. The last `Deploy staging` had built `5c471de`, the commit **before** S3-02, and the chain for `2e48d95` was still running. Waited for `CI → Migrate staging → Deploy staging` to finish on the right commit and re-checked: `https://shos.hellfiresol.com/` serves `<img … src="https://bvmitglwwqsvufetlkff.supabase.co/storage/v1/object/public/menu/…">` with `fetchPriority="high"`, and the app's own `content-security-policy`, `permissions-policy` and `strict-transport-security: max-age=31536000; includeSubDomains`. **The photo blocker open since S4-02 is closed** — the first defect in this project found by one session in another's code, routed, fixed and verified end to end by a third.
Worth keeping from S3's report: `remotePatterns` was never the cause (with `images.unoptimized`, `next/image` never consults it) — the thing that can silently block a remote photo is CSP `img-src`, which the same boot added, so both were built together. And the nonce-based CSP is only safe while `app/layout.tsx` stays `force-dynamic`: make any route static or ISR and its cached HTML carries a stale nonce that blocks every script on it. That constraint is in `lib/csp.ts`, the README and the commit message, and is now also here.
Two follow-ups recorded in state.md rather than acted on: HSTS is sent twice (app 31536000 + TETA+PI's nginx 86400 — first wins per RFC 6797, so harmless today but a smell for S1/S7 to settle), and `report_funnel`'s `attempts_to_placed_pct: 200.0` is a window bug S3 correctly flagged instead of patching in S2's code.

## 2026-09-30 — S0 Orchestrator — my origin-TLS reading was wrong; S1 caught it, I re-measured and confirm
S1 flagged that the "Origin facts, measured by S0 2026-09-29" block in state.md was instructing the opposite of what is safe. It was right, and the error was in my probe method, not in a detail.
I had run `curl -H 'Host: shos.hellfiresol.com' https://164.90.235.66/` and read the 200 as "the name is on the TLS vhost". With an IP literal in the URL curl sends **no SNI**, so nginx answered from its default server block — that 200 was HELLFIRE's page, not ours. My differing `bo.` result (404 where S1 saw 200) was the same mistake wearing a different hat: I asked for `/login`, which that site does not have. Re-measured with `--resolve` so real SNI is sent, and compared bodies rather than status codes: :443 with SNI `shos.`, :443 with SNI `bo.`, and :443 with no SNI all return **byte-identical** content, `md5 6be6e264658c51773d9d4eea7334e5de`, `<title>HELLFIRE AI Solutions…</title>`, cert `CN=hellfiresol.com`. Our site lives only on :80. So `https://shos.hellfiresol.com/` works today only because Cloudflare fetches the origin over plain :80 — Flexible in behaviour whatever the label says.
The consequence S1 drew is the important one and I had missed it entirely: the exposure is not confined to the back-office. Switching `shos.` to Full before a real :443 vhost exists would serve HELLFIRE's marketing page to **every guest of the live storefront**, 200, silently. state.md is corrected, the old block struck rather than quietly edited, and the ordering is now explicit — origin :443 first, SSL mode second, never the other way round. S1 owns the request to TETA+PI (both names, Origin CA cert) and needs nothing from me.
Method note worth keeping: for a name-based vhost, a status code proves nothing. Use `curl --resolve <name>:443:<ip>` and compare body hashes.

## 2026-10-01 — S0 Orchestrator — struck a stale blocker before it cost the owner time
Re-checked the whole open-items list before handing the owner a consolidated action plan, and found that the line still reading "CRITICAL, blocks any real payment — `place_order` trusts a client-supplied `payment_status`" had been fixed and merged in S2-04 (PR #41) days earlier; only the S2 row had been updated, because that row is S2's to edit and the open-items list is mine. Left as it was, it would have kept the owner from creating the Stripe test account for no reason. Struck, with the hold on connecting Stripe explicitly lifted.
Infra state unchanged since 2026-09-30 and re-measured today: origin :443 still answers with HELLFIRE's page for SNI `shos.` (TETA+PI's vhost not yet in place, S1 owns the request), `bo.shos.hellfiresol.com` still does not resolve, and `apps/backend/README.md` still publishes the shared staff password (S2-05 issued, not yet run). So the ordering in the owner's plan is unchanged: origin :443 first, SSL mode second.

## 2026-10-02 — S2 Backend — S2-05

No known staff password may exist on a cloud project. PR #51 → `main`. One self-caught correction,
PR #52 → `main`. `backend` CI green on both.

**Shape chosen.** `seed.sql` now gives each staff account a random, immediately-discarded password
instead of `shosho-test-2026` — `extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'),
extensions.gen_salt('bf'))`, never stored anywhere, so nobody (including this session) knows it. The
`auth.users` insert's `on conflict (id) do nothing` means this protects exactly the case that
mattered — a fresh or reset cloud project — and never touches a project that already has these rows.
Local development needed a known password back, so that convenience moved entirely out of SQL:
`scripts/seed-local-logins.mjs` sets it via the Admin API, refuses anything but a loopback Supabase
URL (no override — that is what `rotate-staging-passwords.mjs` is for), and is wired as the package's
`pretest` hook. That means `pnpm test` needs no extra step and **no CI workflow file changed** — the
boundary held cleanly because `pretest`/`test` is an npm-lifecycle pairing, not a workflow concept.
Verified this actually works rather than assuming it: ran the hook's safety gate directly against a
fake non-local URL (refused, exit 1) and against missing env vars (refused, exit 1) before relying on
CI to prove the happy path — which it did, every role-based sign-in test across the whole suite
passed with `pretest` setting the password immediately beforehand.

**Staging rotation — written, not run.** `scripts/rotate-staging-passwords.mjs` generates four fresh,
distinct, 160-bit random passwords and writes them to `apps/backend/.staff-credentials.local`
(gitignored, mode 0600) — never to stdout, chat, a commit, or this log. I do not have the
`shosho-staging` service-role key in this environment and did not ask for it; the script's own header
is the owner's one-command recipe.

**Un-publishing.** `README.md`'s "Test logins" section rewritten; `tests/helpers.ts` (`PASSWORD`) and
`apps/backoffice/e2e/smoke.spec.ts` (`E2E_PASSWORD`, the one line task 4 allowed) now fall back to the
same local-only value, overridable via env. Also corrected a note the "point tests at another
project" paragraph used to make: `pretest`'s safety gate means that capability is local-only now, by
design — the README says so instead of documenting a path that no longer works.

**Confirmed, per task 6.** `git log -S"shosho-test-2026"` shows it in history since the very first
commit (`9c791a1`, S2-01) on this public repo — the honest conclusion is that the value must be
treated as compromised, which the rotation step already assumes. No attempt to rewrite history.
`git grep` after the change: zero occurrences in any operative tracked file; it remains in
`/memory/log.md` and the boot files as the historical record of the finding, which is correct and
deliberate (D-002 — memory is never rewritten) rather than an oversight.

**Self-caught correction worth describing plainly, not just noting happened.** The first version of
`boots/proposed/S2-05-credentials-note.md` and a README paragraph both said, in effect, "the old
shared password no longer works" — true of a *future* project, **false of `shosho-staging` itself**.
`on conflict (id) do nothing` means PR #51 could not have touched the live project's existing rows, so
`shosho-test-2026` was still a working credential on staging the moment that PR merged, and stays that
way until the owner actually runs `rotate-staging-passwords.mjs`. I found this myself, re-reading what
I had just shipped before closing out the boot, not from a review. Filed PR #52 same-day: both files
now say plainly that the exposure is open, not closed, and name the one remaining action. Recording
this not to pad the report but because a security fix whose own documentation overstates what it
accomplished is a worse outcome than no documentation — it is exactly the "a test said it worked"
failure mode from S2-04's finding 1, in a different shape.

**What S4 and S6 must do differently** — `boots/proposed/S2-05-credentials-note.md` has the detail;
headline version: local work needs one new command after `db reset`
(`pnpm --filter @shosho/backend seed:local-logins`, or just run `pnpm test`, which does it
automatically); staging work still needs the owner directly for current credentials, and must not
assume the old password is gone without checking.

**Blockers:** none for S2. **Open, owner-only, until acted on:** the staging rotation itself — run
`apps/backend/scripts/rotate-staging-passwords.mjs` with the real service-role key. Until then
`shosho-test-2026` remains a live, published, working credential on `shosho-staging`.

**Boundaries:** no workflow file touched (`pretest` is a package.json lifecycle hook, not a workflow
change); `apps/web` untouched; `apps/backoffice` touched only in the single permitted line;
`/docs/security.md`, `/memory/decisions.md`, `/memory/sessions.md` untouched. No password value
appears anywhere in this log entry, any commit, or the chat that produced this boot.

## 2026-10-03 — S1 DevOps — S1-05 addendum: `:443` fix verified independently, confirmed to TETA+PI
TETA+PI reported the `:443` blocks in (teta-pi/infra #134) and asked me to verify from outside before
anyone touches the Cloudflare side — the same discipline this whole thread has run on. Did not take
their own check at face value; ran a wider pass:

```
shos.hellfiresol.com    :443 → 200, 107204B, correct title, 0 occurrences of "HELLFIRE" in the body
bo.shos.hellfiresol.com :443 → 401, nginx's own auth page (not hellfire, not the app) — still 401
                                with wrong credentials supplied, so the gate actually checks, it is
                                not a decoy that lets anything through
cert (both hostnames)    CloudFlare Origin CA, SAN = shos.hellfiresol.com + bo.shos.hellfiresol.com
                                only — the hellfire apex/www were not folded in, confirmed
unknown SNI              TLS handshake rejected outright (`tlsv1 alert unrecognized name`) —
                                `ssl_reject_handshake` live, not just configured. This was the piece
                                that turned a routing mistake into a cross-tenant leak; checked it
                                directly rather than trusting the description.
hellfiresol.com apex     untouched: still CN=hellfiresol.com, SAN apex+www only, still 30970B
:80 (both hostnames)     unchanged — shos 200, bo 401, no redirect added
DNS (bo.shos.)           still empty, as expected — this fix doesn't touch resolution
```

Confirmed back to TETA+PI with the specifics above. **Nothing executed on the Cloudflare side by
either of us yet** — by agreement, their turn now: `tetapi.dev` zone → Full (strict) is theirs alone;
our zone keeps Full and the owner retires the 2026-09-26 Configuration Rule that forces `shos.*` to
Flexible, which is the one change that actually closes our cleartext hop. I am not touching the CF
side; will re-verify the same way, from outside, once it is flipped, before treating this closed.

## 2026-10-04 — S0 Orchestrator — origin :443 verified a third time; the Cloudflare flip is unblocked
S1 merged PR #53 and reported the origin fix verified beyond TETA+PI's own report. S0 re-measured rather than relaying it — this is the area where S0 was wrong once, which is a reason to check, not to skip. Every claim holds: SNI `shos.` → the real site; SNI `bo.` → nginx's 401; certificate SANs exactly our two names with hellfire's apex untouched; `:80` unchanged. The check that matters most is the one S1 added and TETA+PI had not made: an **unknown SNI is refused at the TLS handshake**, so there is no default server block left to fall into — the mechanism behind the original bug is gone rather than hidden.
One apparent discrepancy was not one: S0's `grep -i hellfire` matched the page once, but the match is our own `siteUrl: https://shos.hellfiresol.com`. S1's "zero occurrences" is correct in substance.
State.md's prohibition on touching the SSL mode is lifted and replaced with the precise action S1 identified: the cleartext hop now persists only because of the **Configuration Rule the owner added on 2026-09-26 pinning `shos.*` to Flexible**. Retiring that rule is the change — not the zone-wide flip to Full that S0 had described. The owner's step list is updated accordingly.

## 2026-10-05 — S0 Orchestrator — `bo.shos.` is unreachable over https: Universal SSL covers one label
The owner added the `bo.shos` CNAME, proxied, and it resolves to Cloudflare. `https://bo.shos.hellfiresol.com/` nevertheless fails before HTTP exists: `sslv3 alert handshake failure`. Measured the edge certificate rather than guessing — it carries `DNS:hellfiresol.com, DNS:*.hellfiresol.com`, i.e. **one label**, so a two-label name like `bo.shos.hellfiresol.com` is simply not covered. `http://bo.shos.hellfiresol.com/` answers nginx's 401, which proves DNS, the proxy and TETA+PI's vhost are all correct; the only missing piece is an edge certificate that includes the name.
This was nobody's mistake in execution — the hostname was chosen (option A, S4's proposal, S0's decision) before anyone checked what the free certificate covers, and `shos.hellfiresol.com` working gave no hint, since it is one label.
Cheapest fix with no recurring cost: rename to a single label, `bo-shos.hellfiresol.com`. That needs the owner to edit the DNS record **and** S1 to ask TETA+PI to add the name to the origin vhost and reissue the Origin CA certificate, whose SANs are currently `shos.` + `bo.shos.` — otherwise the origin leg breaks the moment the edge leg starts working. Advanced Certificate Manager (~$10/mo) would keep the current name; a `/bo` subpath would avoid certificates entirely but reintroduces the shared origin and cookie scope that choosing a separate hostname was meant to avoid. Recorded so S1 can send one request rather than two.
