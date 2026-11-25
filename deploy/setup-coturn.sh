#!/usr/bin/env bash
# ==============================================================================
# CSW-Arcade — Script d'installation & durcissement coturn (UDP 3478 + TLS 5349)
# Usage sur votre VPS Ubuntu/Debian :
#   sudo bash deploy/setup-coturn.sh csw-arcade.tech
# ==============================================================================
set -euo pipefail

DOMAIN="${1:-csw-arcade.tech}"
PUBLIC_IP="${2:-$(curl -4 -s https://ifconfig.me || hostname -I | awk '{print $1}')}"
TURN_SECRET="$(openssl rand -hex 32)"

echo "[1/4] Installation de coturn..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn openssl curl

echo "[2/4] Configuration sécurisée /etc/turnserver.conf pour ${DOMAIN} (${PUBLIC_IP})..."
cp /etc/turnserver.conf /etc/turnserver.conf.bak.$(date +%s) 2>/dev/null || true

CERT_LINE=""
KEY_LINE=""
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  CERT_LINE="cert=/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  KEY_LINE="pkey=/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  chmod 640 /etc/letsencrypt/live/${DOMAIN}/privkey.pem || true
fi

cat >/etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
external-ip=${PUBLIC_IP}
realm=${DOMAIN}
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
min-port=49152
max-port=65535
total-quota=300
bps-capacity=0
stale-nonce=600
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
# Protection anti-rebond SSRF vers les réseaux locaux privés du VPS
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
${CERT_LINE}
${KEY_LINE}
EOF

sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true

echo "[3/4] Ouverture des ports pare-feu (si UFW est actif)..."
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 3478/udp
  ufw allow 3478/tcp
  ufw allow 5349/tcp
  ufw allow 49152:65535/udp
fi

echo "[4/4] Démarrage du service coturn..."
systemctl enable coturn
systemctl restart coturn

echo ""
echo "=================================================================="
echo "✅ coturn est actif sur ${DOMAIN} (${PUBLIC_IP}) !"
echo "Ajoutez ces 2 variables d'environnement au service Node CSW-Arcade :"
echo ""
echo "TURN_HOST=${DOMAIN}"
echo "TURN_SHARED_SECRET=${TURN_SECRET}"
echo "=================================================================="
