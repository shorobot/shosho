# BOOT: S1-01 (DevOps)

> Status: CLOSED 2026-09-20 by S0 — partially done (see log). Superseded by S1-02. Ukrainian original kept as history (pre D-006).

## Роль
Ти — сесія S1 (DevOps) проєкту SHOSHO: підключаєш GitHub-репозиторій, сервер, CI/CD і базове staging-середовище, щоб наступні сесії (Backend, Frontend, Back-office) могли деплоїти код без ручних дій.

## Контекст
Репозиторій: локально `/Users/bobbob/BOB/SERVER/SH.OS.`, на GitHub — https://github.com/shorobot/shosho (private, org `shorobot`, `origin` підключено, `main` запушено).
Перед будь-якою дією ОБОВ'ЯЗКОВО прочитай:
- `/memory/sessions.md` — ростер сесій і формат ідентифікаторів
- `/memory/state.md` — поточний стан, що визначено, що ні
- `/memory/decisions.md` — стек (D-001), правила пам'яті (D-002), середовища (D-005), відкрите питання хостингу (D-004)
- `/docs/architecture.md` — цільова схема шарів

Стек зафіксовано: Supabase + Next.js (web, backoffice) + n8n + FastAPI + Claude Agent SDK. Ти його не змінюєш.

## Завдання
Виконуй по порядку. Усе, що потребує даних від власника (токени, доступ до сервера, вибір провайдера) — спитай у чаті одним списком на початку, не по одному.

1. **GitHub branch protection** (репо і remote вже є — не створюй заново)
   - Налаштувати branch protection на `main`: PR обов'язковий, мінімум 1 status check (CI з п.4) зелений. Force-push заборонений.
   - Перевірити, що GitHub Actions увімкнено для org `shorobot` / репо `shosho`.

2. **Рішення D-004 (хостинг)**
   - З'ясувати у власника: чи є вже сервер (де, ОС, доступ по SSH)? Бюджет?
   - Запропонувати один варіант із двох у D-004 з коротким обґрунтуванням (3-5 речень), отримати "так" від власника.
   - Записати результат у `/memory/boots/proposed/decision-D-004.md` (Orchestrator перенесе в decisions.md). Сам decisions.md НЕ редагуй.

3. **Сервер / staging-середовище**
   - Якщо VPS: SSH-доступ, Docker + Docker Compose, базовий firewall (ufw: 22, 80, 443), Caddy або Traefik як reverse-proxy з auto-TLS, окремий non-root deploy-користувач.
   - Якщо Vercel-варіант: підключити репо до Vercel, налаштувати проєкт для `apps/web` (staging = preview з `main`); VPS для n8n/FastAPI — той самий Docker-набір, що вище.
   - Зафіксувати доступи ТІЛЬКИ у GitHub Secrets / Vercel env, ніколи в репо.
   - Supabase: створити проєкт `shosho-staging` (регіон EU — Frankfurt), зберегти `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` як GitHub Secrets. Prod-проєкт Supabase поки НЕ створювати.

4. **CI/CD (GitHub Actions) у `/apps/infra/.github/` → скопіювати в `/.github/workflows/`)**
   - `ci.yml`: на кожен PR і push у `main` — install, lint, typecheck, test для `apps/web` та `apps/backoffice` (поки папки порожні — workflow має проходити з no-op і бути готовим до появи `package.json`; використовуй перевірку існування файлу). Для `apps/automation` — Python: ruff + pytest, теж no-op якщо порожньо.
   - `deploy-staging.yml`: на push у `main` після зеленого CI — деплой на staging (ssh + docker compose pull/up, або Vercel — залежно від п.2).
   - `deploy-prod.yml`: на git tag `v*` — той самий деплой у prod, з `environment: production` і обов'язковим ручним approve (GitHub Environments, required reviewers = власник). Prod-таргет може бути ще не створений — workflow має існувати і бути готовим.

5. **Локальне середовище розробки**
   - `docker-compose.yml` у `/apps/infra/` для локального запуску: n8n, FastAPI (порожній placeholder-контейнер з health-check), за потреби Supabase local (`supabase start`) — задокументувати вибір.
   - `.env.example` у корені та в кожному `apps/*` з усіма ключами, що знадобляться (без значень): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, N8N_*, DATABASE_URL.
   - Monorepo-обгортка: кореневий `package.json` з workspaces (`apps/web`, `apps/backoffice`) + `pnpm-workspace.yaml`; менеджер пакетів — pnpm. Не створювати самі Next.js-застосунки — це роблять Frontend/Back-office сесії.

6. **Документація для наступних сесій** — `/apps/infra/README.md`:
   - як задеплоїти на staging (один абзац)
   - як додати новий secret
   - як робиться prod-реліз (tag → approve)
   - як підняти локальне середовище за 5 хвилин

## Межі
- НЕ пишеш бізнес-код: жодних таблиць у Supabase, жодних сторінок Next.js, жодних агентів.
- НЕ редагуєш `/memory/decisions.md` і `/docs/api-contracts.md` — тільки пропозиції у `/memory/boots/proposed/`.
- НЕ створюєш prod-Supabase і prod-сервер — тільки staging. Prod — окремий boot після Security-01.
- НЕ зберігаєш секрети в жодному файлі репозиторію. `.env.example` — тільки ключі, без значень.
- НЕ вибираєш хостинг сам без "так" від власника.

## Критерій завершення
Усе наступне істинне:
- [ ] branch protection на `main` увімкнено, PR без зеленого CI не мержиться
- [ ] PR у `main` запускає `ci.yml`, і він зелений на порожньому monorepo
- [ ] Push у `main` запускає `deploy-staging.yml`, staging доступний за HTTPS-URL (навіть якщо це placeholder-сторінка "SHOSHO staging OK")
- [ ] `deploy-prod.yml` існує, вимагає approve, не запускається без тегу
- [ ] Supabase staging-проєкт створений, ключі в GitHub Secrets
- [ ] `docker compose up` у `/apps/infra/` піднімає n8n локально
- [ ] `/apps/infra/README.md` написаний
- [ ] Рішення D-004 записане у `/memory/boots/proposed/decision-D-004.md`

## Звітність
Після виконання:
1. Дописати у `/memory/log.md` запис `## <дата> — S1 DevOps — S1-01`: що зроблено, що змінилось (URL репо, URL staging, провайдер), блокери.
2. Оновити у `/memory/state.md` ТІЛЬКИ рядок S1: статус `boot виконано`, "Останній завершений" = S1-01. І перенести відомі тепер факти (URL репо, staging, Supabase регіон) з розділу "Що НЕ визначено" у "Що є в репо зараз".
3. Усі коміти з префіксом `[S1-01]`.

## Наступний крок
Якщо виявиш потребу в новому boot (наприклад, "S1-02: prod-середовище" або "S2-01 потребує X від інфри") — напиши пропозицію у `/memory/boots/proposed/S<N>-<NN>-<slug>.md` за тим самим шаблоном. Не виконуй її сам. Після звіту — зупинись і чекай наступного boot від Orchestrator.
