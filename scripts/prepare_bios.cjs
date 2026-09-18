const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const tempDir = path.join(rootDir, 'temp_bios');
const publicRoms = path.join(rootDir, 'public', 'roms');
const targetZip = path.join(publicRoms, 'neogeo.zip');

console.log('--- Préparation du BIOS Neo Geo Universel ---');

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

// 1. Extraire public/roms/neogeo.zip si présent
if (fs.existsSync(targetZip)) {
  try {
    execSync(`tar -xf "${targetZip}" -C "${tempDir}"`);
  } catch (e) {
    console.warn('Erreur extraction public/roms/neogeo.zip:', e.message);
  }
}

// 1b. Extraire neogeo.zip de l'émulateur original NeoRAGEx
const emuZip = 'E:/Telechargement/EMULADORDENEOGEO/NeoRAGEx_5.0/NEO GEO/NeoRAGEx_5.0/neogeo.zip';
if (fs.existsSync(emuZip)) {
  try {
    execSync(`tar -xf "${emuZip}" -C "${tempDir}"`);
    console.log('Extrait neogeo.zip original NeoRAGEx.');
  } catch (e) {
    console.warn('Erreur extraction emu neogeo.zip:', e.message);
  }
}

// 2. Extraire le neogeo.zip déposé à la racine
const userZip = path.join(rootDir, 'neogeo.zip');
if (fs.existsSync(userZip)) {
  try {
    execSync(`tar -xf "${userZip}" -C "${tempDir}"`);
    console.log('Extrait neogeo.zip racine.');
  } catch (e) {
    console.warn('Erreur extraction user neogeo.zip:', e.message);
  }
}

// 3. Copier neo-geo.rom de la racine
const userRom = path.join(rootDir, 'neo-geo.rom');
if (fs.existsSync(userRom)) {
  fs.copyFileSync(userRom, path.join(tempDir, 'neo-geo.rom'));
  console.log('Copié neo-geo.rom racine.');
}

// 4. Créer les alias de compatibilité totale MAME / FinalBurn Neo / NeoRAGEx
const aliasMap = {
  'neo-geo.rom': ['sp-s2.sp1', 'asia-s3.rom', 'sp-e.sp1', 'neo-epo.bin'],
  'uni-bios.rom': ['uni-bios_4_0.rom', 'uni-bios_3_3.rom'],
  'ng-lo.rom': ['000-lo.lo'],
  'ng-sfix.rom': ['sfix.sfix'],
  'ng-sm1.rom': ['sm1.sm1']
};

for (const [source, aliases] of Object.entries(aliasMap)) {
  const srcPath = path.join(tempDir, source);
  if (fs.existsSync(srcPath)) {
    for (const alias of aliases) {
      fs.copyFileSync(srcPath, path.join(tempDir, alias));
    }
  }
}

// Supprimer les éventuels fichiers .txt
const files = fs.readdirSync(tempDir);
for (const file of files) {
  if (file.endsWith('.txt')) {
    fs.unlinkSync(path.join(tempDir, file));
  }
}

console.log('Fichiers assemblés dans le BIOS :', fs.readdirSync(tempDir));

// 5. Recompresser dans public/roms/neogeo.zip
if (fs.existsSync(targetZip)) {
  fs.unlinkSync(targetZip);
}

// Créer le zip avec tar -a
execSync(`tar -a -cf "${targetZip}" *`, { cwd: tempDir });

// Nettoyer
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('Succès ! Nouveau public/roms/neogeo.zip créé avec succès.');
