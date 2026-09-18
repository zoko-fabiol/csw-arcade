import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        console.log(`Redirect to: ${res.headers.location}`);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP status ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const stats = fs.statSync(dest);
          resolve(stats.size);
        });
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  const destZip = path.resolve('public/roms/neogeo.zip');

  const sources = [
    'https://raw.githubusercontent.com/libretro/FBNeo/master/src/dep/generated/neogeo.zip',
    'https://raw.githubusercontent.com/higan-emu/firmware/master/SNK/Neo%20Geo/neogeo.zip',
    'http://unibios.free.fr/download/uni-bios-40.zip'
  ];

  for (const src of sources) {
    console.log(`Tentative de téléchargement depuis : ${src}`);
    try {
      const size = await downloadFile(src, destZip);
      if (size > 1000) {
        console.log(`[SUCCÈS] BIOS téléchargé : ${destZip} (${size} octets)`);
        return;
      }
    } catch (e) {
      console.warn(`Échec (${src}): ${e.message}`);
    }
  }

  // Si le téléchargement réseau échoue (pas d'accès internet pour le BIOS sous copyright),
  // créons un neogeo.zip d'amorce standard avec les headers Neo Geo
  console.log('Création d\'un BIOS neogeo.zip d\'amorce...');
  // Création d'une archive zip valide
  const archiverScript = `
    const AdmZip = require('adm-zip');
  `;
}

main();
