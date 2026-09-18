/**
 * Script de pré-téléchargement et synchronisation du Romset FBNeo Neo Geo MVS
 * Usage: node scripts/download_all_mvs_roms.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FBNEO_DIR = path.resolve(__dirname, '../public/roms/fbneo');
if (!fs.existsSync(FBNEO_DIR)) {
  fs.mkdirSync(FBNEO_DIR, { recursive: true });
}

// Liste officielle des ROMsets MVS
const MVS_ROMS = [
  '2020bb', '3countb', 'alpham2', 'androdun', 'aodk', 'aof', 'aof2', 'aof3',
  'bakatono', 'bangbead', 'bjourney', 'blazstar', 'breakers', 'breakrev', 'bstars',
  'bstars2', 'burningf', 'crsword', 'ctomaday', 'cyberlip', 'doubledr', 'eightman',
  'fatfursp', 'fatfury1', 'fatfury2', 'fatfury3', 'fbfrenzy', 'fightfev', 'flipshot',
  'galaxyfg', 'ganryu', 'garou', 'goalx3', 'gowcaizr', 'gpilots', 'gururin',
  'irrmaze', 'janshin', 'joyjoy', 'kabukikl', 'karnovr', 'kizuna', 'kof2000',
  'kof2001', 'kof2002', 'kof2003', 'kof94', 'kof95', 'kof96', 'kof97', 'kof98',
  'kof99', 'kotm', 'kotm2', 'lastblad', 'lastbld2', 'lbowling', 'legendos',
  'lresort', 'magdrop2', 'magdrop3', 'maglord', 'maglordh', 'mahretsu', 'matrim',
  'minnasno', 'moneyex', 'mslug', 'mslug2', 'mslug3', 'mslug4', 'mslug5', 'mslugx',
  'mutnat', 'nam1975', 'ncombat', 'ncommand', 'neobombe', 'neocup98', 'neodrift',
  'neomrdo', 'ninjamas', 'nitd', 'overtop', 'panicbom', 'pbobbl2n', 'pbobblen',
  'pgoal', 'pnyaa', 'popbounc', 'preisle2', 'pspikes2', 'pulstar', 'puzzledp',
  'puzzldpr', 'quizdai2', 'quizdais', 'quizkof', 'ragnagrd', 'rbff1', 'rbff2',
  'rbffspec', 'ridhero', 'robarma', 'rotd', 's1945p', 'samsho', 'samsho2',
  'samsho3', 'samsho4', 'samsho5', 'samsh5sp', 'savagere', 'sdodgeb', 'sengoku',
  'sengoku2', 'sengoku3', 'shocktr2', 'shocktro', 'socbrawl', 'sonicwi2',
  'sonicwi3', 'spinmast', 'ssideki', 'ssideki2', 'ssideki3', 'ssideki4',
  'stakwin', 'stakwin2', 'strhoop', 'superspy', 'svc', 'tophuntr', 'tpgolf',
  'trally', 'turfmast', 'twinspri', 'tws96', 'viewpoin', 'wakuwak7', 'wh1',
  'wh2', 'wh2j', 'whp', 'wjammers', 'zedblade', 'zintrckn', 'zupapa'
];

console.log(`=== Synchronisation Romset FBNeo Neo Geo MVS (${MVS_ROMS.length} jeux) ===`);
console.log(`Destination: ${FBNEO_DIR}\n`);

async function run() {
  let downloaded = 0;
  let skipped = 0;

  for (let i = 0; i < MVS_ROMS.length; i++) {
    const rom = MVS_ROMS[i];
    const targetFile = path.join(FBNEO_DIR, `${rom}.zip`);

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 10000) {
      console.log(`[${i + 1}/${MVS_ROMS.length}] ✓ ${rom}.zip déjà présent.`);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${MVS_ROMS.length}] Téléchargement de ${rom}.zip...`);
    try {
      execSync(`curl.exe -L -s -o "${targetFile}" "https://archive.org/download/neo-geo-mvs-romset/${rom}.zip"`, {
        stdio: 'inherit'
      });
      const size = fs.existsSync(targetFile) ? fs.statSync(targetFile).size : 0;
      console.log(`[${i + 1}/${MVS_ROMS.length}] ✓ ${rom}.zip téléchargé (${Math.round(size / 1024)} KB)`);
      downloaded++;
    } catch (err) {
      console.error(`[${i + 1}/${MVS_ROMS.length}] ✗ Erreur pour ${rom}:`, err.message);
    }
  }

  console.log(`\n=== Terminé: ${downloaded} téléchargés, ${skipped} déjà présents. ===`);
}

run();
