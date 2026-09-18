import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  addDoc, 
  deleteDoc 
} from 'firebase/firestore';
import { db } from '../config/firebase';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
};

/**
 * Service Réseau WebRTC P2P avec Signalisation Firestore (Firebase v10)
 */
export class NetplayService {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.roomId = null;
    this.isHost = false;
    this.unsubscribes = [];

    // Callbacks d'événements
    this.onStatusChange = null;
    this.onDataReceived = null;
    this.onError = null;
  }

  /**
   * Création d'une Room par l'Hôte (Joueur 1)
   * @param {string} gameId - Ex: "mslug"
   * @param {string} hostName - Nom de l'hôte
   * @returns {Promise<string>} Room ID généré
   */
  async createRoom(gameId, hostName = 'Player 1') {
    this.isHost = true;
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    // Initialisation du Data Channel fiable et ordonné pour les inputs manette
    this.dataChannel = this.peerConnection.createDataChannel('netplay-inputs', {
      ordered: true // Évite la désynchronisation des trames de boutons
    });
    this.setupDataChannel(this.dataChannel);

    const roomRef = doc(collection(db, 'rooms'));
    this.roomId = roomRef.id;

    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');

    // Collecte des ICE Candidates de l'Hôte
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(callerCandidatesCollection, event.candidate.toJSON()).catch(console.error);
      }
    };

    // Gestion de l'état de connexion ICE
    this.peerConnection.onconnectionstatechange = () => {
      this.handleConnectionStateChange();
    };

    // Génération de l'Offer SDP
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const roomPayload = {
      gameId,
      hostName,
      status: 'waiting',
      createdAt: Date.now(),
      offer: {
        type: offer.type,
        sdp: offer.sdp
      }
    };

    await setDoc(roomRef, roomPayload);

    // Écoute de l'Answer SDP du Client (Joueur 2)
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      if (!this.peerConnection.currentRemoteDescription && data.answer) {
        console.log('[Netplay] SDP Answer reçu du client');
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        this.peerConnection.setRemoteDescription(rtcSessionDescription).catch(console.error);
      }
    });
    this.unsubscribes.push(unsubRoom);

    // Écoute des ICE Candidates du Client
    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
    const unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          try {
            await this.peerConnection.addIceCandidate(candidate);
          } catch (e) {
            console.warn('[Netplay] Erreur ajout ICE Candidate hôte:', e);
          }
        }
      });
    });
    this.unsubscribes.push(unsubCalleeCandidates);

    return this.roomId;
  }

  /**
   * Rejoindre une Room existante en tant que Client (Joueur 2)
   * @param {string} roomId - Identifiant du salon
   * @param {string} guestName - Nom du joueur invité
   */
  async joinRoom(roomId, guestName = 'Player 2') {
    this.isHost = false;
    this.roomId = roomId;
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnapshot = await getDoc(roomRef);

    if (!roomSnapshot.exists()) {
      throw new Error("Le salon de jeu n'existe pas ou a expiré.");
    }

    const roomData = roomSnapshot.data();
    if (roomData.status !== 'waiting' || !roomData.offer) {
      throw new Error("Ce salon n'est plus disponible.");
    }

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);

    // Écoute de l'ouverture du Data Channel initié par l'Hôte
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');

    // Collecte des ICE Candidates du Client
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(calleeCandidatesCollection, event.candidate.toJSON()).catch(console.error);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.handleConnectionStateChange();
    };

    // Application de l'Offer de l'Hôte
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));

    // Création de l'Answer SDP
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await updateDoc(roomRef, {
      answer: {
        type: answer.type,
        sdp: answer.sdp
      },
      guestName,
      status: 'playing'
    });

    // Écoute des ICE Candidates de l'Hôte
    const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
    const unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          try {
            await this.peerConnection.addIceCandidate(candidate);
          } catch (e) {
            console.warn('[Netplay] Erreur ajout ICE Candidate client:', e);
          }
        }
      });
    });
    this.unsubscribes.push(unsubCallerCandidates);

    return roomData;
  }

  /**
   * Configuration des handlers sur le RTCDataChannel
   */
  setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('[Netplay] RTCDataChannel Ouvert en mode fiable.');
      if (this.onStatusChange) this.onStatusChange('connected');
    };

    channel.onclose = () => {
      console.log('[Netplay] RTCDataChannel Fermé.');
      if (this.onStatusChange) this.onStatusChange('disconnected');
    };

    channel.onmessage = (event) => {
      if (this.onDataReceived) {
        this.onDataReceived(event.data);
      }
    };

    channel.onerror = (err) => {
      console.error('[Netplay] Erreur DataChannel:', err);
      if (this.onError) this.onError(err);
    };
  }

  /**
   * Envoi de paquets binaires bruts (Bitmask Inputs / Sync frames)
   * @param {ArrayBuffer | ArrayBufferView} buffer
   */
  sendBinary(buffer) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(buffer);
    }
  }

  handleConnectionStateChange() {
    const state = this.peerConnection ? this.peerConnection.connectionState : 'closed';
    console.log('[Netplay] Connection State:', state);
    if (this.onStatusChange) {
      this.onStatusChange(state);
    }
  }

  /**
   * Nettoyage complet des canaux et désinscription des listeners Firestore
   */
  async disconnect() {
    this.unsubscribes.forEach((unsub) => unsub());
    this.unsubscribes = [];

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Si l'hôte quitte, supprimer le document du salon
    if (this.isHost && this.roomId) {
      try {
        await deleteDoc(doc(db, 'rooms', this.roomId));
      } catch {
        // Nettoyage silencieux
      }
    }

    this.roomId = null;
    if (this.onStatusChange) this.onStatusChange('disconnected');
    console.log('[Netplay] Déconnecté et ressources libérées.');
  }
}
