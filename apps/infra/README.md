# SHOSHO — infra

Staging is an **isolated co-tenant** on the owner's shared DigitalOcean droplet (D-004): user `shos`,
rootless Docker Compose inside `/home/shos`, ports `127.0.0.1:8200–8299`, 512M RAM for everything.
GitHub Actions → GHCR → ssh deploy. Secrets live **only** in GitHub Secrets; the server receives a
rendered `.env` (chmod 600) from them on every deploy. The host (nginx, TLS, firewall) is owned by the
TETA+PI manager — we never touch it. Binding terms: [`/memory/infra-access.md`](../../memory/infra-access.md).

```
GitHub main ──push──▶ CI (ci.yml) ──green──▶ deploy-staging.yml ──▶ ssh shos@server (rootless docker)
                                                 │                        └─ /home/shos/shosho/staging: compose pull/up
                                                 └─ images → ghcr.io/shorobot/shosho-{web,api}:staging
Cloudflare (TLS) ──▶ host nginx vhost shos.hellfiresol.com (TETA+PI) ──▶ 127.0.0.1:8200 (web)
                                                                          127.0.0.1:8201 (api, internal)
git tag vX.Y.Z ──▶ deploy-prod.yml ──approve (owner)──▶ same flow — prod target NOT decided yet (D-004)
```

## Deploy to staging
Merge a PR into `main`. After CI is green, `Deploy staging` runs automatically: it builds the `web`
image (`apps/web/Dockerfile`, or the placeholder) and the `api` image (`apps/automation/Dockerfile`, or
the placeholder), pushes them to GHCR, renders `.env` from secrets, copies `docker-compose.staging.yml`
to the server and runs `docker compose pull && up -d` against the rootless daemon
(`DOCKER_HOST=unix:///run/user/<uid>/docker.sock`, set explicitly in the workflow), then health-checks
`http://127.0.0.1:8200/` and `http://127.0.0.1:8201/health` **over ssh on the server** and prints the
cgroup memory usage. The public URL check is informational only (edge/TLS is not ours).
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
approval it never deploys. The prod target is not decided (D-004: not on the shared staging box;
separate boot after S7-01): until `PROD_*` secrets exist the workflow fails at the SSH step — expected.

## Local environment in 5 minutes
```bash
corepack enable pnpm && pnpm install            # monorepo (apps/web, apps/backoffice)
cd apps/infra && cp .env.example .env           # fill SUPABASE_* from the staging project
docker compose up -d                             # api → http://localhost:8000/health
docker compose logs -f api
```
macOS: needs Docker Desktop or Colima (`colima start`); `docker compose` plugin v2+.
There is no orchestrator container any more (D-007): schedules/webhooks/agents live in code
(`apps/automation`, FastAPI + Claude Agent SDK + cron).

### Supabase locally — decision
By default local development talks to the cloud project `shosho-staging` (region EU Central /
Frankfurt) via `.env`. `supabase start` (~7 containers, ~2 GB RAM) is not part of the compose stack —
enable it optionally once S2 adds `supabase/` with migrations: `supabase start && supabase db reset`.

## Files
| File | Purpose |
|---|---|
| `docker-compose.yml` | local: placeholder api |
| `docker-compose.staging.yml` | server: `web` → 127.0.0.1:8200 (96M), `api` → 127.0.0.1:8201 (160M); nothing else published |
| `placeholder-web/`, `placeholder-api/` | stand-in images until apps/web and apps/automation exist |
| `scripts/shos-user-setup.sh` | one-time **user-level** server setup as `shos` (rootless docker, autostart, `~/shosho/staging`); no sudo |
| `scripts/sync-workflows.sh` | copies workflows to `/.github/workflows` (CI verifies they are in sync) |
| `.github/workflows/` | `ci.yml`, `_deploy.yml` (reusable), `deploy-staging.yml`, `deploy-prod.yml` |

## Secrets / variables (staging)
Secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER` (= `shos`), `STAGING_SSH_KEY` (private half of
`~/.ssh/shos_ed25519` on the owner's Mac — pasted by the owner, never printed), `STAGING_SUPABASE_URL`,
`STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
Variables (environment `staging`): `PUBLIC_HOST=shos.hellfiresol.com`, `PUBLIC_URL=https://shos.hellfiresol.com`.

## Server
Shared droplet administered by the TETA+PI manager; SHOSHO staging is a co-tenant under the terms in
[`/memory/infra-access.md`](../../memory/infra-access.md) — read it before any server work. In short:

- Access: `ssh -i ~/.ssh/shos_ed25519 shos@164.90.235.66` (uid 1002). **No sudo, no docker group,
  no nginx, write only inside `/home/shos`.** Do not touch `/opt/tetapi`, `/etc/nginx`, `/var/www`,
  ports 5432 / 6379 / 8000–8099 / 8090 / 5433.
- Runtime: **rootless docker** as `shos` (`systemctl --user` service `docker`, autostart via linger).
  Socket `unix:///run/user/1002/docker.sock` — exported in `~/.profile` for interactive shells; CI sets
  `DOCKER_HOST` explicitly because non-login ssh shells skip `~/.profile`.
  Setup / repair: `ssh … 'bash -s' < apps/infra/scripts/shos-user-setup.sh` (idempotent).
- Ports: publish **only** on `127.0.0.1:8200–8299`. `web` = 8200 (the vhost target), `api` = 8201.
  A new port in that range → tell `teta-pi-e0`, they re-point the vhost. Never `0.0.0.0`
  (CI has a guard for the staging compose).
- Memory: hard cap **512M** for the whole `shos` cgroup (`MemoryMax`, no swap), CPU 50%. Container
  limits: web 96M, api 160M. Over the cap → our processes get OOM-killed (exit 137), not the host.
  Check: `ssh … 'cat /sys/fs/cgroup/user.slice/user-1002.slice/memory.current'` and
  `ssh … 'DOCKER_HOST=unix:///run/user/1002/docker.sock docker stats --no-stream'`.
- Domain: `shos.hellfiresol.com` → Cloudflare → host nginx → `127.0.0.1:8200`. The vhost, TLS and the
  known CF "SSL Full" issue are on the TETA+PI / owner side, not ours.
- Anything that needs root (packages, sysctl, cron, limits, vhost): request to the TETA+PI manager
  (`send_message` → `teta-pi-e0`) or via the owner. No workarounds.
- Fallback if rootless docker is unavailable: `systemd --user` units running the placeholders as plain
  processes (python `http.server` for web, `uvicorn` for api) on the same ports — documented in the
  S1 log when/if used. As of S1-02 rootless docker is the running path.
