import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Radio, 
  Copy, 
  Check, 
  Play, 
  LogOut, 
  Gamepad2, 
  Zap, 
  Clock, 
  AlertCircle 
} from 'lucide-react';
import { useWebRTCNetplay } from '../../hooks/useWebRTCNetplay';

export function WebRTCNetplayDemo() {
  const {
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
  } = useWebRTCNetplay();

  const [inputRoomId, setInputRoomId] = useState('');
  const [copied, setCopied] = useState(false);
  
  // États de simulation de frame et d'inputs
  const [frameCounter, setFrameCounter] = useState(0);
  const [lastLocalInput, setLastLocalInput] = useState(0);
  const [lastRemotePayload, setLastRemotePayload] = useState(null);

  const frameRef = useRef(0);

  // 1. Abonnement à la réception des inputs distants
  useEffect(() => {
    onInputReceived((payload) => {
      // payload = { f: frameNumber, b: buttonState }
      setLastRemotePayload(payload);
    });
  }, [onInputReceived]);

  // 2. Boucle 60 FPS déclenchée dès que la connexion P2P est établie
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

    let animId;
    const loop = () => {
      frameRef.current += 1;
      setFrameCounter(frameRef.current);

      // Envoi continu du numéro de frame et de l'état des touches à 60 FPS
      sendInput(frameRef.current, lastLocalInput);

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [connectionStatus, lastLocalInput, sendInput]);

  // Actions de simulation de touches Neo Geo
  const handlePressButton = (bitmask) => {
    setLastLocalInput(bitmask);
  };

  const handleReleaseButton = () => {
    setLastLocalInput(0);
  };

  const copyRoomCode = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-neutral-900 border border-neutral-800 rounded-2xl font-mono text-neutral-200 shadow-2xl space-y-6 select-none">
      {/* Header Statut */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center text-cyan-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              CSW-ARCADE // WebRTC DataChannel (UDP Mode)
            </h2>
            <p className="text-[11px] text-neutral-400">
              Pipeline 60 FPS ultra-basse latence (ordered: false, maxRetransmits: 0)
            </p>
          </div>
        </div>

        {/* Badge d'État de Connexion */}
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-950 border border-emerald-500/50 text-emerald-400">
              <Wifi className="w-3.5 h-3.5" />
              CONNECTÉ
            </span>
          )}
          {connectionStatus === 'waiting' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-950 border border-amber-500/50 text-amber-400 animate-pulse">
              <Clock className="w-3.5 h-3.5" />
              EN ATTENTE D'INVITÉ
            </span>
          )}
          {connectionStatus === 'connecting' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-950 border border-blue-500/50 text-blue-400 animate-pulse">
              <Zap className="w-3.5 h-3.5" />
              NÉGOCIATION ICE...
            </span>
          )}
          {connectionStatus === 'disconnected' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-neutral-800 border border-neutral-700 text-neutral-400">
              <WifiOff className="w-3.5 h-3.5" />
              DÉCONNECTÉ
            </span>
          )}
          {connectionStatus === 'error' && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-950 border border-rose-500/50 text-rose-400">
              <AlertCircle className="w-3.5 h-3.5" />
              ERREUR
            </span>
          )}
        </div>
      </div>

      {/* Erreur éventuelle */}
      {errorMessage && (
        <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Étape 1 : Création ou Connexion */}
      {connectionStatus === 'disconnected' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Action Hôte */}
          <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl flex flex-col justify-between space-y-3">
            <div>
              <h3 className="font-bold text-white text-xs uppercase mb-1">Rôle : Hôte (Joueur 1)</h3>
              <p className="text-[11px] text-neutral-400">
                Génère un salon Firestore, crée l'Offre SDP et initialise le DataChannel 'arcade-inputs'.
              </p>
            </div>
            <button
              onClick={() => createRoom()}
              className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs rounded-lg transition-all shadow-md shadow-cyan-500/20 active:scale-95"
            >
              CRÉER UN SALON
            </button>
          </div>

          {/* Action Client */}
          <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl flex flex-col justify-between space-y-3">
            <div>
              <h3 className="font-bold text-white text-xs uppercase mb-1">Rôle : Client (Joueur 2)</h3>
              <p className="text-[11px] text-neutral-400 mb-2">
                Rejoint un salon existant via son identifiant et retourne la Réponse SDP.
              </p>
              <input
                type="text"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                placeholder="Coller l'ID du salon..."
                className="w-full px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              onClick={() => joinRoom(inputRoomId)}
              disabled={!inputRoomId.trim()}
              className="w-full py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 text-white font-bold text-xs rounded-lg transition-all shadow-md shadow-red-600/20 active:scale-95"
            >
              REJOINDRE LE SALON
            </button>
          </div>
        </div>
      )}

      {/* Étape 2 : Salle en Attente (Hôte) */}
      {connectionStatus === 'waiting' && roomId && (
        <div className="p-5 bg-neutral-950 border border-cyan-500/40 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-cyan-400 font-bold uppercase">
              Code de Salon Partageable :
            </span>
            <button
              onClick={copyRoomCode}
              className="flex items-center gap-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-black px-2.5 py-1 rounded font-bold transition-all"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'COPIÉ !' : 'COPIER'}
            </button>
          </div>
          <div className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg text-xs text-white font-mono select-all">
            {roomId}
          </div>
          <p className="text-[11px] text-neutral-400 animate-pulse">
            Transmettez ce code au second joueur. La connexion P2P s'établira automatiquement dès sa saisie.
          </p>
          <button
            onClick={cleanup}
            className="text-xs text-neutral-500 hover:text-rose-400 transition-colors"
          >
            Annuler et fermer le salon
          </button>
        </div>
      )}

      {/* Étape 3 : Session Temps Réel Connectée (60 FPS Active) */}
      {connectionStatus === 'connected' && (
        <div className="space-y-4">
          {/* Télémesure de Session */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-center text-xs">
            <div>
              <span className="text-[10px] text-neutral-500 block uppercase">Rôle</span>
              <span className="font-bold text-cyan-400">{isHost ? 'HÔTE (P1)' : 'CLIENT (P2)'}</span>
            </div>
            <div>
              <span className="text-[10px] text-neutral-500 block uppercase">Ping RTT</span>
              <span className={`font-bold ${latencyMs && latencyMs < 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {latencyMs !== null ? `${latencyMs} ms` : 'Calcul...'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-neutral-500 block uppercase">Frame Locale (60 Hz)</span>
              <span className="font-bold text-white">{frameCounter}</span>
            </div>
          </div>

          {/* Test de Transmission des Touches Neo Geo */}
          <div className="p-4 bg-neutral-950 border border-neutral-800 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-neutral-300 uppercase flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-cyan-400" />
              Émulateur d'Inputs (Maintenez un bouton enfoncé)
            </h4>

            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'BTN A (Poing)', mask: 0x0010, color: 'hover:bg-red-600' },
                { label: 'BTN B (Pied)', mask: 0x0020, color: 'hover:bg-amber-600' },
                { label: 'BTN C (Poing F)', mask: 0x0040, color: 'hover:bg-emerald-600' },
                { label: 'BTN D (Pied F)', mask: 0x0080, color: 'hover:bg-blue-600' }
              ].map((btn) => (
                <button
                  key={btn.mask}
                  onMouseDown={() => handlePressButton(btn.mask)}
                  onMouseUp={handleReleaseButton}
                  className={`py-3 bg-neutral-800 border border-neutral-700 rounded-lg text-xs font-bold text-white transition-all active:scale-95 ${btn.color}`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Moniteur Hexadécimal en Temps Réel */}
            <div className="grid grid-cols-2 gap-3 pt-2 text-[11px]">
              <div className="p-2.5 bg-neutral-900 rounded border border-neutral-800">
                <span className="text-neutral-500 block mb-0.5">Input Local Transmis :</span>
                <span className="font-mono text-cyan-300 font-bold">
                  0x{lastLocalInput.toString(16).toUpperCase().padStart(4, '0')}
                </span>
              </div>
              <div className="p-2.5 bg-neutral-900 rounded border border-neutral-800">
                <span className="text-neutral-500 block mb-0.5">Dernier Payload Distant Reçu :</span>
                <span className="font-mono text-emerald-300 font-bold">
                  {lastRemotePayload 
                    ? `Frame #${lastRemotePayload.f} | 0x${(lastRemotePayload.b || 0).toString(16).toUpperCase().padStart(4, '0')}`
                    : 'En attente...'}
                </span>
              </div>
            </div>
          </div>

          {/* Bouton Déconnexion */}
          <button
            onClick={cleanup}
            className="w-full py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            QUITTER LA SESSION NETPLAY
          </button>
        </div>
      )}
    </div>
  );
}
