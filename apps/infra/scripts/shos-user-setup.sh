#!/usr/bin/env bash
# SHOSHO — one-time user-level setup on the shared server. Runs as the co-tenant user (`shos`),
# NO sudo, writes only inside $HOME. Terms: memory/infra-access.md (D-004).
#
#   ssh -i ~/.ssh/shos_ed25519 shos@164.90.235.66 'bash -s' < apps/infra/scripts/shos-user-setup.sh
#
# Idempotent. What it does:
#   1. installs rootless docker for this user (dockerd-rootless-setuptool.sh; host packages
#      docker-ce-rootless-extras / uidmap / slirp4netns must already be there — if not, that is a
#      root-level request to the TETA+PI manager, not something this script can fix),
#   2. enables the user docker service (autostart after reboot — linger is on),
#   3. exports DOCKER_HOST in ~/.profile for interactive sessions
#      (CI sets it explicitly; non-login ssh shells never read ~/.profile),
#   4. creates ~/shosho/staging (compose dir the deploy workflow writes into).
# It never binds ports, never touches nginx, never leaves $HOME.
set -euo pipefail

[ "$(id -u)" -ne 0 ] || { echo "refusing to run as root — this is a user-level script"; exit 1; }
command -v sudo >/dev/null && sudo -n true 2>/dev/null && echo "note: sudo is available but this script never uses it"

UID_="$(id -u)"
SOCK="unix:///run/user/${UID_}/docker.sock"
APP_DIR="${HOME}/shosho/staging"

log() { printf '\n==> %s\n' "$*"; }

log "prereqs (host packages — read-only check)"
missing=()
for t in dockerd dockerd-rootless-setuptool.sh rootlesskit slirp4netns newuidmap newgidmap curl; do
  command -v "$t" >/dev/null || missing+=("$t")
done
grep -qE "^$(id -un):" /etc/subuid && grep -qE "^$(id -un):" /etc/subgid || missing+=("subuid/subgid for $(id -un)")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "missing on host: ${missing[*]}"
  echo "→ needs root: ask the TETA+PI manager (teta-pi-e0) to install docker-ce-rootless-extras uidmap slirp4netns"
  echo "  and to add '$(id -un):100000:65536' to /etc/subuid and /etc/subgid. Fallback: systemd --user units (see README)."
  exit 2
fi
loginctl show-user "$(id -un)" 2>/dev/null | grep -q 'Linger=yes' || echo "warning: linger is off — autostart after reboot needs 'loginctl enable-linger' (root; ask TETA+PI)"

log "rootless docker for $(id -un) (uid ${UID_})"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
if [ -S "/run/user/${UID_}/docker.sock" ] && DOCKER_HOST="$SOCK" docker info >/dev/null 2>&1; then
  echo "already running"
else
  dockerd-rootless-setuptool.sh install 2>&1 | grep -vE '^\s*$' || true
fi

log "autostart (systemd --user, linger on)"
systemctl --user enable docker.service >/dev/null 2>&1 || true
systemctl --user restart docker.service
for i in $(seq 1 20); do
  DOCKER_HOST="$SOCK" docker info >/dev/null 2>&1 && break
  sleep 1
done
systemctl --user is-enabled docker.service
systemctl --user is-active docker.service
DOCKER_HOST="$SOCK" docker info --format 'docker {{.ServerVersion}} rootless={{range .SecurityOptions}}{{if eq . "name=rootless"}}yes{{end}}{{end}} cgroup={{.CgroupDriver}}/{{.CgroupVersion}}'

log "DOCKER_HOST in ~/.profile (interactive sessions)"
if ! grep -q 'SHOSHO rootless docker' "${HOME}/.profile" 2>/dev/null; then
  cat >> "${HOME}/.profile" <<EOT

# SHOSHO rootless docker (apps/infra/scripts/shos-user-setup.sh)
export DOCKER_HOST="unix:///run/user/\$(id -u)/docker.sock"
export PATH="\$HOME/bin:\$PATH"
EOT
fi
grep -A2 'SHOSHO rootless docker' "${HOME}/.profile"

log "compose dir ${APP_DIR}"
install -d -m 750 "${APP_DIR}"

log "memory budget (cgroup of user ${UID_})"
slice="/sys/fs/cgroup/user.slice/user-${UID_}.slice"
[ -r "${slice}/memory.max" ] && echo "memory.max=$(cat "${slice}/memory.max") memory.current=$(( $(cat "${slice}/memory.current") / 1024 / 1024 ))M"

log "done. Next: GitHub Secrets STAGING_SSH_USER=$(id -un) / STAGING_SSH_KEY, then push to main."
