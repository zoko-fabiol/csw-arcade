#!/usr/bin/env bash
set -e

LOG_FILE="/var/log/csw-arcade-deploy.log"
exec >> "$LOG_FILE" 2>&1

echo "=========================================================="
echo "[Deploy] $(date -u '+%Y-%m-%d %H:%M:%S UTC') - Nouveau push détecté !"
echo "=========================================================="

cd /opt/csw-arcade

# Nettoyage et mise à jour Git
git fetch origin main
git reset --hard origin/main

# Dépendances si nécessaire
npm install --no-audit --no-fund

# Compilation Web
BUILD_TARGET=web npm run build:web

# Déploiement vers /var/www/csw-arcade
mkdir -p /var/www/csw-arcade
cp -r dist/* /var/www/csw-arcade/
chown -R caddy:caddy /var/www/csw-arcade
chmod -R 755 /var/www/csw-arcade

# Redémarrage du backend Node Netplay & Salons (port 3003) et rechargement Caddy
systemctl restart csw-arcade-backend || true
systemctl reload caddy || true

echo "[Deploy] ✅ Déploiement terminé avec succès à $(date -u '+%Y-%m-%d %H:%M:%S UTC') !"
