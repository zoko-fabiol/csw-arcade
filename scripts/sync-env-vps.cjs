const fs = require('fs');
const path = require('path');

async function main() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    console.error('[Sync ENV] Fichier .env introuvable en local.');
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const res = await fetch('https://csw-arcade.tech/api/saspay/sync-env', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-deploy-secret': 'csw_arcade_deploy_secure_key_2026',
    },
    body: JSON.stringify({ envContent }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.ok) {
    console.log('[Sync ENV] ✅ Fichier .env synchronisé sur le VPS :', data.path);
  } else {
    console.error('[Sync ENV] ❌ Échec :', res.status, data);
    process.exit(1);
  }
}

main();
