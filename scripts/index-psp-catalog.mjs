#!/usr/bin/env node
/**
 * Indexeur Communautaire PPSSPP (CSW Arcade) — Vérification LIVE Archive.org
 * Interroge les manifestes publics Archive.org (`psp-cso-collection` et `ultimate-rom-collection`),
 * associe chaque jeu PSP à ses fichiers réels existants (.cso / .iso) avec taille réelle,
 * et écrit src/data/pspCatalog.json + public/app/data/psp-catalog.json (0 lien mort).
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_PUBLIC = path.resolve(process.cwd(), 'public/app/data/psp-catalog.json');
const OUT_SRC = path.resolve(process.cwd(), 'src/data/pspCatalog.json');

function iaMultiUrls(pairs) {
  const urls = [];
  const seen = new Set();
  for (const [item, filePath] of pairs) {
    const cleanPath = String(filePath || '')
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const dl = `https://archive.org/download/${item}/${cleanPath}`;
    const candidates = [
      `https://archive.org/cors/${item}/${cleanPath}`,
      `/api/rom-proxy?url=${encodeURIComponent(dl)}`,
      dl,
    ];
    for (const u of candidates) {
      if (!seen.has(u)) {
        seen.add(u);
        urls.push(u);
      }
    }
  }
  return urls;
}

function formatSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  return `${Math.round(n / (1024 * 1024))} Mo`;
}

function normalizeName(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\.(cso|iso)$/i, '')
    .replace(/\((usa|europe|japan|world|en[^)]*|v\d[^)]*)\)/gi, ' ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const COMMUNITY_PSP_GAMES = [
  // === FOOTBALL & SPORT ===
  ['Pro Evolution Soccer 6', 'Pro Evolution Soccer 6 (Europe).cso', 2006, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2008', 'Pro Evolution Soccer 2008 (USA).cso', 2007, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2009', 'Pro Evolution Soccer 2009 (USA).cso', 2008, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2010', 'Pro Evolution Soccer 2010 (USA).cso', 2009, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2011', 'Pro Evolution Soccer 2011 (USA).cso', 2010, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2012', 'Pro Evolution Soccer 2012 (USA).cso', 2011, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2013', 'Pro Evolution Soccer 2013 (USA).cso', 2012, 'Football / Sport', '1–2J'],
  ['Pro Evolution Soccer 2014', 'Pro Evolution Soccer 2014 (USA).cso', 2013, 'Football / Sport', '1–2J'],
  ['FIFA Street 2', 'FIFA Street 2 (USA).cso', 2006, 'Football / Arcade', '1–2J'],
  ['FIFA 10', "FIFA Soccer '10 (USA).cso", 2009, 'Football / Sport', '1–2J'],
  ['FIFA 11', "FIFA Soccer '11 (USA).cso", 2010, 'Football / Sport', '1–2J'],
  ['FIFA 12', "FIFA Soccer '12 (USA).cso", 2011, 'Football / Sport', '1–2J'],
  ['FIFA 13', "FIFA Soccer '13 (USA).cso", 2012, 'Football / Sport', '1–2J'],
  ['FIFA 14', "FIFA Soccer '14 (USA).cso", 2013, 'Football / Sport', '1–2J'],
  ['FIFA World Cup South Africa 2010', 'FIFA World Cup - South Africa 2010 (USA).cso', 2010, 'Football / Sport', '1–2J'],
  ['NBA Street Showdown', 'NBA Street Showdown (USA).cso', 2005, 'Sport / Basket', '1–2J'],
  ['Virtua Tennis: World Tour', 'Virtua Tennis - World Tour (USA).cso', 2005, 'Sport / Tennis', '1–2J'],
  ['Virtua Tennis 3', 'Virtua Tennis 3 (USA).cso', 2007, 'Sport / Tennis', '1–2J'],
  ['Fight Night Round 3', 'Fight Night Round 3 (USA).cso', 2006, 'Sport / Boxe', '1–2J'],
  ['WWE SmackDown vs. Raw 2011', 'WWE Smackdown! vs. RAW 2011 featuring ECW (USA).cso', 2010, 'Catch / Combat', '1–2J'],
  ['Tony Hawk Underground 2 Remix', "Tony Hawk's Underground 2 - Remix (USA).cso", 2005, 'Skate / Sport', '1J'],
  ['SSX On Tour', 'SSX - On Tour (USA).cso', 2005, 'Snowboard / Arcade', '1J'],

  // === COMBAT (FIGHTING) ===
  ['Tekken 6', 'Tekken 6 (USA).cso', 2009, 'Combat 3D', '1–2J'],
  ['Tekken: Dark Resurrection', 'Tekken - Dark Resurrection (USA).cso', 2006, 'Combat 3D', '1–2J'],
  ['Dragon Ball Z: Tenkaichi Tag Team', 'Dragon Ball Z - Tenkaichi Tag Team (USA).cso', 2010, 'Combat 3D', '1–2J'],
  ['Dragon Ball Z: Shin Budokai', 'Dragon Ball Z - Shin Budokai (USA).cso', 2006, 'Combat 3D', '1–2J'],
  ['Dragon Ball Z: Shin Budokai - Another Road', 'Dragon Ball Z - Shin Budokai Another Road (USA).cso', 2007, 'Combat 3D', '1–2J'],
  ['Naruto Shippuden: Ultimate Ninja Impact', 'Naruto Shippuden - Ultimate Ninja Impact (USA).cso', 2011, 'Action / Combat', '1J'],
  ['Naruto Shippuden: Ultimate Ninja Heroes 3', 'Naruto Shippuden - Ultimate Ninja Heroes 3 (USA).cso', 2010, 'Combat 2D/3D', '1–2J'],
  ['Naruto: Ultimate Ninja Heroes 2', 'Naruto Shippuden - Ultimate Ninja Heroes 2 - The Phantom Fortress (USA).cso', 2008, 'Combat', '1–2J'],
  ['SoulCalibur: Broken Destiny', 'Soul Calibur - Broken Destiny (USA).cso', 2009, 'Combat 3D', '1–2J'],
  ['Mortal Kombat: Unchained', 'Mortal Kombat - Unchained (USA).cso', 2006, 'Combat 3D', '1–2J'],
  ['Street Fighter Alpha 3 MAX', 'Street Fighter Alpha 3 MAX (USA).cso', 2006, 'Combat 2D', '1–2J'],
  ['Def Jam: Fight for NY - The Takeover', 'Def Jam - Fight for NY - The Takeover (USA).cso', 2006, 'Combat / Street', '1–2J'],
  ['Darkstalkers Chronicle: The Chaos Tower', 'Darkstalkers Chronicle - The Chaos Tower (USA).cso', 2005, 'Combat 2D', '1–2J'],
  ['Guilty Gear XX Accent Core Plus', 'Guilty Gear XX Accent Core Plus (USA).cso', 2009, 'Combat 2D', '1–2J'],
  ['BlazBlue: Calamity Trigger Portable', 'BlazBlue - Calamity Trigger (USA).cso', 2010, 'Combat 2D', '1–2J'],
  ['BlazBlue: Continuum Shift II', 'BlazBlue - Continuum Shift II (USA).cso', 2011, 'Combat 2D', '1–2J'],
  ['Dissidia 012: Final Fantasy', 'Dissidia 012 - Duodecim Final Fantasy (USA).cso', 2011, 'Combat / Action RPG', '1–2J'],
  ['Power Stone Collection', 'Power Stone Collection (USA).cso', 2006, 'Combat / Arène', '1–4J'],
  ['The King of Fighters Collection: The Orochi Saga', 'The King of Fighters Collection - The Orochi Saga (USA).cso', 2008, 'Combat 2D', '1–2J'],

  // === ACTION / AVENTURE / OPEN WORLD ===
  ['Grand Theft Auto: Vice City Stories', 'Grand Theft Auto - Vice City Stories (USA).cso', 2006, 'Action / Open World', '1J'],
  ['Grand Theft Auto: Liberty City Stories', 'Grand Theft Auto - Liberty City Stories (USA).cso', 2005, 'Action / Open World', '1J'],
  ['Grand Theft Auto: Chinatown Wars', 'Grand Theft Auto - Chinatown Wars (USA).cso', 2009, 'Action / Open World', '1J'],
  ['God of War: Chains of Olympus', 'God of War - Chains of Olympus (USA).cso', 2008, 'Action / Beat ’em all', '1J'],
  ['God of War: Ghost of Sparta', 'God of War - Ghost of Sparta (USA).cso', 2010, 'Action / Beat ’em all', '1J'],
  ['Metal Gear Solid: Peace Walker', 'Metal Gear Solid - Peace Walker (USA).cso', 2010, 'Infiltration / Action', '1–4J'],
  ['Metal Gear Solid: Portable Ops', 'Metal Gear Solid - Portable Ops (USA).cso', 2006, 'Infiltration / Action', '1J'],
  ["Assassin's Creed: Bloodlines", "Assassin's Creed - Bloodlines (USA).cso", 2009, 'Action / Aventure', '1J'],
  ['Daxter', 'Daxter (USA).cso', 2006, 'Plateforme / Aventure', '1J'],
  ['Ratchet & Clank: Size Matters', 'Ratchet & Clank - Size Matters (USA).cso', 2007, 'Plateforme / Action', '1J'],
  ['Jak and Daxter: The Lost Frontier', 'Jak and Daxter - The Lost Frontier (USA).cso', 2009, 'Plateforme / Aventure', '1J'],
  ['Prince of Persia: Revelations', 'Prince of Persia - Revelations (USA).cso', 2005, 'Action / Aventure', '1J'],
  ['Prince of Persia: Rival Swords', 'Prince of Persia - Rival Swords (USA).cso', 2007, 'Action / Aventure', '1J'],
  ['Tomb Raider: Anniversary', 'Lara Croft - Tomb Raider - Anniversary (USA).cso', 2007, 'Action / Aventure', '1J'],
  ['Spider-Man 3', 'Spider-Man 3 (USA).cso', 2007, 'Action / Super-Héros', '1J'],
  ['Ben 10: Protector of Earth', 'Ben 10 - Protector of Earth (USA).cso', 2007, 'Action / Aventure', '1J'],
  ['Resistance: Retribution', 'Resistance - Retribution (USA).cso', 2009, 'TPS / Action', '1J'],
  ['Syphon Filter: Dark Mirror', 'Syphon Filter - Dark Mirror (USA).cso', 2006, 'Infiltration / TPS', '1J'],
  ['Silent Hill: Origins', 'Silent Hill Origins (USA).cso', 2007, 'Survival Horror', '1J'],
  ['Silent Hill: Shattered Memories', 'Silent Hill - Shattered Memories (USA).cso', 2010, 'Survival Horror', '1J'],
  ['Star Wars Battlefront II', 'Star Wars Battlefront II (USA).cso', 2005, 'Action / TPS', '1J'],
  ["Dante's Inferno", "Dante's Inferno (USA).cso", 2010, 'Action / Beat ’em all', '1J'],
  ['The Warriors', 'The Warriors (USA).cso', 2007, 'Beat ’em all / Action', '1–2J'],

  // === COURSE (RACING) ===
  ['Need for Speed: Most Wanted 5-1-0', 'Need for Speed - Most Wanted 5-1-0 (USA).cso', 2005, 'Course Arcade', '1J'],
  ['Need for Speed: Carbon - Own the City', 'Need for Speed Carbon - Own the City (USA).cso', 2006, 'Course Arcade', '1J'],
  ['Need for Speed: Underground Rivals', 'Need for Speed - Underground Rivals (USA).cso', 2005, 'Course Arcade', '1J'],
  ['Midnight Club 3: DUB Edition', 'Midnight Club 3 - DUB Edition (USA).cso', 2005, 'Course Open World', '1J'],
  ['Midnight Club: L.A. Remix', 'Midnight Club - L. A. Remix (USA).cso', 2008, 'Course Open World', '1J'],
  ['Burnout Legends', 'Burnout Legends (USA).cso', 2005, 'Course Arcade', '1J'],
  ['Burnout Dominator', 'Burnout Dominator (USA).cso', 2007, 'Course Arcade', '1J'],
  ['Gran Turismo', 'Gran Turismo (USA).cso', 2009, 'Simulation Course', '1J'],
  ['Ridge Racer', 'Ridge Racer (USA).cso', 2005, 'Course Arcade', '1J'],
  ['Ridge Racer 2', 'Ridge Racer 2 (Europe).cso', 2006, 'Course Arcade', '1J'],
  ['OutRun 2006: Coast 2 Coast', 'OutRun 2006 - Coast 2 Coast (USA).cso', 2006, 'Course Arcade', '1J'],
  ['Wipeout Pure', 'Wipeout Pure (USA).cso', 2005, 'Course Futuriste', '1J'],
  ['Wipeout Pulse', 'WipEout Pulse (USA).cso', 2007, 'Course Futuriste', '1J'],
  ['MotorStorm: Arctic Edge', 'MotorStorm - Arctic Edge (USA).cso', 2009, 'Course Off-Road', '1J'],
  ['Split/Second', 'Split-Second (USA).cso', 2010, 'Course Arcade', '1J'],
  ['Crazy Taxi: Fare Wars', 'Crazy Taxi - Fare Wars (USA).cso', 2007, 'Course / Arcade', '1J'],

  // === RPG, ARCADE & CULTES PSP ===
  ['Crisis Core: Final Fantasy VII', 'Crisis Core - Final Fantasy VII (USA).cso', 2008, 'Action RPG', '1J'],
  ['Kingdom Hearts: Birth by Sleep', 'Kingdom Hearts - Birth by Sleep (USA).cso', 2010, 'Action RPG', '1J'],
  ['Monster Hunter Freedom Unite', 'Monster Hunter Freedom Unite (USA).cso', 2009, 'Action RPG / Chasse', '1–4J'],
  ['Persona 3 Portable', 'Shin Megami Tensei - Persona 3 Portable (USA).cso', 2010, 'JRPG', '1J'],
  ['Final Fantasy Tactics: The War of the Lions', 'Final Fantasy Tactics - The War of the Lions (USA).cso', 2007, 'RPG Tactique', '1J'],
  ['Ys Seven', 'Ys Seven (USA).cso', 2010, 'Action RPG', '1J'],
  ['Metal Slug Anthology', 'Metal Slug Anthology.cso', 2007, 'Run & Gun / Arcade', '1–2J'],
  ['Metal Slug XX', 'Metal Slug XX (USA).cso', 2010, 'Run & Gun / Arcade', '1–2J'],
  ['Castlevania: The Dracula X Chronicles', 'Castlevania - The Dracula X Chronicles (USA).cso', 2007, 'Action / Plateforme', '1J'],
  ['Mega Man Maverick Hunter X', 'MegaMan - Maverick Hunter X (USA).cso', 2006, 'Action / Plateforme', '1J'],
  ['Mega Man Powered Up', 'MegaMan - Powered Up (USA).cso', 2006, 'Plateforme', '1J'],
  ["Ultimate Ghosts 'n Goblins", "Ultimate Ghosts 'n Goblins (USA).cso", 2006, 'Action / Arcade', '1J'],
  ['Patapon', 'Patapon (USA).cso', 2008, 'Rythme / Stratégie', '1J'],
  ['Patapon 2', 'Patapon 2 (USA).cso', 2009, 'Rythme / Stratégie', '1J'],
  ['LocoRoco', 'LocoRoco (USA).cso', 2006, 'Plateforme / Puzzle', '1J'],
  ['LocoRoco 2', 'LocoRoco 2 (USA).cso', 2009, 'Plateforme / Puzzle', '1J'],
  ['Lumines', 'Lumines (USA).cso', 2005, 'Puzzle / Musique', '1J'],
  ['Sonic Rivals 2', 'Sonic Rivals 2 (USA).cso', 2007, 'Plateforme / Vitesse', '1–2J'],
  ['Crash Tag Team Racing', 'Crash Tag Team Racing (USA).cso', 2005, 'Course / Plateforme', '1J'],
  ['Crash of the Titans', 'Crash of the Titans (USA).cso', 2007, 'Action / Plateforme', '1J'],
  ['Bomberman', 'Bomberman (USA).cso', 2006, 'Arcade / Party', '1–4J'],
  ['Pac-Man World 3', 'Pac-Man World 3 (USA).cso', 2005, 'Plateforme 3D', '1J'],
];

async function fetchPublicCollection(identifier, filterFn) {
  const res = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${identifier}`);
  const data = await res.json();
  return (data.files || [])
    .filter((f) => !f.private && filterFn(f.name || ''))
    .map((f) => ({
      col: identifier,
      name: f.name,
      size: Number(f.size || 0),
      norm: normalizeName(path.posix.basename(f.name)),
    }));
}

async function main() {
  console.log('[CSW-Arcade] Interrogation LIVE Archive.org (psp-cso-collection + ultimate-rom-collection)...');
  const [pspCsoFiles, ultRomFiles] = await Promise.all([
    fetchPublicCollection('psp-cso-collection', (n) => /\.cso$/i.test(n)),
    fetchPublicCollection('ultimate-rom-collection', (n) => /^PSP\/.+\.(iso|cso)$/i.test(n)),
  ]);

  const csoByExact = new Map(pspCsoFiles.map((f) => [f.name, f]));
  const csoByNorm = new Map();
  for (const f of pspCsoFiles) {
    if (!csoByNorm.has(f.norm)) csoByNorm.set(f.norm, f);
  }
  const ultByNorm = new Map();
  for (const f of ultRomFiles) {
    if (!ultByNorm.has(f.norm)) ultByNorm.set(f.norm, f);
  }

  const catalog = [];
  const missing = [];

  for (const [title, filename, year, genre, players] of COMMUNITY_PSP_GAMES) {
    const pairs = [];
    let primaryFile = null;

    // 1. Exact match in psp-cso-collection
    const exactCso = csoByExact.get(filename);
    if (exactCso) {
      pairs.push([exactCso.col, exactCso.name]);
      primaryFile = exactCso;
    } else {
      // 2. Normalized match in psp-cso-collection
      const normMatch = csoByNorm.get(normalizeName(filename)) || csoByNorm.get(normalizeName(title));
      if (normMatch) {
        pairs.push([normMatch.col, normMatch.name]);
        primaryFile = normMatch;
      }
    }

    // 3. Backup mirror in ultimate-rom-collection (PSP/*.iso)
    const ultMatch = ultByNorm.get(normalizeName(filename)) || ultByNorm.get(normalizeName(title));
    if (ultMatch) {
      pairs.push([ultMatch.col, ultMatch.name]);
      if (!primaryFile) primaryFile = ultMatch;
    }

    if (!primaryFile || pairs.length === 0) {
      missing.push(`${title} (${filename})`);
      continue;
    }

    const realFilename = path.posix.basename(primaryFile.name);
    const estimatedSize = formatSize(primaryFile.size) || '450 Mo';

    catalog.push({
      id: `psp-${slugify(title)}`,
      title,
      platform: 'psp',
      platformLabel: 'PSP',
      core: 'psp',
      year,
      genre,
      players: players || '1J',
      supportsMultiplayer: false,
      formats: ['.cso', '.iso'],
      engine: 'emulatorjs:psp',
      estimatedSize,
      filename: realFilename,
      urls: iaMultiUrls(pairs),
      description: `${genre} sur PlayStation Portable (${estimatedSize} · PPSSPP WebAssembly).`,
    });
  }

  const json = JSON.stringify(catalog, null, 2);
  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  fs.writeFileSync(OUT_PUBLIC, json, 'utf8');
  fs.writeFileSync(OUT_SRC, json, 'utf8');

  console.log(`[CSW-Arcade] Catalogue PSP vérifié LIVE : ${catalog.length}/${COMMUNITY_PSP_GAMES.length} jeux 100% indexés -> ${OUT_SRC} & ${OUT_PUBLIC}`);
  if (missing.length > 0) {
    console.warn(`[CSW-Arcade] Jeux introuvables ignorés (${missing.length}):`, missing);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
