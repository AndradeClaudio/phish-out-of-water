#!/usr/bin/env bash
# Provisions a fresh Vultr Cloud Compute instance (Ubuntu 24.04) to run Phish Out of Water.
# Run as root from the repository root:  sudo bash deploy/setup-vm.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="phishoutofwater"

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Installing gVisor (runsc) so every sandbox gets its own user-space kernel"
if ! command -v runsc >/dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update && apt-get install -y runsc
  runsc install
  systemctl restart docker
fi

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy (automatic HTTPS in front of the app)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "==> Hardening SSH: keys only (public VMs see thousands of password guesses a day)"
cat > /etc/ssh/sshd_config.d/00-pootw-hardening.conf <<'EOF'
# Key-only SSH. Loaded first, so it wins over cloud-init defaults.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh
DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban
systemctl enable --now fail2ban

echo "==> Creating the service user (allowed to start sandboxes, nothing else)"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
usermod -aG docker "$APP_USER"

echo "==> Isolating the sandbox network"
bash "$APP_DIR/deploy/setup-sandbox-network.sh"
install -m 0755 "$APP_DIR/deploy/setup-sandbox-network.sh" /usr/local/sbin/pootw-sandbox-network
install -m 0644 "$APP_DIR/deploy/pootw-sandbox-network.service" /etc/systemd/system/
systemctl enable pootw-sandbox-network.service

echo "==> Building the detonation sandbox image"
docker build -t phish-out-of-water/detonator:latest "$APP_DIR/sandbox"

echo "==> Building the web app"
cd "$APP_DIR"
npm ci
npm run build
npm prune --omit=dev
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i 's/^SANDBOX_RUNTIME=.*/SANDBOX_RUNTIME=runsc/' "$APP_DIR/.env"
  sed -i 's#^SANDBOX_RESOLV_CONF=.*#SANDBOX_RESOLV_CONF=/etc/pootw/sandbox-resolv.conf#' "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "!!  Edit $APP_DIR/.env and set VULTR_INFERENCE_API_KEY, then run: systemctl restart phish-out-of-water"
fi

echo "==> Installing the app service"
sed "s#__APP_DIR__#$APP_DIR#g" "$APP_DIR/deploy/phish-out-of-water.service" > /etc/systemd/system/phish-out-of-water.service
systemctl daemon-reload
systemctl enable --now phish-out-of-water.service

echo "==> Serving over HTTPS"
# Vultr's Ubuntu images ship with ufw enabled and only SSH open.
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
PUBLIC_IP="$(curl -fsS http://169.254.169.254/v1/interfaces/0/ipv4/address 2>/dev/null || curl -fsS https://api.ipify.org)"
SITE_ADDRESS="${SITE_ADDRESS:-${PUBLIC_IP//./-}.sslip.io}"
cat > /etc/caddy/Caddyfile <<EOF
$SITE_ADDRESS {
  encode gzip
  reverse_proxy 127.0.0.1:8080
}
EOF
systemctl reload caddy

echo "==> Done. Open https://$SITE_ADDRESS"
