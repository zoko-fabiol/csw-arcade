import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SOLO_ONLY_CORES,
  isJ2meGame,
  parseMaxPlayers,
  supportsOnlineMultiplayer,
} from '../src/utils/gameCapabilities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readJson(relPath) {
  const fullPath = path.join(rootDir, relPath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function assertEntryValid(catalogName, entry) {
  assert.equal(
    typeof entry.supportsMultiplayer,
    'boolean',
    `[${catalogName}] ${entry.id || entry.title}: missing boolean supportsMultiplayer`
  );

  const hasValidPlayers =
    (typeof entry.players === 'string' && entry.players.trim().length > 0) ||
    (typeof entry.players === 'number' && Number.isFinite(entry.players) && entry.players >= 1);
  assert.equal(
    hasValidPlayers,
    true,
    `[${catalogName}] ${entry.id || entry.title}: invalid or missing players (${JSON.stringify(entry.players)})`
  );

  const computed = supportsOnlineMultiplayer(entry);
  const maxPlayers = parseMaxPlayers(entry.players);

  if (entry.supportsMultiplayer === false) {
    assert.equal(
      computed,
      false,
      `[${catalogName}] ${entry.id}: supportsMultiplayer is false but supportsOnlineMultiplayer returned true`
    );
    if (typeof entry.description === 'string') {
      assert.equal(
        /netplay\s*1v1\s*p2p/i.test(entry.description),
        false,
        `[${catalogName}] ${entry.id}: solo entry description still claims Netplay 1v1 P2P`
      );
    }
  } else {
    assert.equal(
      computed,
      true,
      `[${catalogName}] ${entry.id}: supportsMultiplayer is true but supportsOnlineMultiplayer returned false`
    );
    assert.ok(
      maxPlayers >= 2,
      `[${catalogName}] ${entry.id}: supportsMultiplayer is true but maxPlayers is ${maxPlayers}`
    );
  }

  if (isJ2meGame(entry)) {
    assert.equal(entry.supportsMultiplayer, false, `[${catalogName}] ${entry.id}: J2ME must be solo`);
    assert.equal(computed, false, `[${catalogName}] ${entry.id}: J2ME must fail capability check`);
  }

  const core = String(entry.core || entry.platform || '').trim();
  if (SOLO_ONLY_CORES.has(core)) {
    assert.equal(entry.supportsMultiplayer, false, `[${catalogName}] ${entry.id}: core ${core} must be solo`);
    assert.equal(computed, false, `[${catalogName}] ${entry.id}: core ${core} must fail capability check`);
  }

  if (maxPlayers <= 1 || /altern[eé]/i.test(String(entry.players))) {
    assert.equal(entry.supportsMultiplayer, false, `[${catalogName}] ${entry.id}: 1J/alternating entry must be solo`);
    assert.equal(computed, false, `[${catalogName}] ${entry.id}: 1J/alternating entry must fail capability check`);
  }
}

function summarize(name, items) {
  let multi = 0;
  let solo = 0;
  const seenIds = new Set();

  for (const item of items) {
    assert.ok(item.id, `[${name}] entry missing id`);
    assert.equal(seenIds.has(item.id), false, `[${name}] duplicate id found: ${item.id}`);
    seenIds.add(item.id);
    assertEntryValid(name, item);
    if (item.supportsMultiplayer) multi += 1;
    else solo += 1;
  }

  return { name, total: items.length, multi, solo };
}

async function main() {
  const reports = [];

  // 1. Java / Gameloft J2ME
  const javaCatalog = readJson('public/app/data/java-catalog.json');
  assert.equal(javaCatalog.length, 322, `Expected 322 Java entries, got ${javaCatalog.length}`);
  for (const g of javaCatalog) {
    assert.equal(g.core, 'j2me', `[java-catalog] ${g.id}: expected core === 'j2me'`);
    assert.equal(g.players, '1J', `[java-catalog] ${g.id}: expected players === '1J'`);
    assert.equal(g.supportsMultiplayer, false, `[java-catalog] ${g.id}: expected supportsMultiplayer === false`);
    assert.equal(supportsOnlineMultiplayer(g), false, `[java-catalog] ${g.id}: supportsOnlineMultiplayer must be false`);
  }
  reports.push(summarize('public/app/data/java-catalog.json', javaCatalog));

  // 2. Arcade catalog (neogeo + mame)
  const arcadeCatalog = readJson('public/app/data/arcade-catalog.json');
  reports.push(summarize('arcade-catalog.json#neogeo', arcadeCatalog.neogeo || []));
  reports.push(summarize('arcade-catalog.json#mame', arcadeCatalog.mame || []));

  // 3. Classic MVS/Neo Geo games.json
  const gamesJson = readJson('src/data/games.json');
  reports.push(summarize('src/data/games.json', gamesJson));

  // 4. Extended catalogs (segaMD, etc.)
  const extendedCatalogs = readJson('public/app/data/extended-catalogs.json');
  for (const [key, list] of Object.entries(extendedCatalogs)) {
    assert.ok(Array.isArray(list), `[extended-catalogs.json#${key}] expected array`);
    reports.push(summarize(`extended-catalogs.json#${key}`, list));
  }

  // 5. Static platform catalogs (src & public mirror)
  for (const rel of ['src/data/platformCatalogs.js', 'public/app/data/catalogs.js']) {
    const mod = await import(pathToFileURL(path.join(rootDir, rel)).href);
    for (const [exportName, val] of Object.entries(mod)) {
      if (Array.isArray(val) && exportName.endsWith('_CATALOG')) {
        reports.push(summarize(`${rel}#${exportName}`, val));
      }
    }
  }

  // Spot-check key multi & alternating games from Option A decision
  const platformMod = await import(pathToFileURL(path.join(rootDir, 'src/data/platformCatalogs.js')).href);
  const allNintendo = platformMod.NINTENDO_CATALOG || [];
  const starFox = allNintendo.find((g) => g.id === 'n64-star-fox-64');
  const dk64 = allNintendo.find((g) => g.id === 'n64-donkey-kong-64');
  assert.equal(starFox?.players, '1–4J');
  assert.equal(starFox?.supportsMultiplayer, true);
  assert.equal(dk64?.players, '1–4J');
  assert.equal(dk64?.supportsMultiplayer, true);

  const pulstar = (arcadeCatalog.neogeo || []).find((g) => g.id === 'arc-neo-pulstar');
  assert.equal(pulstar?.supportsMultiplayer, false);

  for (const row of reports) {
    console.log(
      `${row.name.padEnd(45)} total=${String(row.total).padStart(3)}  multi=${String(row.multi).padStart(3)}  solo=${String(row.solo).padStart(3)}`
    );
  }
  console.log('ALL CATALOG MULTIPLAYER ASSERTIONS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
