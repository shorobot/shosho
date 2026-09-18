# Proposal: D-004 — Hosting / server

Author: DevOps (devops-01), 2026-09-18. For the Orchestrator to move into `/memory/decisions.md`.

## Decision
Option **(a) — own VPS + Docker Compose**, on the **owner's existing server**:
DigitalOcean droplet, Frankfurt (EU), `164.90.235.66`, Ubuntu, 1 vCPU / 2 GB / 50 GB, ~$12/mo.
The server is shared with TETA+PI (prod) and other services; SHOSHO staging lives in
`/opt/shosho/staging` under the non-root user `shosho`, every port bound to 127.0.0.1, host nginx in front.

- Reverse proxy: **host nginx** (already on :80; Caddy/Traefik not possible — port taken). TLS: certbot on
  `164-90-235-66.sslip.io` until a domain exists; after the domain is bought — a subdomain behind
  Cloudflare, same as TETA+PI.
- Images: GitHub Actions → GHCR (`ghcr.io/shorobot/shosho-{web,api}`); the server runs `compose pull/up`.
- Secrets: GitHub Secrets only; the server `.env` is rendered from them on every deploy.
- GitHub: the repo was switched to **public** (owner decision, 2026-09-17) so branch protection
  (ruleset) and required reviewers for `production` work on the Free plan without an org upgrade.

## Why
The owner confirmed a server already exists, so there is no cost for a new VPS and the data already sits
in the EU (GDPR). The Vercel option (b) for a commercial product means Vercel Pro ($20/mo/user) plus the
same VPS for n8n/FastAPI — two providers, two secret sets, two pipelines. One compose stack with one ssh
deploy is simpler for AI sessions and identical for staging and prod.

## Consequences / risks
1. **RAM.** The 2 GB droplet is already loaded by TETA+PI (audit 2026-07-13: swapping). n8n (~300–500 MB)
   + web + api add ~0.6–0.8 GB. `mem_limit` is set (n8n 512m, api 256m). If swap grows — resize the
   droplet to 4 GB (~$24/mo) or a dedicated droplet for SHOSHO. Owner decision after the first week of
   staging (DevOps monitors `docker stats`).
2. **Prod** is NOT on this server alongside staging. The prod target (separate droplet, or a separate
   compose in `/opt/shosho/prod` after a resize) is a separate boot `devops-02` after security-01.
   `deploy-prod.yml` is ready and waits for `PROD_*` secrets.
3. Shared nginx: SHOSHO touches only `sites-available/shosho-*` and `snippets/shosho-proxy.conf`;
   TETA+PI configs are never modified. `nginx -t` before every reload.
4. Domain: sslip.io for now; once the owner buys a domain — DNS A record `staging.<domain>` → server
   (or Cloudflare proxied), add the name to `server_name`, update `PUBLIC_HOST`/`PUBLIC_URL` variables.

## Status
Awaiting the owner's "yes" on this text → Orchestrator moves it into decisions.md as D-004 (accepted).
