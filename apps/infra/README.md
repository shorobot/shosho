# SHOSHO — infra

Один сервер (DigitalOcean, Frankfurt, спільний з TETA+PI), Docker Compose, host-nginx як reverse-proxy,
GitHub Actions → GHCR → ssh deploy. Секрети живуть **тільки** в GitHub Secrets; сервер отримує `.env`
з них на кожному деплої.

```
GitHub main ──push──▶ CI (ci.yml) ──green──▶ deploy-staging.yml ──▶ ssh shosho@server
                                                 │                        └─ /opt/shosho/staging: compose pull/up
                                                 └─ images → ghcr.io/shorobot/shosho-{web,api}:staging
git tag vX.Y.Z ──▶ deploy-prod.yml ──approve (owner)──▶ те саме у /opt/shosho/prod
```

## Деплой на staging
Змерджити PR у `main`. Після зеленого CI автоматично запускається `Deploy staging`: збирає образи
`web` (apps/web/Dockerfile або placeholder) і `api` (apps/automation/Dockerfile або placeholder),
пушить у GHCR, рендерить `.env` із секретів, копіює `docker-compose.staging.yml` на сервер і робить
`docker compose pull && up -d`, потім health-check `web:/` і `api:/health`. Ручний запуск:
Actions → Deploy staging → Run workflow. Статус: `gh run list --workflow "Deploy staging"`.

## Додати новий secret
```bash
gh secret set STAGING_MY_KEY --repo shorobot/shosho          # значення запитає інтерактивно
gh secret set STAGING_MY_KEY --repo shorobot/shosho < file   # або з файлу
```
Далі: (1) прокинути в `apps/infra/.github/workflows/deploy-staging.yml` (блок `secrets:`) і, якщо
потрібно контейнеру, у `_deploy.yml` (inputs `secrets:` + крок «Render .env»); (2) додати ключ без
значення в `apps/infra/.env.example` і `apps/<app>/.env.example`; (3) `apps/infra/scripts/sync-workflows.sh`.
Prod-аналог — префікс `PROD_`. Непублічні URL/хости — теж secrets; публічний хост — variable
`PUBLIC_HOST` / `PUBLIC_URL` на рівні environment (`gh variable set PUBLIC_HOST --env staging`).

## Prod-реліз (tag → approve)
```bash
git tag v0.1.0 && git push origin v0.1.0
```
`Deploy production` стартує і зупиняється на environment `production` — власник (`tetakta`) натискає
**Review deployments → Approve** у Actions. Без тегу `v*` workflow не запускається; без approve — не
деплоїть. Prod-сервер ще не існує (окремий boot після security-01): до появи `PROD_*` secrets
workflow впаде на кроці SSH — це очікувано.

## Локальне середовище за 5 хвилин
```bash
corepack enable pnpm && pnpm install            # monorepo (apps/web, apps/backoffice)
cd apps/infra && cp .env.example .env           # заповнити SUPABASE_* із staging-проєкту
docker compose up -d                             # n8n → http://localhost:5678, api → http://localhost:8000/health
docker compose logs -f n8n
```
macOS: потрібен Docker Desktop або Colima (`colima start`); плагін `docker compose` v2+.

### Supabase локально — рішення
За замовчуванням локальна розробка ходить у хмарний проєкт `shosho-staging` (регіон EU Central /
Frankfurt) через `.env`. `supabase start` (≈7 контейнерів, ~2 GB RAM) не входить у compose — вмикати
опційно, коли backend-01 додасть `supabase/` з міграціями: `supabase start && supabase db reset`.

## Файли
| Файл | Що |
|---|---|
| `docker-compose.yml` | локально: n8n + placeholder api |
| `docker-compose.staging.yml` | сервер: web, api, n8n — усі порти на 127.0.0.1 |
| `nginx/shosho-staging.conf`, `nginx/shosho-proxy.conf` | host-nginx vhost (`/` → web:3100, `/api/` → 8100, `/n8n/` → 5678) |
| `placeholder-web/`, `placeholder-api/` | образи-заглушки, поки немає apps/web і apps/automation |
| `scripts/server-bootstrap.sh` | одноразове налаштування сервера (deploy-user `shosho`, nginx, certbot, ufw) |
| `scripts/sync-workflows.sh` | копіює workflows у `/.github/workflows` (CI перевіряє синхронність) |
| `.github/workflows/` | `ci.yml`, `_deploy.yml` (reusable), `deploy-staging.yml`, `deploy-prod.yml` |

## Secrets / variables (staging)
Secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_N8N_ENCRYPTION_KEY`,
`STAGING_N8N_BASIC_AUTH_USER`, `STAGING_N8N_BASIC_AUTH_PASSWORD`, `STAGING_SUPABASE_URL`,
`STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
Variables (environment `staging`): `PUBLIC_HOST`, `PUBLIC_URL`.

## Сервер
Спільний droplet з TETA+PI (`docs/deployment.md` у тому репо): nginx на :80, TLS TETA+PI — на
Cloudflare; SHOSHO staging — certbot на sslip.io-хості до появи домену. Користувач для деплою —
`shosho` (non-root, група `docker`), root — тільки для bootstrap. Пам'ять сервера 2 GB і вже
під навантаженням — n8n обмежено `mem_limit: 512m`, api `256m`. Перевірка: `ssh shosho@<host> docker stats --no-stream`.
