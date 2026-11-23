import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalFirebaseStore } from '../src/server/localFirebaseStore.js';
import {
  createLocalFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  deleteField,
} from '../src/services/localFirestore.js';
import { supportsOnlineMultiplayer } from '../src/utils/gameCapabilities.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  console.log(`✓ ${name}`);
  passed += 1;
}

await test('LocalFirebaseStore CRUD, merge, dotted updateDoc & subcollection isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csw-local-fs-'));
  try {
    const store = new LocalFirebaseStore({ dataDir: tmpDir });
    store.setDoc('users/u1', { displayName: 'Claus', photoURL: 'data:image/jpeg;base64,abc', updatedAt: { __cswServerTimestamp: true } });
    store.setDoc('users/u1', { region: 'CM' }, { merge: true });
    store.setDoc('users/u1/gameStats/kof2002', { gameId: 'kof2002', bestScore: 15000 });

    const u1 = store.getDoc('users/u1');
    assert.equal(u1.exists, true);
    assert.equal(u1.data.displayName, 'Claus');
    assert.equal(u1.data.region, 'CM');
    assert.equal(u1.data.photoURL, 'data:image/jpeg;base64,abc');
    assert.equal(typeof u1.data.updatedAt.__cswTsMs, 'number');

    // Subcollection docs must NOT appear inside top-level 'users' collection
    const topUsers = store.getCollectionDocs('users');
    assert.equal(topUsers.length, 1);
    assert.equal(topUsers[0].id, 'u1');

    // Dotted patch updateDoc
    store.updateDoc('fc_challenges/ch1', { 'syncByUid.u1': { romReady: true, romPct: 100 } });
    store.updateDoc('fc_challenges/ch1', { 'syncByUid.u2': { romReady: false, romPct: 45 } });
    const ch1 = store.getDoc('fc_challenges/ch1');
    assert.equal(ch1.data.syncByUid.u1.romPct, 100);
    assert.equal(ch1.data.syncByUid.u2.romPct, 45);

    // Query with where + orderBy + limit
    store.setDoc('game_scores/kof/entries/u1', { uid: 'u1', bestScore: 500 });
    store.setDoc('game_scores/kof/entries/u2', { uid: 'u2', bestScore: 2500 });
    store.setDoc('game_scores/kof/entries/u3', { uid: 'u3', bestScore: 1200 });
    const top2 = store.queryCollection('game_scores/kof/entries', [
      { type: 'orderBy', field: 'bestScore', dir: 'desc' },
      { type: 'limit', count: 2 },
    ]);
    assert.deepEqual(
      top2.map((r) => r.id),
      ['u2', 'u3']
    );

    // Persist flush & reload from disk
    store.flushSync();
    const storeReloaded = new LocalFirebaseStore({ dataDir: tmpDir });
    const persisted = storeReloaded.getDoc('users/u1');
    assert.equal(persisted.exists, true);
    assert.equal(persisted.data.photoURL, 'data:image/jpeg;base64,abc');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

await test('LocalFirestore client SDK queries, serverTimestamp().toMillis(), docChanges() & deleteDoc', async () => {
  const db = createLocalFirestore({ backendMode: 'memory-only' });

  const uRef = doc(db, 'users', 'player1');
  await setDoc(uRef, { displayName: 'Kyo', rank: 'B', createdAt: serverTimestamp() });
  const snap = await getDoc(uRef);
  assert.equal(snap.exists(), true);
  assert.equal(snap.data().displayName, 'Kyo');
  assert.equal(typeof snap.data().createdAt.toMillis(), 'number');

  await setDoc(uRef, { tempField: 'x', rank: 'S' }, { merge: true });
  await updateDoc(uRef, { tempField: deleteField(), 'meta.wins': 7 });
  const updatedSnap = await getDoc(uRef);
  assert.equal(updatedSnap.data().rank, 'S');
  assert.equal(updatedSnap.data().tempField, undefined);
  assert.equal(updatedSnap.data().meta.wins, 7);

  // Live onSnapshot + docChanges on rooms subcollection
  const roomRef = doc(collection(db, 'rooms'));
  assert.ok(roomRef.id.length >= 16);
  const candidatesCol = collection(roomRef, 'callerCandidates');

  const seenChanges = [];
  const unsub = onSnapshot(candidatesCol, (qSnap) => {
    qSnap.docChanges().forEach((chg) => {
      seenChanges.push({ type: chg.type, cand: chg.doc.data().cand });
    });
  });

  const addedRef = await addDoc(candidatesCol, { cand: 'ice-1' });
  await addDoc(candidatesCol, { cand: 'ice-2' });
  await deleteDoc(addedRef);

  unsub();
  assert.ok(seenChanges.some((c) => c.type === 'added' && c.cand === 'ice-1'));
  assert.ok(seenChanges.some((c) => c.type === 'added' && c.cand === 'ice-2'));
  assert.ok(seenChanges.some((c) => c.type === 'removed' && c.cand === 'ice-1'));

  // Query where + orderBy + limit
  const chCol = collection(db, 'fc_challenges');
  await setDoc(doc(chCol, 'c1'), { toUid: 'p2', status: 'pending', createdAt: 10 });
  await setDoc(doc(chCol, 'c2'), { toUid: 'p2', status: 'accepted', createdAt: 20 });
  await setDoc(doc(chCol, 'c3'), { toUid: 'p2', status: 'pending', createdAt: 30 });
  const qRes = await getDocs(
    query(chCol, where('toUid', '==', 'p2'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(1))
  );
  assert.equal(qRes.size, 1);
  assert.equal(qRes.docs[0].id, 'c3');
});

await test('Synced multiplayer channel preserves players & supportsMultiplayer across LocalFirestore round-trip', async () => {
  const db = createLocalFirestore({ backendMode: 'memory-only' });
  const sampleEntry = {
    id: 'arc-neo-kof2002',
    title: 'The King of Fighters 2002',
    core: 'fbneo',
    platform: 'neogeo',
    players: '1-2J',
    supportsMultiplayer: true,
    filename: 'kof2002.zip',
  };
  const syncedChannel = {
    gameId: 'arc-neo-kof2002',
    title: sampleEntry.title,
    platformLabel: 'Neo Geo · FBNeo',
    filename: sampleEntry.filename,
    entry: {
      id: sampleEntry.id,
      title: sampleEntry.title,
      core: sampleEntry.core,
      platform: sampleEntry.platform,
      platformLabel: 'Neo Geo · FBNeo',
      filename: sampleEntry.filename,
      players: sampleEntry.players,
      supportsMultiplayer: supportsOnlineMultiplayer(sampleEntry),
      urls: [],
    },
  };
  await setDoc(doc(db, 'users', 'u1', 'sync', 'state'), { activeChannels: [syncedChannel] }, { merge: true });
  const roundTrip = await getDoc(doc(db, 'users', 'u1', 'sync', 'state'));
  const restored = roundTrip.data().activeChannels[0];
  assert.equal(supportsOnlineMultiplayer(restored.entry), true);
});

console.log(`\nALL ${passed} LOCAL FIREBASE TESTS PASSED`);
