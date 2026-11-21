const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ce script s'exécute uniquement sur le serveur Linux VPS (/opt/csw-arcade) lors de "npm run build:web"
if (process.platform !== 'linux') {
  process.exit(0);
}

console.log('[PostBuild VPS] Vérification et redémarrage du service csw-arcade-backend...');

try {
  // 1. Mettre à jour /opt/csw-arcade/deploy.sh si présent dans deploy/deploy.sh
  const srcDeploy = path.resolve(__dirname, '../deploy/deploy.sh');
  const destDeploy = '/opt/csw-arcade/deploy.sh';
  if (fs.existsSync(srcDeploy) && fs.existsSync('/opt/csw-arcade')) {
    fs.copyFileSync(srcDeploy, destDeploy);
    fs.chmodSync(destDeploy, 0o755);
    console.log('[PostBuild VPS] /opt/csw-arcade/deploy.sh synchronisé.');
  }
} catch (err) {
  console.warn('[PostBuild VPS] Warning sync deploy.sh:', err.message);
}

try {
  // 2. Redémarrer le serveur Node Netplay & Salons (port 3003) pour charger le nouveau netplayHub.js
  execSync('systemctl restart csw-arcade-backend', { stdio: 'inherit' });
  console.log('[PostBuild VPS] ✅ Service csw-arcade-backend redémarré avec succès.');
} catch (err) {
  console.warn('[PostBuild VPS] Warning restart csw-arcade-backend:', err.message);
}
