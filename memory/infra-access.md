# INFRA ACCESS — shared server (co-tenant terms)

Source: TETA+PI manager session (`teta-pi-e0`), 2026-09-20, owner-authorized. Verified by S0 via ssh on 2026-09-20.
Owner of this file: S0. S1 DevOps reads it before any server work. **No secrets here — ever.**

## Server
- DigitalOcean, Frankfurt (EU). `164.90.235.66`. 1 vCPU / 2 GB RAM / 50 GB.
- Shared with TETA+PI (tetapi.dev, admin) and hellfire (hellfiresol.com). SH.OS is an isolated co-tenant.
- Administered by TETA+PI manager. We do NOT administer the host.

## Our access
- `ssh -i ~/.ssh/shos_ed25519 shos@164.90.235.66` — user `shos` (uid 1002). Key lives on the owner's Mac only.
  Private key: never copied to the server, never pasted into chat, never committed. For CI: register it as GitHub Secret `STAGING_SSH_KEY` (S1 does this).
- No sudo. No docker group. Write only inside `/home/shos`.
- Hard limits (systemd cgroup, verified `memory.max=536870912`): **MemoryMax 512M**, MemorySwapMax 0, CPUQuota 50%, TasksMax 512.
  Over the limit → OOM-kill of our processes only (exit 137).
- Ports: listen ONLY on `127.0.0.1:8200–8299`. Binding to `0.0.0.0` is a violation.
- Containers: rootless docker under `shos` (`dockerd-rootless-setuptool.sh`) or `systemd --user` services (linger is on). Plain `docker` → permission denied. As of 2026-09-20 rootless docker is NOT yet installed.

## Domain
- `shos.hellfiresol.com` → Cloudflare (proxied, TLS at CF) → host nginx vhost → `http://127.0.0.1:8200`.
- Until something listens on :8200 the vhost returns 502 (expected).
- Known issue: CF zone is SSL "Full", so CF hits origin :443 where the default vhost is hellfire-apex; our vhost is on :80. `https://shos.hellfiresol.com/` may currently serve the hellfire site. Fix is on the CF zone (owner) or a 443 block on origin (TETA+PI). Raised with owner by TETA+PI. Does not affect ssh / local dev.

## Do NOT touch
`/opt/tetapi`, `/etc/nginx`, `/var/www`, other homes, ports `127.0.0.1:5432 / 6379 / 8000–8099 / 8090 / 5433`. Attempts are logged.

## Infra changes (vhost, ports, limits, cron, packages)
Only by request to TETA+PI manager: `send_message` → `teta-pi-e0`, or via owner. We never edit nginx / sshd / system-level systemd.

## Revocation
Owner or TETA+PI manager can cut access instantly without notice if isolation is broken or resources harm tetapi.dev.

## What TETA+PI expects from us (first step)
1. ssh works — ✅ verified 2026-09-20 (S0).
2. A service listening on `127.0.0.1:8200` (or another port in 8200–8299 — tell them, they re-point the vhost).
3. Autostart after reboot: `systemd --user` unit or rootless compose.
4. Stay under 512M total. Need more → request to `teta-pi-e0` with justification (owner decides).
5. Reply to `teta-pi-e0` when :8200 is up — they verify the vhost from their side.

## Consequence for S1's D-004 proposal (memory/boots/proposed/decision-D-004.md)
The proposal assumed user `shosho`, `/opt/shosho/staging`, host nginx edited by us, mem limits n8n 512m + api 256m. **All of that is superseded** by the terms above: user `shos`, `/home/shos`, no nginx access, 512M for EVERYTHING. n8n (~300–500 MB) alone nearly fills the budget → staging on this box can host web + api placeholder only; n8n/automation needs either a RAM increase (request) or a separate host. Decision pending (owner).
