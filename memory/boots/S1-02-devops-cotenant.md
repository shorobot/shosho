# BOOT: S1-02 (DevOps) — adapt infra to the real server terms, bring staging live

## Role
You are session S1 (DevOps) of SHOSHO. This boot makes staging actually run under the co-tenant terms of the shared server, removes everything from S1-01 that no longer applies (root bootstrap, host nginx, n8n), and closes the gaps S1-01 left (Supabase staging project, report).

## Context
Repo: https://github.com/shorobot/shosho (public), local `/Users/bobbob/BOB/SERVER/SH.OS.`. Work on a branch `s1-02`, open a PR to `main` (branch protection: PR + green `CI`). Repo language: English (D-006).
Read FIRST, in this order:
- `/memory/state.md`
- `/memory/decisions.md` — especially **D-004** (hosting: accepted, co-tenant), **D-006** (English), **D-007** (n8n dropped)
- `/memory/infra-access.md` — the server terms. They are binding. Violating them gets our access revoked.
- `/memory/sessions.md`
- `/apps/infra/README.md` — what you built in S1-01

What changed since S1-01: the server is NOT ours. User `shos` (not `shosho`), `/home/shos` only, no sudo, no docker group, no nginx edits, **512M RAM hard cap for everything**, ports only `127.0.0.1:8200–8299`. Domain `shos.hellfiresol.com` already points to `127.0.0.1:8200` via a vhost managed by the TETA+PI manager. ssh key: `~/.ssh/shos_ed25519` on the owner's Mac (verified by S0 on 2026-09-20).

## Tasks
Do them in order. Ask the owner everything you need in ONE list at the start.

1. **Remove n8n (D-007)**
   - Delete the `n8n` service and volume from `apps/infra/docker-compose.yml`; drop `N8N_*` from every `.env.example`; drop n8n from `apps/infra/README.md` and the CI compose smoke test (keep the smoke test for `api`).
   - Delete GitHub Secrets `STAGING_N8N_BASIC_AUTH_USER`, `STAGING_N8N_BASIC_AUTH_PASSWORD`, `STAGING_N8N_ENCRYPTION_KEY`.

2. **Remove obsolete host-level assumptions (D-004)**
   - Delete `apps/infra/nginx/` and `apps/infra/scripts/server-bootstrap.sh` (we never touch nginx; no root). If any part of bootstrap is still useful as a *user-level* setup script, rewrite it as `apps/infra/scripts/shos-user-setup.sh` that runs as `shos` without sudo.
   - Rewrite the `## Server` section of `apps/infra/README.md` to match `/memory/infra-access.md` (link to it, do not duplicate the whole thing).

3. **Server runtime as user `shos`**
   - Install rootless docker for `shos` (`dockerd-rootless-setuptool.sh install`; if the host lacks the rootless extras and that needs a package install → that is an infra request to `teta-pi-e0`, see step 7 — do not wait on it: fall back to `systemd --user` units running the placeholder api/web directly with `podman` if present, or plain processes, and note which path you took).
   - Make sure `DOCKER_HOST=unix:///run/user/1002/docker.sock` is set for the deploy ssh session (`~/.profile` or explicit in the workflow).
   - Enable autostart after reboot: `systemctl --user enable docker` (linger is already on), or the equivalent for your fallback.
   - Set `mem_limit` per container so the total stays well under 512M: target web ≤ 96M, api ≤ 160M. Verify with `docker stats --no-stream` and `cat /sys/fs/cgroup/user.slice/user-1002.slice/memory.current`.

4. **Ports and compose**
   - `docker-compose.staging.yml`: `web` publishes `127.0.0.1:8200:80` (or whatever the placeholder listens on), `api` publishes `127.0.0.1:8201:8000`. Nothing else is published. No `0.0.0.0`.
   - Remote dir: `/home/shos/shosho/staging`. Update `inputs.remote_dir` / defaults in the workflows accordingly.

