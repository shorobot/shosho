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

## 2026-09-20 — S2 Backend — S2-01
Shipped `apps/backend/` (PR #6, branch `s2-01`): 10 migrations (enums → settings/staff/zones → menu → customers → orders with `order_number_seq` from 1000 → promo_codes → triggers → views → RLS → RPCs), idempotent `seed.sql` (10 categories with kana, 14 items, 5 option groups / 18 options, zones A/B/C with Berlin postal codes, SHOSHO10 / WILLKOMMEN / LUNCH15, settings, 4 staff logins in `auth.users`), RPCs `quote_order` / `place_order` / `set_order_status` / `get_order_by_token` / `kitchen_pause`, generated `types/database.ts`, vitest suite (21 tests: quote/place happy paths, min order, out of zone, stoplist, first-order promo, illegal transition, role gates incl. kitchen≠delivered, anon RLS, role matrix), `backend` CI job (`supabase start` → `db reset` → `db lint` → seed twice → typecheck → vitest → types diff) — green. api-contracts §5 written; `apps/backend/README.md` written. Deviations/additions (tracking_token, zone free-delivery threshold, extra problem codes, public `kitchen.status`, driver/kitchen self-read) → `/memory/boots/proposed/S2-contract-change.md`.
Blockers / not done: (1) **staging not applied** — no `shosho-staging` project / `STAGING_SUPABASE_*` secrets exist yet (S1-02 task 6); needs project ref + DB password from the owner, then `pnpm --filter @shosho/backend db:push` (documented in README). (2) Local `supabase start` was impossible on this Mac (macOS 12: no Docker Desktop, colima needs qemu which no longer has a Homebrew bottle) — all verification ran in CI on ubuntu, where `supabase db reset` + seed + tests pass with zero errors. Local `db reset` remains to be confirmed by whoever has Docker.
