# Пропозиція: D-004 — Хостинг / сервер

Автор: DevOps (devops-01), 2026-09-18. Для перенесення Orchestrator-ом у `/memory/decisions.md`.

## Рішення
Варіант **(a) — власний VPS + Docker Compose**, на **існуючому сервері власника**:
DigitalOcean droplet, Frankfurt (EU), `164.90.235.66`, Ubuntu, 1 vCPU / 2 GB / 50 GB, ~$12/міс.
Сервер спільний з TETA+PI (prod) та іншими сервісами; SHOSHO staging живе в `/opt/shosho/staging`
під non-root користувачем `shosho`, усі порти на 127.0.0.1, зовні — host-nginx.

- Reverse-proxy: **host nginx** (уже стоїть на :80; Caddy/Traefik не можна — порт зайнятий). TLS: certbot на
  `164-90-235-66.sslip.io` до появи домену; після купівлі домену — subdomain за Cloudflare, як у TETA+PI.
- Образи: GitHub Actions → GHCR (`ghcr.io/shorobot/shosho-{web,api}`), сервер робить `compose pull/up`.
- Секрети: тільки GitHub Secrets; `.env` на сервері рендериться з них на кожному деплої.
- GitHub: репо переведено у **public** (рішення власника 2026-09-17) — так branch protection (ruleset)
  і required reviewers для `production` працюють на плані Free без апгрейду org.

## Чому
Власник підтвердив, що сервер уже є («у нас вже є сервер»), тож витрат на новий VPS немає, а дані вже
в ЄС (GDPR). Vercel-варіант (b) для комерційного продукту означає Vercel Pro ($20/міс/користувач) плюс
той самий VPS для n8n/FastAPI — два провайдери, два набори секретів, два pipeline. Один compose-стек
з одним ssh-деплоєм простіший для AI-сесій і однаковий для staging/prod.

## Наслідки / ризики
1. **RAM.** Droplet 2 GB уже під навантаженням TETA+PI (аудит 2026-07-13: своп). n8n (~300–500 MB) +
   web + api додають ~0.6–0.8 GB. Поставлено `mem_limit` (n8n 512m, api 256m). Якщо своп зросте —
   resize droplet до 4 GB (~$24/міс) або окремий droplet для SHOSHO. Рішення власника після першого
   тижня staging (DevOps моніторить `docker stats`).
2. **Prod** — НЕ на цьому ж сервері разом зі staging. Prod-таргет (окремий droplet або окремий compose
   у `/opt/shosho/prod` після resize) — окремий boot `devops-02` після security-01. `deploy-prod.yml`
   уже готовий і чекає `PROD_*` secrets.
3. Спільний nginx: SHOSHO змінює тільки `sites-available/shosho-*` і `snippets/shosho-proxy.conf`;
   конфіги TETA+PI не чіпаємо. `nginx -t` перед кожним reload.
4. Домен: тимчасово sslip.io; коли власник купить домен — DNS A-запис `staging.<домен>` → сервер
   (або Cloudflare proxied), додати ім'я в `server_name`, `PUBLIC_HOST`/`PUBLIC_URL` у variables.

## Статус
Очікує «так» власника на текст цієї пропозиції → Orchestrator переносить у decisions.md як D-004 (прийнято).