5. **Deploy pipeline**
   - Update GitHub Secret `STAGING_SSH_USER` → `shos`. `STAGING_SSH_HOST` stays. `STAGING_SSH_KEY`: the owner pastes the private key content of `~/.ssh/shos_ed25519` into the secret themselves via GitHub UI — you give the exact path in the instructions, you do not read or print the key. (If the current secret already holds a different key, tell the owner to replace it.)
   - `_deploy.yml`: make the ssh steps work rootless (`DOCKER_HOST`), remove any `sudo`, point at the new remote dir, keep GHCR login/pull/up and the health check. Health check = `curl -fsS http://127.0.0.1:8200/` and `:8201/health` executed over ssh on the server.
   - Push to `main` (after PR merge) must deploy staging automatically and turn green.

6. **Supabase staging project**
   - Create `shosho-staging` in the owner's Supabase account, region **eu-central-1 (Frankfurt)**. If you cannot create it yourself, give the owner the 4 clicks and get back the URL + keys via the GitHub Secrets UI (owner pastes; you never see the service-role key in chat).
   - Secrets: `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`. Wire them into the rendered `.env` on deploy (already templated in `_deploy.yml`? — verify, fix if not).
   - Do NOT create tables. That is S2.

7. **Talk to TETA+PI manager** (`send_message` → `teta-pi-e0`) — only for:
   - anything that needs root on the host (rootless-docker packages, `uidmap`, `slirp4netns`, etc.),
   - confirmation that :8200 is up so they verify the vhost from their side (their explicit request).
   Keep it to one message per topic. Record what you asked and what they answered in your log entry.

8. **Verify** (all must be true before you report):
   - `ssh shos@… curl -fsS http://127.0.0.1:8200/` returns the "SHOSHO staging OK" placeholder.
   - `ssh shos@… curl -fsS http://127.0.0.1:8201/health` returns 200.
   - `memory.current` of the `shos` slice < 350M with both containers up.
   - After `systemctl --user restart docker` (or a reboot request to TETA+PI is NOT needed — just simulate with `docker compose down && up`) the services come back.
   - `deploy-staging.yml` run on `main` is green end to end.
   - `https://shos.hellfiresol.com/` — test and record the result. If it still serves the hellfire site (CF SSL Full issue) that is NOT your blocker: note it and move on.

## Boundaries
- NEVER bind to `0.0.0.0`, never use a port outside 8200–8299, never write outside `/home/shos`, never touch `/opt/tetapi`, `/etc/nginx`, `/var/www`, ports 5432/6379/8000–8099/8090/5433.
- NEVER `sudo`. If something needs root — request to `teta-pi-e0`, do not try workarounds.
- NEVER put the ssh private key or any Supabase key into a file in the repo, into chat, or onto the server outside the rendered `.env` (chmod 600).
- Do NOT edit `/memory/decisions.md`, `/memory/sessions.md`, `/docs/api-contracts.md`, or `/memory/infra-access.md` — proposals go to `/memory/boots/proposed/`.
- Do NOT create prod. Do NOT create Supabase tables. Do NOT create Next.js apps.
- Do NOT reintroduce n8n or any other orchestrator service.

## Done when
- [ ] n8n gone from compose / env / README / CI / secrets
- [ ] nginx dir and root bootstrap removed; README `## Server` matches infra-access.md
- [ ] rootless docker (or documented fallback) running as `shos`, autostart enabled
- [ ] web on 127.0.0.1:8200, api on 127.0.0.1:8201, total slice memory < 350M
- [ ] `deploy-staging.yml` green on `main`, health checks pass over ssh
- [ ] Supabase `shosho-staging` exists (eu-central-1), 3 secrets set
- [ ] TETA+PI notified that :8200 is up; their answer recorded
- [ ] PR `s1-02` merged into `main`

## Reporting
1. Append to `/memory/log.md`: `## <date> — S1 DevOps — S1-02` — what was done, what changed (staging URL status, Supabase project ref, rootless vs fallback), blockers, what TETA+PI answered. Also add a short retroactive entry for S1-01 (what it did and did not finish) — S1-01 never reported.
2. In `/memory/state.md` update ONLY the S1 row: status `boot done`, last completed `S1-02`, and move the items you closed out of the "Not yet done / open" list.
3. All commits prefixed `[S1-02]`.

## Next step
If you find a need for another boot (e.g. `S1-03: prod target`, or something S2-01 needs from infra), write a proposal in `/memory/boots/proposed/S<N>-<NN>-<slug>.md` in the boot format. Do not execute it. After reporting — stop and wait for the next boot from S0.
