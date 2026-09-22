import { useState, useRef, useCallback, useEffect } from 'react';
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
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
};

/**
 * Hook React personnalisé encapsulant la gestion WebRTC P2P + Signalisation Firestore v10
 * Conçu pour des sessions intercontinentales ultra-basse latence (UDP-like : ordered: false, maxRetransmits: 0)
 */
export function useWebRTCNetplay() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'disconnected' | 'waiting' | 'connecting' | 'connected' | 'error'
  const [roomId, setRoomId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [latencyMs, setLatencyMs] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const unsubscribesRef = useRef([]);
  const onInputReceivedCallbackRef = useRef(null);
  const currentRoomIdRef = useRef(null);
  const isHostRef = useRef(false);

  /**
   * Enregistrement du callback de réception des inputs distants
   */
  const onInputReceived = useCallback((callback) => {
    onInputReceivedCallbackRef.current = callback;
  }, []);

  /**
   * Nettoyage complet des canaux WebRTC et des listeners Firestore
   */
  const cleanup = useCallback(async () => {
    console.log('[WebRTC] Démarrage du nettoyage des ressources...');

    // 1. Désabonnement des listeners Firestore temps réel
    unsubscribesRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (err) {
        console.warn('[WebRTC] Erreur désabonnement Firestore:', err);
      }
    });
    unsubscribesRef.current = [];

    // 2. Fermeture du DataChannel
    if (dataChannelRef.current) {
      dataChannelRef.current.onopen = null;
      dataChannelRef.current.onclose = null;
      dataChannelRef.current.onmessage = null;
      dataChannelRef.current.onerror = null;
      if (dataChannelRef.current.readyState !== 'closed') {
        dataChannelRef.current.close();
      }
      dataChannelRef.current = null;
    }

    // 3. Fermeture de la RTCPeerConnection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.ondatachannel = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // 4. Nettoyage de la room Firestore si hôte
    if (isHostRef.current && currentRoomIdRef.current) {
      try {
        await deleteDoc(doc(db, 'rooms', currentRoomIdRef.current));
        console.log(`[WebRTC] Room Firestore ${currentRoomIdRef.current} supprimée.`);
      } catch (e) {
        // Ignoré lors d'une déconnexion réseau brutale
      }
    }

    currentRoomIdRef.current = null;
    setRoomId(null);
    setIsHost(false);
    isHostRef.current = false;
    setConnectionStatus('disconnected');
    setLatencyMs(null);
  }, []);

  /**
   * Configuration et attachement des événements sur le RTCDataChannel
   */
  const attachDataChannelEvents = useCallback((channel) => {
    channel.onopen = () => {
      console.log(`[WebRTC] DataChannel '${channel.label}' OUVERT (Mode UDP non-ordonné actif)`);
      setConnectionStatus('connected');
      setErrorMessage(null);
    };

    channel.onclose = () => {
      console.log(`[WebRTC] DataChannel '${channel.label}' FERMÉ`);
      setConnectionStatus('disconnected');
    };

    channel.onerror = (err) => {
      console.error('[WebRTC] Erreur sur le DataChannel:', err);
      setErrorMessage(`Erreur DataChannel: ${err.message || 'Inconnue'}`);
    };

    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        // Gestion interne d'un ping de latence pour mesurer la connexion
        if (payload._t === 'ping') {
          channel.send(JSON.stringify({ _t: 'pong', origin: payload.origin }));
          return;
        }
        if (payload._t === 'pong') {
          const rtt = Math.round(performance.now() - payload.origin);
          setLatencyMs(rtt);
          return;
        }

        // Transmission des inputs applicatifs au callback enregistré
        if (onInputReceivedCallbackRef.current) {
          onInputReceivedCallbackRef.current(payload);
        }
      } catch (e) {
        console.warn('[WebRTC] Impossible de parser le payload reçu:', event.data);
      }
    };
  }, []);

  /**
   * Création d'un Salon par l'HÔTE
   */
  const createRoom = useCallback(async () => {
    await cleanup();
    setConnectionStatus('waiting');
    setErrorMessage(null);
    setIsHost(true);
    isHostRef.current = true;

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      // Création du RTCDataChannel selon le cahier des charges strict :
      // label: 'arcade-inputs', ordered: false, maxRetransmits: 0
      const channel = pc.createDataChannel('arcade-inputs', {
        ordered: false,
        maxRetransmits: 0
      });
      dataChannelRef.current = channel;
      attachDataChannelEvents(channel);

      // Référence Firestore pour la room
      const roomRef = doc(collection(db, 'rooms'));
      const generatedRoomId = roomRef.id;
      currentRoomIdRef.current = generatedRoomId;
      setRoomId(generatedRoomId);

      const callerCandidatesCollection = collection(roomRef, 'callerCandidates');

      // 1. Écoute des candidats ICE locaux de l'Hôte et écriture dans Firestore
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(callerCandidatesCollection, event.candidate.toJSON()).catch((err) => {
            console.error('[WebRTC] Échec écriture candidat ICE hôte:', err);
          });
        }
      };

      // 2. Gestion de l'état de la connexion peer
      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Hôte connectionState:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setConnectionStatus('disconnected');
        } else if (pc.connectionState === 'connecting') {
          setConnectionStatus('connecting');
        }
      };

      // 3. Création de l'Offre SDP
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const roomPayload = {
        createdAt: Date.now(),
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }
      };

      await setDoc(roomRef, roomPayload);
      console.log(`[WebRTC] Room créée avec ID : ${generatedRoomId}. En attente du client...`);

      // 4. Écoute de la Réponse SDP du Client dans le document room
      const unsubRoom = onSnapshot(roomRef, (snapshot) => {
        const data = snapshot.data();
        if (!data) return;

        if (!pc.currentRemoteDescription && data.answer) {
          console.log('[WebRTC] Réponse SDP reçue du client. Application remoteDescription...');
          const rtcSessionDescription = new RTCSessionDescription(data.answer);
          pc.setRemoteDescription(rtcSessionDescription).catch((err) => {
            console.error('[WebRTC] Erreur setRemoteDescription hôte:', err);
            setErrorMessage(err.message);
          });
        }
      });
      unsubscribesRef.current.push(unsubRoom);

      // 5. Écoute des candidats ICE envoyés par le Client
      const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');
      const unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const candidateData = change.doc.data();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
              console.warn('[WebRTC] Erreur ajout candidat ICE invité:', e);
            }
          }
        });
      });
      unsubscribesRef.current.push(unsubCalleeCandidates);

      return generatedRoomId;
    } catch (err) {
      console.error('[WebRTC] Exception dans createRoom:', err);
      setErrorMessage(err.message);
      setConnectionStatus('error');
      throw err;
    }
  }, [cleanup, attachDataChannelEvents]);

  /**
   * Connexion à un Salon existant par le CLIENT
   */
  const joinRoom = useCallback(async (targetRoomId) => {
    if (!targetRoomId || typeof targetRoomId !== 'string') {
      throw new Error('Identifiant de salon invalide.');
    }

    await cleanup();
    setConnectionStatus('connecting');
    setErrorMessage(null);
    setIsHost(false);
    isHostRef.current = false;
    currentRoomIdRef.current = targetRoomId.trim();
    setRoomId(targetRoomId.trim());

    try {
      const roomRef = doc(db, 'rooms', targetRoomId.trim());
      const roomSnapshot = await getDoc(roomRef);

      if (!roomSnapshot.exists()) {
        throw new Error(`Le salon ${targetRoomId} n'existe pas ou a expiré.`);
      }

      const roomData = roomSnapshot.data();
      if (!roomData.offer) {
        throw new Error("L'offre SDP de l'hôte est introuvable dans ce salon.");
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionRef.current = pc;

      // 1. Écoute de l'ouverture du DataChannel initié par l'Hôte
      pc.ondatachannel = (event) => {
        console.log(`[WebRTC] DataChannel '${event.channel.label}' intercepté par le client.`);
        dataChannelRef.current = event.channel;
        attachDataChannelEvents(event.channel);
      };

      const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');

      // 2. Écoute des candidats ICE locaux du Client et écriture dans Firestore
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDoc(calleeCandidatesCollection, event.candidate.toJSON()).catch((err) => {
            console.error('[WebRTC] Échec écriture candidat ICE client:', err);
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Client connectionState:', pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          setConnectionStatus('disconnected');
        }
      };

      // 3. Application de l'Offre de l'Hôte
      await pc.setRemoteDescription(new RTCSessionDescription(roomData.offer));

      // 4. Génération de la Réponse SDP
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(roomRef, {
        answer: {
          type: answer.type,
          sdp: answer.sdp
        }
      });
      console.log('[WebRTC] Réponse SDP écrite sur Firestore. En attente de connexion directe...');

      // 5. Écoute des candidats ICE de l'Hôte
      const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
      const unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const candidateData = change.doc.data();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (e) {
              console.warn('[WebRTC] Erreur ajout candidat ICE hôte:', e);
            }
          }
        });
      });
      unsubscribesRef.current.push(unsubCallerCandidates);

    } catch (err) {
      console.error('[WebRTC] Exception dans joinRoom:', err);
      setErrorMessage(err.message);
      setConnectionStatus('error');
      throw err;
    }
  }, [cleanup, attachDataChannelEvents]);

  /**
   * Envoi d'un paquet d'input optimisé (Format JSON ultra-léger)
   * @param {number} frameNumber - Ex: 1042
   * @param {number | object} buttonState - Bitmask 16-bit ou objet des touches
   */
  const sendInput = useCallback((frameNumber, buttonState) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      const payload = JSON.stringify({
        f: frameNumber,
        b: buttonState
      });
      dataChannelRef.current.send(payload);
    }
  }, []);

  // Mesure périodique de latence RTT (Ping/Pong toutes les 2s quand connecté)
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

    const interval = setInterval(() => {
      if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
        dataChannelRef.current.send(JSON.stringify({ _t: 'ping', origin: performance.now() }));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [connectionStatus]);

  // Nettoyage automatique au démontage du composant
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    connectionStatus,
    roomId,
    isHost,
    latencyMs,
    errorMessage,
    createRoom,
    joinRoom,
    sendInput,
    onInputReceived,
    cleanup
  };
}
