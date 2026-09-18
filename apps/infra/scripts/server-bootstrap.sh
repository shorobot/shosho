#!/usr/bin/env bash
# SHOSHO — one-time server bootstrap for an environment (staging|prod).
# Run as root on the server:
#   STAGING_HOST=164-90-235-66.sslip.io CI_PUBKEY="ssh-ed25519 AAAA..." ./server-bootstrap.sh staging
#
# Idempotent. Creates the non-root deploy user `shosho`, /opt/shosho/<env>, nginx vhost,
# certbot TLS for STAGING_HOST, and checks ufw/docker. Does NOT touch other sites on the box.
set -euo pipefail

ENV_NAME="${1:-staging}"
HOST="${STAGING_HOST:?set STAGING_HOST (e.g. 164-90-235-66.sslip.io)}"
CI_PUBKEY="${CI_PUBKEY:?set CI_PUBKEY (public key used by GitHub Actions)}"
ADMIN_PUBKEY="${ADMIN_PUBKEY:-}"
DEPLOY_USER="shosho"
APP_DIR="/opt/shosho/${ENV_NAME}"
REPO_RAW="https://raw.githubusercontent.com/shorobot/shosho/main/apps/infra"

log() { printf '\n==> %s\n' "$*"; }

log "prereqs"
command -v docker >/dev/null || { echo "docker missing — install Docker Engine first"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing (apt install docker-compose-plugin)"; exit 1; }
command -v nginx >/dev/null || apt-get install -y nginx
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx

log "deploy user ${DEPLOY_USER} (non-root, docker group)"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
AK="/home/${DEPLOY_USER}/.ssh/authorized_keys"
touch "$AK"; chmod 600 "$AK"; chown "$DEPLOY_USER:$DEPLOY_USER" "$AK"
grep -qF "$CI_PUBKEY" "$AK" || echo "$CI_PUBKEY" >> "$AK"
[ -n "$ADMIN_PUBKEY" ] && { grep -qF "$ADMIN_PUBKEY" "$AK" || echo "$ADMIN_PUBKEY" >> "$AK"; }

log "app dir ${APP_DIR}"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

log "nginx vhost shosho-${ENV_NAME} for ${HOST}"
curl -fsSL "${REPO_RAW}/nginx/shosho-proxy.conf" -o /etc/nginx/snippets/shosho-proxy.conf
curl -fsSL "${REPO_RAW}/nginx/shosho-staging.conf" | sed "s/__STAGING_HOST__/${HOST}/" \
  > "/etc/nginx/sites-available/shosho-${ENV_NAME}"
ln -sfn "/etc/nginx/sites-available/shosho-${ENV_NAME}" "/etc/nginx/sites-enabled/shosho-${ENV_NAME}"
nginx -t && systemctl reload nginx

log "firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw status numbered | head -20
else
  echo "ufw not active — skipping (server uses provider firewall / fail2ban)"
fi

log "TLS via certbot for ${HOST}"
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  -d "$HOST" --redirect || echo "certbot failed — check DNS/port 80 and re-run"

log "done. Next: GitHub Secrets ${ENV_NAME^^}_HOST / _SSH_USER / _SSH_KEY, then push to main."
