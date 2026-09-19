const assert = require('assert');

// Test de simulation de la redondance N-3 et de l'auto-réparation
console.log('=== TEST REDONDANCE N-3 & AUTO-RÉPARATION ===');

class MockNetplayClient {
  constructor(name, playerIndex) {
    this.name = name;
    this.playerIndex = playerIndex;
    this.localSeq = 0;
    this.currentFrame = 0;
    this.inputHistory = [];
    this.lastRemoteSeq = new Map();
    this.receivedInputs = [];
  }

  sendInput(buttonId, isPressed) {
    this.localSeq = (this.localSeq + 1) & 0x7FFFFFFF;
    const currentItem = {
      seq: this.localSeq,
      frame: this.currentFrame,
      buttonId,
      isPressed: !!isPressed,
      playerIndex: this.playerIndex
    };

    const historyPayload = this.inputHistory.slice(-3);
    this.inputHistory.push(currentItem);
    if (this.inputHistory.length > 16) {
      this.inputHistory.shift();
    }

    return {
      type: 'REMOTE_INPUT',
      playerIndex: this.playerIndex,
      buttonId,
      isPressed: !!isPressed,
      frame: this.currentFrame,
      seq: this.localSeq,
      history: historyPayload
    };
  }

  receivePacket(data) {
    const pIdx = data.playerIndex;
    const incomingSeq = data.seq || 0;
    const lastSeq = this.lastRemoteSeq.get(pIdx) || 0;

    // Auto-réparation N-3 en cas de paquets perdus (gap > 1)
    if (incomingSeq > lastSeq + 1 && Array.isArray(data.history) && data.history.length > 0) {
      const missedCount = incomingSeq - (lastSeq + 1);
      console.log(`[${this.name}] ${missedCount} paquet(s) manquant(s) détecté(s). Réparation N-3...`);
      for (const item of data.history) {
        if (item && item.seq > lastSeq && item.seq < incomingSeq) {
          this.receivedInputs.push({ ...item, recovered: true });
          this.lastRemoteSeq.set(pIdx, item.seq);
        }
      }
    }

    if (incomingSeq > 0) {
      this.lastRemoteSeq.set(pIdx, Math.max(lastSeq, incomingSeq));
    }
    this.receivedInputs.push(data);
  }
}

const host = new MockNetplayClient('Host', 0);
const guest = new MockNetplayClient('Guest', 1);

// 1. Guest génère 5 inputs successifs
const packet1 = guest.sendInput(0, true);  // seq 1
const packet2 = guest.sendInput(0, false); // seq 2
const packet3 = guest.sendInput(8, true);  // seq 3
const packet4 = guest.sendInput(8, false); // seq 4
const packet5 = guest.sendInput(1, true);  // seq 5

// 2. Simuler la perte réseau Wi-Fi : packet2 et packet3 sont PERDUS (non reçus par Host)
console.log('Envoi paquet 1...');
host.receivePacket(packet1);

console.log('Simulation perte réseau : paquets 2 et 3 sont DROPPÉS !');
// packet2 DROPPÉ
// packet3 DROPPÉ

console.log('Envoi paquet 4 (contenant l\'historique [packet1, packet2, packet3])...');
host.receivePacket(packet4);

// 3. Vérifier que Host a récupéré packet2 et packet3 automatiquement sans demander de réémission
const recoveredSeqs = host.receivedInputs.map(p => p.seq);
console.log('Séquence d\'inputs reçus par l\'hôte:', recoveredSeqs);

assert.deepStrictEqual(recoveredSeqs, [1, 2, 3, 4], 'Tous les paquets 1, 2, 3, 4 doivent être présents');
assert.strictEqual(host.receivedInputs[1].recovered, true, 'Paquet 2 doit être marqué comme récupéré');
assert.strictEqual(host.receivedInputs[2].recovered, true, 'Paquet 3 doit être marqué comme récupéré');
assert.strictEqual(host.receivedInputs[1].buttonId, 0, 'Bouton du paquet 2 doit être 0');
assert.strictEqual(host.receivedInputs[2].buttonId, 8, 'Bouton du paquet 3 doit être 8');

console.log('✓ TEST RÉUSSI : 100% des paquets perdus ont été réparés instantanément par la redondance N-3 !');
