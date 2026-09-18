import { emulatorBridge } from './emulatorBridge';

const PACKET_TYPE_INPUT = 0x01;
const PACKET_TYPE_PING  = 0x02;
const PACKET_TYPE_PONG  = 0x03;

/**
 * Moteur de Synchronisation Netplay (Protocole Binaire Compact & Tampon Lockstep)
 */
export class NetplaySyncEngine {
  constructor(netplayService, isHost) {
    this.netplayService = netplayService;
    this.isHost = isHost; // true = Player 1, false = Player 2

    this.currentFrame = 0;
    this.frameDelay = 2; // 2 frames de délai (~33ms à 60 FPS) pour masquer le jitter réseau
    
    // Tampons d'inputs indexés par numéro de frame
    this.localInputBuffer = new Map();
    this.remoteInputBuffer = new Map();

    this.rtt = 0; // Round-trip time en millisecondes
    this.lastPingTimestamp = 0;

    this.onSyncStats = null; // Callback pour afficher le ping et la dérive de frame

    this.handleIncomingData = this.handleIncomingData.bind(this);
  }

  /**
   * Initialise les écouteurs sur le DataChannel WebRTC
   */
  start() {
    this.netplayService.onDataReceived = this.handleIncomingData;

    // Ping régulier toutes les 2 secondes pour estimer le RTT
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 2000);
  }

  stop() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.localInputBuffer.clear();
    this.remoteInputBuffer.clear();
  }

  /**
   * Traitement des paquets binaires entrants
   * @param {ArrayBuffer} buffer
   */
  handleIncomingData(buffer) {
    const view = new DataView(buffer);
    const packetType = view.getUint8(0);

    if (packetType === PACKET_TYPE_INPUT) {
      // Structure: [Type: 1 byte | Frame: 4 bytes | Bitmask: 2 bytes] -> 7 bytes
      const frame = view.getUint32(1, false);
      const inputMask = view.getUint16(5, false);

      this.remoteInputBuffer.set(frame, inputMask);
    } else if (packetType === PACKET_TYPE_PING) {
      // Répondre avec un PONG
      const timestamp = view.getFloat64(1, false);
      this.sendPong(timestamp);
    } else if (packetType === PACKET_TYPE_PONG) {
      // Calcul du RTT
      const originTimestamp = view.getFloat64(1, false);
      this.rtt = Math.round(performance.now() - originTimestamp);
      if (this.onSyncStats) {
        this.onSyncStats({ rtt: this.rtt, frame: this.currentFrame });
      }
    }
  }

  sendPing() {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, PACKET_TYPE_PING);
    view.setFloat64(1, performance.now(), false);
    this.netplayService.sendBinary(buffer);
  }

  sendPong(timestamp) {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, PACKET_TYPE_PONG);
    view.setFloat64(1, timestamp, false);
    this.netplayService.sendBinary(buffer);
  }

  /**
   * Encode et envoie l'input local pour la frame programmée (Frame actuelle + FrameDelay)
   * @param {number} localMask - Masque 16-bit des touches
   */
  processLocalInput(localMask) {
    const targetFrame = this.currentFrame + this.frameDelay;
    this.localInputBuffer.set(targetFrame, localMask);

    // Envoi du paquet de 7 octets via WebRTC Data Channel
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint8(0, PACKET_TYPE_INPUT);
    view.setUint32(1, targetFrame, false);
    view.setUint16(5, localMask, false);

    this.netplayService.sendBinary(buffer);

    // Exécute la frame actuelle de l'émulateur si les inputs des 2 joueurs sont prêts
    this.advanceEmulatorFrame();
  }

  /**
   * Avance l'état de l'émulateur et injecte les inputs P1 & P2
   */
  advanceEmulatorFrame() {
    const frame = this.currentFrame;

    // Récupère l'input local
    const localInput = this.localInputBuffer.get(frame) || 0;

    // Récupère l'input distant (ou le dernier input connu en cas de gigue mineure)
    let remoteInput = this.remoteInputBuffer.get(frame);
    if (remoteInput === undefined) {
      // Si la frame distante n'est pas encore arrivée, on utilise le dernier état connu
      remoteInput = this.remoteInputBuffer.get(frame - 1) || 0;
    }

    // Assignation des inputs selon le rôle Host/Client
    const p1Input = this.isHost ? localInput : remoteInput;
    const p2Input = this.isHost ? remoteInput : localInput;

    // Injection directe dans les registres d'inputs de l'émulateur Neo Geo
    emulatorBridge.injectInput(1, p1Input);
    emulatorBridge.injectInput(2, p2Input);

    // Nettoyage mémoire des anciens frames du buffer (> 30 frames en arrière)
    if (frame > 30) {
      this.localInputBuffer.delete(frame - 30);
      this.remoteInputBuffer.delete(frame - 30);
    }

    this.currentFrame++;
  }
}
