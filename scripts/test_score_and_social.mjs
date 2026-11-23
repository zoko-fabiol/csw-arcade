import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_FORMULA_VERSION,
  evaluatePlayerRank,
  evaluateSingleGameScore,
  isPlausibleGameScore,
  sanitizeGameStatEntry,
} from '../src/utils/scoreFormula.js';
import { getPlayerInitials } from '../src/utils/avatarUtils.js';

test('RP formula is realistic and no longer grants thousands of RP per game', () => {
  const aladdin = evaluateSingleGameScore(19900, 10, 360);
  assert.equal(aladdin.gameRank, 'C');
  assert.ok(aladdin.gameRatingPoints >= 140 && aladdin.gameRatingPoints <= 220, `Got ${aladdin.gameRatingPoints}`);

  const mslugx = evaluateSingleGameScore(390000, 13, 1095);
  assert.equal(mslugx.gameRank, 'S');
  assert.ok(mslugx.gameRatingPoints >= 200 && mslugx.gameRatingPoints <= 280, `Got ${mslugx.gameRatingPoints}`);

  const globalEval = evaluatePlayerRank([
    { gameId: 'aladdin', gameTitle: 'Aladdin', bestScore: 19900, gamesPlayed: 10, playTimeSeconds: 360, statsFormulaVersion: STATS_FORMULA_VERSION },
    { gameId: 'mslugx', gameTitle: 'Metal Slug X', bestScore: 390000, gamesPlayed: 13, playTimeSeconds: 1095, statsFormulaVersion: STATS_FORMULA_VERSION },
    { gameId: 'strhoop', gameTitle: 'Street Hoop', bestScore: 84, gamesPlayed: 13, playTimeSeconds: 1695, statsFormulaVersion: STATS_FORMULA_VERSION },
    { gameId: 'kof98', gameTitle: 'KOF 98', bestScore: 54000, gamesPlayed: 4, playTimeSeconds: 300, statsFormulaVersion: STATS_FORMULA_VERSION },
  ]);
  assert.notEqual(globalEval.rank, 'S+');
  assert.ok(globalEval.ratingPoints < 1200, `Expected < 1200 RP for 4 short games, got ${globalEval.ratingPoints}`);
});

test('Sanitizer repairs Street Hoop 28M spike and Metal Slug X 329 milestone parties', () => {
  const dirtyStreetHoop = sanitizeGameStatEntry({
    gameId: 'arc-neo-strhoop',
    gameTitle: 'Street Hoop (Dunk Dream)',
    bestScore: 28009000,
    lastScore: 28009000,
    gamesPlayed: 13,
    playTimeSeconds: 1695,
  });
  assert.equal(dirtyStreetHoop.bestScore, 0);
  assert.equal(dirtyStreetHoop.lastScore, 0);
  assert.equal(dirtyStreetHoop.statsFormulaVersion, STATS_FORMULA_VERSION);

  const dirtyMslug = sanitizeGameStatEntry({
    gameId: 'arc-neo-mslugx',
    gameTitle: 'Metal Slug X',
    bestScore: 390000,
    lastScore: 254,
    gamesPlayed: 329,
    playTimeSeconds: 1095,
  });
  assert.equal(dirtyMslug.bestScore, 390000);
  assert.ok(dirtyMslug.gamesPlayed <= 20, `Expected repaired parties <= 20, got ${dirtyMslug.gamesPlayed}`);
});

test('isPlausibleGameScore rejects bogus RAM scores', () => {
  assert.equal(isPlausibleGameScore('Street Hoop (Dunk Dream)', 28009000, 'ram_milestone'), false);
  assert.equal(isPlausibleGameScore('Street Hoop (Dunk Dream)', 82, 'ram_milestone'), true);
  assert.equal(isPlausibleGameScore('Metal Slug X', 390000, 'ram_game_over'), true);
  assert.equal(isPlausibleGameScore('Metal Slug X', 18000000, 'ram_milestone'), false);
});

test('getPlayerInitials handles usernames cleanly', () => {
  assert.equal(getPlayerInitials('claus044'), 'CL');
  assert.equal(getPlayerInitials('Wandji Clauseph'), 'WC');
  assert.equal(getPlayerInitials('Ryu_FR99'), 'RF');
});
