import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isJ2meGame,
  parseMaxPlayers,
  supportsOnlineMultiplayer,
  getMultiplayerBadgeMeta,
} from '../src/utils/gameCapabilities.js';

test('Java / Gameloft J2ME games never support online multiplayer', () => {
  assert.equal(isJ2meGame({ id: 'java-diamond-rush', platform: 'j2me' }), true);
  assert.equal(supportsOnlineMultiplayer({ id: 'java-diamond-rush', platform: 'j2me', players: '1–2J' }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'custom-jar', filename: 'Asphalt4.jar', supportsMultiplayer: true }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'foo', title: 'Any', core: 'fbneo', players: '1–2J' }, { mode: 'java' }), false);
  assert.equal(supportsOnlineMultiplayer({ kind: 'j2me', title: 'Diamond Rush', players: 2 }), false);
});

test('Handheld cores (GB/GBC/GBA/Game Gear/NDS) never support online multiplayer', () => {
  for (const core of ['gb', 'gbc', 'gba', 'segaGG', 'nds']) {
    assert.equal(
      supportsOnlineMultiplayer({ id: `test-${core}`, core, platform: core, players: '1–2J', supportsMultiplayer: true }),
      false,
      `Expected ${core} to be solo-only`
    );
  }
});

test('Single-player console and arcade games are blocked', () => {
  assert.equal(supportsOnlineMultiplayer({ id: 'ps1-crash-bandicoot-1', platform: 'ps1', core: 'psx', players: '1J' }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'sega-sonic-1', platform: 'segaMD', core: 'segaMD', players: '1J' }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'arc-mame-outrun', core: 'mame2003_plus', players: '1J', supportsMultiplayer: false }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'arc-neo-bakatono', core: 'fbneo', players: '1–2J', supportsMultiplayer: false }), false);
});

test('Local imports, global lobby, and unqualified Archive.org entries are blocked', () => {
  assert.equal(supportsOnlineMultiplayer({ id: 'local', core: 'snes', players: '1–2J', isLocalImport: true }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'local', core: 'snes', players: '1–2J' }, { isLocalImport: true }), false);
  assert.equal(supportsOnlineMultiplayer({ id: 'archive-item', core: 'snes', title: 'Unknown ROM' }), false);
  assert.equal(supportsOnlineMultiplayer({ gameId: 'global-lobby', isGlobal: true }), false);
});

test('Verified multiplayer console and arcade games are allowed', () => {
  assert.equal(supportsOnlineMultiplayer({ id: 'arc-neo-kof98', core: 'fbneo', players: '1–2J', supportsMultiplayer: true }), true);
  assert.equal(supportsOnlineMultiplayer({ id: 'snes-street-fighter-2', core: 'snes', players: '1–2J' }), true);
  assert.equal(supportsOnlineMultiplayer({ id: 'n64-mario-kart-64', core: 'n64', players: '1–4J', supportsMultiplayer: true }), true);
  assert.equal(supportsOnlineMultiplayer({ id: 'ps1-tekken-3', platform: 'ps1', core: 'psx', players: '1–2J' }), true);
  assert.equal(supportsOnlineMultiplayer({ id: 'kof98', players: 2 }), true);
});

test('parseMaxPlayers & badge meta helpers work across formats', () => {
  assert.equal(parseMaxPlayers('1J'), 1);
  assert.equal(parseMaxPlayers('1–2J'), 2);
  assert.equal(parseMaxPlayers('1-4J'), 4);
  assert.equal(parseMaxPlayers(2), 2);
  assert.equal(parseMaxPlayers(undefined), 0);

  assert.deepEqual(getMultiplayerBadgeMeta({ id: 'java-1', platform: 'j2me' }), {
    isMultiplayer: false,
    shortLabel: 'Solo',
    detailLabel: 'Solo (J2ME)',
  });
  assert.deepEqual(getMultiplayerBadgeMeta({ id: 'kof98', core: 'fbneo', players: '1–2J', supportsMultiplayer: true }), {
    isMultiplayer: true,
    shortLabel: '1–2J · En ligne',
    detailLabel: '1–2J · Multijoueur en ligne',
  });
});
