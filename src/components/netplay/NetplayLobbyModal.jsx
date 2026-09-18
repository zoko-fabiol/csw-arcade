import React, { useState } from 'react';
import { 
  X, 
  Users, 
  Plus, 
  LogIn, 
  Copy, 
  Check, 
  Loader2, 
  Radio, 
  AlertCircle 
} from 'lucide-react';
import { NetplayService } from '../../services/NetplayService';

export function NetplayLobbyModal({ 
  isOpen, 
  onClose, 
  games, 
  onStartNetplayGame 
}) {
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'join'
  const [selectedGameId, setSelectedGameId] = useState(games[0]?.id || 'mslug');
  const [playerName, setPlayerName] = useState('Arcade Warrior');
  const [joinRoomId, setJoinRoomId] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdRoomId, setCreatedRoomId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);

  if (!isOpen) return null;

  // Créer un salon (Hôte - Joueur 1)
  const handleCreateRoom = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage('Génération du salon & configuration STUN...');

    try {
      const netplayService = new NetplayService();
      
      netplayService.onStatusChange = (status) => {
        console.log('[Lobby] Statut connexion Hôte:', status);
        if (status === 'connected') {
          const game = games.find(g => g.id === selectedGameId);
          onStartNetplayGame({
            game,
            isHost: true,
            netplayService
          });
        }
      };

      const roomId = await netplayService.createRoom(selectedGameId, playerName);
      setCreatedRoomId(roomId);
      setStatusMessage('En attente du Joueur 2... Partagez le code du salon.');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message);
      setIsProcessing(false);
    }
  };

  // Rejoindre un salon (Client - Joueur 2)
  const handleJoinRoom = async () => {
    if (!joinRoomId.trim()) return;
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage('Connexion au salon & négociation P2P...');

    try {
      const netplayService = new NetplayService();

      netplayService.onStatusChange = (status) => {
        console.log('[Lobby] Statut connexion Client:', status);
        if (status === 'connected') {
          // Trouver le jeu sélectionné par la room
          const game = games.find(g => g.id === selectedGameId) || games[0];
          onStartNetplayGame({
            game,
            isHost: false,
            netplayService
          });
        }
      };

      const roomData = await netplayService.joinRoom(joinRoomId.trim(), playerName);
      const targetGame = games.find(g => g.id === roomData.gameId) || games[0];
      setSelectedGameId(targetGame.id);
      setStatusMessage('Handshake ICE réussi. Initialisation du match...');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message);
      setIsProcessing(false);
    }
  };

  const copyToClipboard = () => {
    if (!createdRoomId) return;
    navigator.clipboard.writeText(createdRoomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono select-none">
      <div className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Radio className="w-5 h-5 text-red-400 animate-pulse" />
            <h3 className="font-bold text-white tracking-wide text-sm uppercase">
              Salons Netplay P2P Neo Geo
            </h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 border-b border-neutral-800 text-xs font-bold">
          <button
            onClick={() => { setActiveTab('create'); setCreatedRoomId(null); setErrorMessage(null); }}
            className={`py-3 flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'create' 
                ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20' 
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            CRÉER UN SALON
          </button>
          <button
            onClick={() => { setActiveTab('join'); setCreatedRoomId(null); setErrorMessage(null); }}
            className={`py-3 flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeTab === 'join' 
                ? 'border-red-400 text-red-400 bg-red-950/20' 
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            REJOINDRE
          </button>
        </div>

        {/* Contenu Formulaire */}
        <div className="p-6 space-y-4 text-xs">
          {/* Pseudo Joueur */}
          <div>
            <label className="block text-neutral-400 text-[11px] mb-1.5 uppercase">
              Pseudo Joueur
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {activeTab === 'create' ? (
            <>
              {/* Choix du Jeu */}
              <div>
                <label className="block text-neutral-400 text-[11px] mb-1.5 uppercase">
                  Sélection du Jeu Arcade
                </label>
                <select
                  value={selectedGameId}
                  onChange={(e) => setSelectedGameId(e.target.value)}
                  disabled={!!createdRoomId}
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white focus:outline-none focus:border-cyan-500 transition-colors"
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title} ({g.year})
                    </option>
                  ))}
                </select>
              </div>

              {/* Code de Salon Généré */}
              {createdRoomId ? (
                <div className="p-4 rounded-xl bg-neutral-950 border border-cyan-500/40 space-y-3">
                  <span className="text-[10px] text-cyan-400 uppercase tracking-wider block">
                    Code de Connexion Unique :
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdRoomId}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    />
                    <button
                      onClick={copyToClipboard}
                      className="p-2 bg-cyan-500 hover:bg-cyan-400 text-black rounded-lg transition-colors shrink-0"
                      title="Copier le code"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400 flex items-center gap-2 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                    {statusMessage}
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleCreateRoom}
                  disabled={isProcessing}
                  className="w-full py-3 mt-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-neutral-800 text-black font-bold rounded-xl shadow-lg shadow-cyan-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Création du Salon...
                    </>
                  ) : (
                    'CRÉER LE SALON (HÔTE P1)'
                  )}
                </button>
              )}
            </>
          ) : (
            <>
              {/* Saisie du Code Salon */}
              <div>
                <label className="block text-neutral-400 text-[11px] mb-1.5 uppercase">
                  Code du Salon Invité
                </label>
                <input
                  type="text"
                  placeholder="Ex: 8XkL910qZ"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white focus:outline-none focus:border-red-500 transition-colors"
                />
              </div>

              {statusMessage && (
                <p className="text-[11px] text-neutral-300 flex items-center gap-2 animate-pulse bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                  {statusMessage}
                </p>
              )}

              <button
                onClick={handleJoinRoom}
                disabled={isProcessing || !joinRoomId.trim()}
                className="w-full py-3 mt-2 bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 text-white font-bold rounded-xl shadow-lg shadow-red-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connexion en cours...
                  </>
                ) : (
                  'REJOINDRE LE MATCH (CLIENT P2)'
                )}
              </button>
            </>
          )}

          {/* Message d'Erreur éventuel */}
          {errorMessage && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl flex items-start gap-2.5 text-rose-300 text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
