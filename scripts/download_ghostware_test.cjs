const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function downloadGhostware() {
  console.log('Downloading neogeo.zip (873KB) from Ghostware...');
  const biosRes = await fetch('https://archive.org/download/NeoGeoRomCollectionByGhostware/neogeo.zip');
  const biosBuf = Buffer.from(await biosRes.arrayBuffer());
  const biosPath = path.resolve(__dirname, '../public/roms/neogeo.zip');
  fs.writeFileSync(biosPath, biosBuf);
  console.log('Saved neogeo.zip:', biosBuf.length, 'bytes');

  console.log('Downloading androdun.zip from Ghostware...');
  const gameRes = await fetch('https://archive.org/download/NeoGeoRomCollectionByGhostware/androdun.zip');
  const gameBuf = Buffer.from(await gameRes.arrayBuffer());
  const gamePath = path.resolve(__dirname, '../public/roms/androdun.zip');
  fs.writeFileSync(gamePath, gameBuf);
  console.log('Saved androdun.zip:', gameBuf.length, 'bytes');

  console.log('\n--- Contents of Ghostware neogeo.zip ---');
  execSync(`tar -tf "${biosPath}"`, { stdio: 'inherit' });

  console.log('\n--- Contents of Ghostware androdun.zip ---');
  execSync(`tar -tf "${gamePath}"`, { stdio: 'inherit' });
}

downloadGhostware();
