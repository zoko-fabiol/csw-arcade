const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const zipPath = path.resolve(rootDir, 'csw-arcade-hostinger.zip');

console.log('=== [CSW-Arcade] Début de la compilation pour Hostinger ===');

// 1. S'assurer que le BIOS neogeo.zip est dans public/roms/
const biosRoot = path.resolve(rootDir, 'neogeo.zip');
const biosPublic = path.resolve(rootDir, 'public/roms/neogeo.zip');
if (fs.existsSync(biosRoot) && !fs.existsSync(biosPublic)) {
  console.log('-> Copie de neogeo.zip vers public/roms/neogeo.zip...');
  fs.copyFileSync(biosRoot, biosPublic);
}

// 2. Compilation Vite Web
console.log('-> Lancement de "vite build" (BUILD_TARGET=web)...');
execSync('npx vite build', {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    BUILD_TARGET: 'web',
    NODE_ENV: 'production'
  }
});

// 3. Vérification des fichiers clés dans dist
const requiredFiles = ['.htaccess', 'index.html', 'player.html', 'manifest.json'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(distDir, file))) {
    console.error(`[ERREUR] Fichier requis manquant dans dist : ${file}`);
    process.exit(1);
  }
}

// 4. Création de l'archive ZIP pour Hostinger (chemins standardisés avec '/')
console.log('-> Création de l\'archive csw-arcade-hostinger.zip...');
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // compression maximale
});

output.on('close', () => {
  const sizeMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`\n========================================================`);
  console.log(` SUCCESS : Archive Hostinger prête !`);
  console.log(` Fichier : ${zipPath}`);
  console.log(` Taille  : ${sizeMB} Mo`);
  console.log(` Prêt à être déployé dans le dossier 'public_html/' sur Hostinger.`);
  console.log(`========================================================\n`);
});

archive.on('error', (err) => {
  console.error('[ERREUR Archive]', err);
  process.exit(1);
});

archive.pipe(output);

// Ajout récursif de tous les fichiers de dist/ avec forward slashes '/'
function addDirectory(currentDir, baseDir = '') {
  const items = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(currentDir, item.name);
    const relativePath = path.posix.join(baseDir, item.name);
    if (item.isDirectory()) {
      addDirectory(fullPath, relativePath);
    } else {
      archive.file(fullPath, { name: relativePath });
    }
  }
}

addDirectory(distDir);
archive.finalize();
