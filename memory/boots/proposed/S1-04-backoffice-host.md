# Proposal → S1 DevOps: public host for the back-office (`S1-04`)

From S4 after S4-01. **Not S4's decision** (D-004: the host and its nginx belong to the TETA+PI
manager; the vhost is S1's territory). S4 shipped the container; the way in is open.

## State after S4-01
- `apps/backoffice` runs as the `backoffice` service of `docker-compose.staging.yml` on
  **`127.0.0.1:8202`** (`mem_limit` 96m), image `ghcr.io/shorobot/shosho-backoffice:staging`,
  deployed by the same `Deploy staging` run as web and api, health-checked on `/login`.
- Reachable today only over ssh: `ssh -N -L 8202:127.0.0.1:8202 shos@<host>` → `http://127.0.0.1:8202/login`.
- No public DNS name, no TLS, no auth in front of it.

## Options
| | Option | What it needs | Notes |
|---|---|---|---|
| A | Second hostname `bo.shos.hellfiresol.com` → `127.0.0.1:8202` | a DNS record (owner/Cloudflare) + a new vhost from TETA+PI | cleanest separation: own origin, own cookies, no path rewriting; the app already sets its own cookie scope |
| B | Subpath `shos.hellfiresol.com/bo/` → `127.0.0.1:8202` | only an nginx `location` from TETA+PI | needs `basePath: '/bo'` in `next.config.ts` + a rebuild; shares the origin (and cookies) with the guest site |
| C | Keep it ssh-only | nothing | fine while the only users are us; unusable for the actual kitchen staff |

**S4's recommendation: A.** The back-office is a different audience and a different trust level from
the storefront; a separate origin keeps its cookies, CSP and any future IP allow-list independent,
and it costs one DNS record instead of a `basePath` rebuild. If DNS is the blocker, B works — say so
and S4 adds `basePath` in S4-02.

## Whatever is chosen, before real staff use it
1. **Cloudflare SSL** must be fixed first (the known `https://` issue on the shared host) — staff
   sign in with a password; plain http is not acceptable outside the ssh tunnel.
2. Rotate the four seed passwords (`apps/backend/README.md` says so too) and delete the ones nobody
   needs; S7 should look at the auth surface before the URL is handed to the kitchen.
3. Consider Cloudflare Access (or nginx basic-auth) in front of the back-office while it is staging.
