# INFRA ACCESS — shared server (co-tenant terms)

Source: TETA+PI manager session (`teta-pi-e0`), 2026-09-20, owner-authorized. Verified by S0 via ssh on 2026-09-20.
Owner of this file: S0. S1 DevOps reads it before any server work. **No secrets here — ever.**

## Server
- DigitalOcean, Frankfurt (EU). `164.90.235.66`. 1 vCPU / 2 GB RAM / 50 GB.
- Shared with TETA+PI (tetapi.dev, admin) and hellfire (hellfiresol.com). SH.OS is an isolated co-tenant.
- **`hellfiresol.com` is the OWNER'S OWN umbrella — confirmed by them 2026-10-28, not a third party.** The line above reads like a third-party co-tenant and misled S0 into framing a blocker that did not exist; it is kept as written because the *hosting* co-tenancy is real, but the **domain** is the owner's and its Cloudflare zone is theirs. Consequence: no third-party dependency on our hostnames, staging can stay on `shos.hellfiresol.com` indefinitely, and any new launch domain is a same-day change the owner can make.
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

## Gated surfaces — index (usernames and locations only; NEVER a secret value)
This section exists because the owner lost time on 2026-10-16 locked out of the back-office, trying
`owner`, `operator` and `owner@shosho.test`. The username was correct nowhere we look day to day — it
existed only in a commit message on TETA+PI's side. A username is not a secret; **not writing it down
cost more than writing it down ever could.** The standing rule above is unchanged and absolute: no
secret *values* in this file, ever.

| Surface | Host | Username | Where the secret lives | Rotation |
|---|---|---|---|---|
| Back-office outer gate (nginx basic-auth) | `bo-shos.hellfiresol.com` | **`shos-bo`** | The owner's own key store — `0600`, written 2026-10-10, per TETA+PI. On the server only as a root-owned hash: `/etc/nginx/.htpasswd-shos-bo`, `0640 root:www-data`, unreadable by our `shos` user and not reversible | TETA+PI, on the owner's word. D-010 Option A (2026-10-16): basic-auth stays, pair held by two people |
| Back-office staff logins (inside the app) | same | the four staff e-mails | `apps/backend/.staff-credentials.local` on the owner's machine — mode `600`, gitignored | `apps/backend/scripts/rotate-staging-passwords.mjs`; last run 2026-10-09 |

Source: TETA+PI (`TTPI · 5 · devops`, session 5.19, `teta-pi/infra` PR #154) volunteered the username on
2026-10-16 after the lockout, explicitly withholding the password. They now keep the same index on their
side in `teta-pi/infra docs/access.md`. **Two people holding the pair is the owner's A2 choice** — the
owner enters it per device (kitchen tablet, driver phone) so the other staff never learn it.

## Do NOT touch
`/opt/tetapi`, `/etc/nginx`, `/var/www`, other homes, ports `127.0.0.1:5432 / 6379 / 8000–8099 / 8090 / 5433`. Attempts are logged.

## Infra changes (vhost, ports, limits, cron, packages)
Only by request to TETA+PI manager: `send_message` → `teta-pi-e0`, or via owner. We never edit nginx / sshd / system-level systemd.

## Before looping requests at the origin from on-box — ASK FIRST
TETA+PI told us 2026-10-28: fail2ban's `ignoreip` currently lists only the Cloudflare ranges, which
**overrides** fail2ban's built-in `127.0.0.1/8 ::1`, so **loopback is no longer ignored**. They are fixing
it in its own task. Until then, if any session wants to loop requests at the origin from on the box, say
so to `teta-pi-e0` **first** and let them whitelist — otherwise we ban ourselves. External probing from
our own machines (the re-verify method below) is unaffected.

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
