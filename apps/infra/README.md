# SHOSHO — infra

One server (DigitalOcean, Frankfurt, shared with TETA+PI), Docker Compose, host nginx as reverse proxy,
GitHub Actions → GHCR → ssh deploy. Secrets live **only** in GitHub Secrets; the server receives a
rendered `.env` from them on every deploy.

```
GitHub main ──push──▶ CI (ci.yml) ──green──▶ deploy-staging.yml ──▶ ssh shosho@server
                                                 │                        └─ /opt/shosho/staging: compose pull/up
                                                 └─ images → ghcr.io/shorobot/shosho-{web,api}:staging
git tag vX.Y.Z ──▶ deploy-prod.yml ──approve (owner)──▶ same flow into /opt/shosho/prod
```

## Deploy to staging
Merge a PR into `main`. After CI is green, `Deploy staging` runs automatically: it builds the `web`
image (`apps/web/Dockerfile`, or the placeholder) and the `api` image (`apps/automation/Dockerfile`, or
the placeholder), pushes them to GHCR, renders `.env` from secrets, copies `docker-compose.staging.yml`
to the server and runs `docker compose pull && up -d`, then health-checks `web:/` and `api:/health`.
Manual run: Actions → Deploy staging → Run workflow. Status: `gh run list --workflow "Deploy staging"`.

## Add a new secret
```bash
gh secret set STAGING_MY_KEY --repo shorobot/shosho          # prompts for the value
gh secret set STAGING_MY_KEY --repo shorobot/shosho < file   # or from a file
```
Then: (1) pass it through in `apps/infra/.github/workflows/deploy-staging.yml` (`secrets:` block) and,
if a container needs it, in `_deploy.yml` (workflow_call `secrets:` + the "Render .env" step);
(2) add the key without a value to `apps/infra/.env.example` and `apps/<app>/.env.example`;
(3) run `apps/infra/scripts/sync-workflows.sh`. Prod counterpart uses the `PROD_` prefix.
Non-public URLs/hosts are secrets too; the public host is an environment-level variable
`PUBLIC_HOST` / `PUBLIC_URL` (`gh variable set PUBLIC_HOST --env staging`).

## Production release (tag → approve)
```bash
git tag v0.1.0 && git push origin v0.1.0
```
`Deploy production` starts and pauses on the `production` environment — the owner (`tetakta`) clicks
**Review deployments → Approve** in Actions. Without a `v*` tag the workflow never starts; without
approval it never deploys. The prod server does not exist yet (separate boot after security-01): until
`PROD_*` secrets exist the workflow fails at the SSH step — expected.

## Local environment in 5 minutes
```bash
corepack enable pnpm && pnpm install            # monorepo (apps/web, apps/backoffice)
cd apps/infra && cp .env.example .env           # fill SUPABASE_* from the staging project
docker compose up -d                             # n8n → http://localhost:5678, api → http://localhost:8000/health
docker compose logs -f n8n
```
macOS: needs Docker Desktop or Colima (`colima start`); `docker compose` plugin v2+.

### Supabase locally — decision
By default local development talks to the cloud project `shosho-staging` (region EU Central /
Frankfurt) via `.env`. `supabase start` (~7 containers, ~2 GB RAM) is not part of the compose stack —
enable it optionally once backend-01 adds `supabase/` with migrations: `supabase start && supabase db reset`.

## Files
| File | Purpose |
|---|---|
| `docker-compose.yml` | local: n8n + placeholder api |
| `docker-compose.staging.yml` | server: web, api, n8n — all ports bound to 127.0.0.1 |
| `nginx/shosho-staging.conf`, `nginx/shosho-proxy.conf` | host-nginx vhost (`/` → web:3100, `/api/` → 8100, `/n8n/` → 5678) |
| `placeholder-web/`, `placeholder-api/` | stand-in images until apps/web and apps/automation exist |
| `scripts/server-bootstrap.sh` | one-time server setup (deploy user `shosho`, nginx, certbot, ufw) |
| `scripts/sync-workflows.sh` | copies workflows to `/.github/workflows` (CI verifies they are in sync) |
| `.github/workflows/` | `ci.yml`, `_deploy.yml` (reusable), `deploy-staging.yml`, `deploy-prod.yml` |

## Secrets / variables (staging)
Secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_N8N_ENCRYPTION_KEY`,
`STAGING_N8N_BASIC_AUTH_USER`, `STAGING_N8N_BASIC_AUTH_PASSWORD`, `STAGING_SUPABASE_URL`,
`STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
Variables (environment `staging`): `PUBLIC_HOST`, `PUBLIC_URL`.

## Server
Shared droplet with TETA+PI (see `docs/deployment.md` in that repo): nginx on :80, TETA+PI TLS
terminates at Cloudflare; SHOSHO staging uses certbot on the sslip.io host until a domain exists.
Deploy user is `shosho` (non-root, `docker` group); root is used only for bootstrap. The server has
2 GB RAM and is already loaded — n8n is capped at `mem_limit: 512m`, api at `256m`.
Check: `ssh shosho@<host> docker stats --no-stream`.
