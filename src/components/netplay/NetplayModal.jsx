import React, { useState, useEffect } from 'react';
import { 
  Users, Wifi, Gamepad2, Radio, QrCode, Copy, Check, 
  X, Play, ShieldAlert, ArrowRight, RefreshCw, Smartphone
} from 'lucide-react';
import { netplayService } from '../../services/NetplayService';

export function NetplayModal({ 
  isOpen, 
  onClose, 
  games = [], 
  currentGame = null, 
  onLaunchGame,
  onOpenMobileController
}) {
  const [activeTab, setActiveTab] = useState('host'); // 'host' | 'join'
  const [selectedGameId, setSelectedGameId] = useState(currentGame?.id || games[0]?.id || '');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('csw_player_name') || 'Joueur ' + Math.floor(Math.random() * 90 + 10));
  const [joinCode, setJoinCode] = useState('');
  const [asControllerOnly, setAsControllerOnly] = useState(false);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [activeRoom, setActiveRoom] = useState(null);
  const [ping, setPing] = useState(0);
  const [isP2P, setIsP2P] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  const selectedGame = games.find(g => g.id === selectedGameId) || currentGame || games[0] || {};
  const maxPlayersForGame = selectedGame.players || 2;

  const [lanInfo, setLanInfo] = useState(null);

  // Détermination de l'URL de partage LAN / Même Wi-Fi / Netlify
  const shareBaseUrl = lanInfo?.lanUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const shareRoomUrl = activeRoom?.code ? `${shareBaseUrl}/?join=${activeRoom.code}` : shareBaseUrl;

  // Sauvegarder le nom du joueur
  const handleNameChange = (val) => {
    setPlayerName(val);
    try { localStorage.setItem('csw_player_name', val); } catch(e) {}
  };

  // Pré-remplissage si un code est fourni dans l'URL (?join=ARC-XXXX)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const j = params.get('join');
      if (j) {
        setJoinCode(j.toUpperCase());
        setActiveTab('join');
      }
    }
  }, [isOpen]);

  // Récupération de l'adresse LAN Wi-Fi du serveur Vite local
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/network-info')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.lanUrl) {
          setLanInfo(data);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Écouter les événements du netplayService
  useEffect(() => {
    if (!isOpen) return;

    const unsubs = [
      netplayService.on('room_update', (room) => {
        setActiveRoom(room);
      }),
      netplayService.on('room_created', (data) => {
        setActiveRoom(netplayService.currentRoom);
      }),
      netplayService.on('joined_success', (data) => {
        setActiveRoom(netplayService.currentRoom);
        if (asControllerOnly && onOpenMobileController) {
          onOpenMobileController(data);
          onClose();
        }
      }),
      netplayService.on('game_started_by_host', (data) => {
        if (onLaunchGame) {
          const gameToLaunch = games.find(g => g.id === data.gameId) || { id: data.gameId, title: data.gameTitle };
          onLaunchGame(gameToLaunch, { 
            isNetplay: true, 
            isHost: false,
            role: netplayService.myRole, 
            playerIndex: netplayService.myPlayerIndex 
          });
          onClose();
        }
      }),
      netplayService.on('error', (err) => {
        setErrorMsg(err);
      }),
      netplayService.on('ping', (p) => {
        setPing(p);
      }),
      netplayService.on('p2p_connected', () => {
        setIsP2P(true);
      })
    ];

    // Rafraîchir les salons locaux & cloud
    loadRooms();

    return () => {
      unsubs.forEach(u => u());
    };
  }, [isOpen, asControllerOnly, games, onLaunchGame, onOpenMobileController, onClose]);

  const loadRooms = async () => {
    setIsLoadingRooms(true);
    try {
      const rooms = await netplayService.fetchRooms();
      setAvailableRooms(rooms);
    } catch(e) {
      console.warn('Erreur chargement salons:', e);
    } finally {
      setIsLoadingRooms(false);
    }
  };

  const handleCreateRoom = async () => {
    setErrorMsg(null);
    try {
      await netplayService.createRoom({
        gameId: selectedGame.id,
        gameTitle: selectedGame.title,
        maxPlayers: maxPlayersForGame,
        hostName: playerName
      });
    } catch(err) {
      setErrorMsg(err.message || 'Échec de la création du salon.');
    }
  };

  const handleJoinRoom = async (codeToJoin) => {
    const code = codeToJoin || joinCode;
    if (!code || code.trim().length < 3) {
      setErrorMsg('Veuillez renseigner un code de salon valide.');
      return;
    }
    setErrorMsg(null);
    try {
      await netplayService.joinRoom(code, playerName);
    } catch(err) {
      setErrorMsg(err.message || 'Échec de connexion au salon.');
    }
  };

  const handleCopyCode = (code) => {
    try {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch(e) {}
  };

  const handleStartHostedGame = () => {
    netplayService.startGame();
    if (onLaunchGame && selectedGame) {
      onLaunchGame(selectedGame, { isNetplay: true, isHost: true, playerIndex: 0, role: 'p1' });
      onClose();
    }
  };

  const handleLeaveCurrentRoom = () => {
    netplayService.leaveRoom();
    setActiveRoom(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in font-mono">
      <div className="relative w-full max-w-xl bg-neutral-900 border border-cyan-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Entête Modal */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-950 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                Multijoueur Même Réseau & En Ligne
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-normal border border-cyan-500/40">
                  {isP2P ? '⚡ P2P Direct' : (netplayService.mode === 'ws' ? 'LAN Local' : 'P2P WebRTC')}
                </span>
              </h2>
              <p className="text-[11px] text-neutral-400">Jouez ensemble sur le même réseau Wi-Fi ou à distance en ligne</p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message d'erreur */}
        {errorMsg && (
          <div className="mx-5 mt-3 px-3.5 py-2 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Pseudo du joueur */}
        <div className="px-5 pt-3.5 pb-2 flex items-center gap-2 text-xs border-b border-neutral-800/80">
          <span className="text-neutral-400 font-bold shrink-0">Votre Pseudo :</span>
          <input
            type="text"
            value={playerName}
            onChange={(e) => handleNameChange(e.target.value)}
            className="flex-1 bg-neutral-950 border border-neutral-700 focus:border-cyan-400 rounded-lg px-2.5 py-1 text-xs text-white outline-none"
            placeholder="Ex: Player 1"
          />
          {ping > 0 && (
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              {ping} ms
            </span>
          )}
        </div>

        {/* Si un salon est actuellement ACTIF (créé ou rejoint) */}
        {activeRoom ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-4">
            <div className="p-4 rounded-xl bg-neutral-950 border border-cyan-500/40 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-400">Code de la Partie :</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xl font-black text-cyan-400 tracking-widest">{activeRoom.code}</span>
                    <button
                      onClick={() => handleCopyCode(activeRoom.code)}
                      className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                      title="Copier le code"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-neutral-400">Jeu :</span>
                  <p className="text-sm font-bold text-white line-clamp-1">{activeRoom.gameTitle}</p>
                  <span className="text-[10px] text-cyan-300/80 font-bold">
                    Mode {activeRoom.maxPlayers} Joueurs
                  </span>
                </div>
              </div>

              {/* Info Réseau Wi-Fi / Cloud */}
              <div className="p-2.5 rounded-xl bg-neutral-900 border border-cyan-500/30 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Smartphone className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[10px] text-cyan-300 font-bold uppercase block truncate">
                      {lanInfo?.lanUrl ? 'Accès Mobile (Même Wi-Fi LAN) :' : 'Lien de partage (Même Wi-Fi & Web) :'}
                    </span>
                    <span className="text-xs font-mono text-white select-all truncate block">{shareRoomUrl}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleCopyCode(shareRoomUrl)}
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-cyan-300 transition-colors flex items-center gap-1 text-[10px]"
                    title="Copier le lien"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="hidden xs:inline">Copier</span>
                  </button>
                  <button
                    onClick={() => setShowQrModal(true)}
                    className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-cyan-300 transition-colors"
                    title="Afficher le QR Code"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Grille des Slots Joueurs (2 à 4 Joueurs) */}
              <div className="pt-2 border-t border-neutral-800">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold block mb-2">
                  Slots Joueurs ({activeRoom.maxPlayers} Max) :
                </span>

                <div className={`grid ${activeRoom.maxPlayers === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'} gap-2`}>
                  {Array.from({ length: activeRoom.maxPlayers }).map((_, idx) => {
                    const slotNum = idx + 1;
                    const player = activeRoom.players?.[idx];
                    const isMe = netplayService.myPlayerIndex === idx;

                    // Palette de couleurs arcade
                    const slotColors = [
                      { border: 'border-cyan-500/60', text: 'text-cyan-400', bg: 'bg-cyan-950/30', badge: 'bg-cyan-500 text-black' },
                      { border: 'border-rose-500/60', text: 'text-rose-400', bg: 'bg-rose-950/30', badge: 'bg-rose-500 text-white' },
                      { border: 'border-amber-500/60', text: 'text-amber-400', bg: 'bg-amber-950/30', badge: 'bg-amber-400 text-black' },
                      { border: 'border-emerald-500/60', text: 'text-emerald-400', bg: 'bg-emerald-950/30', badge: 'bg-emerald-400 text-black' }
                    ][idx] || { border: 'border-neutral-700', text: 'text-neutral-300', bg: 'bg-neutral-800', badge: 'bg-neutral-600' };

                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border ${slotColors.border} ${slotColors.bg} flex flex-col justify-between min-h-[75px]`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${slotColors.badge}`}>
                            J{slotNum} {idx === 0 && '👑 HÔTE'}
                          </span>
                          {isMe && (
                            <span className="text-[9px] font-bold text-cyan-300 border border-cyan-400/40 rounded px-1">
                              VOUS
                            </span>
                          )}
                        </div>

                        <div className="mt-2">
                          {player ? (
                            <p className="text-xs font-bold text-white truncate">{player.name}</p>
                          ) : (
                            <p className="text-[11px] text-neutral-500 italic">En attente...</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Actions du salon */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={handleLeaveCurrentRoom}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold transition-colors"
              >
                Quitter le Salon
              </button>

              {netplayService.myPlayerIndex === 0 ? (
                <button
                  onClick={handleStartHostedGame}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 active:scale-98 transition-transform"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Lancer la Partie (Hôte)</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs text-cyan-400 font-bold">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>En attente que l'hôte lance la partie...</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Sélecteur d'onglet : Créer vs Rejoindre */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex border-b border-neutral-800 bg-neutral-950/60">
              <button
                onClick={() => setActiveTab('host')}
                className={`flex-1 py-2.5 text-xs font-bold transition-colors border-b-2 flex items-center justify-center gap-2 ${
                  activeTab === 'host'
                    ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Créer un Salon (Hôte)</span>
              </button>

              <button
                onClick={() => setActiveTab('join')}
                className={`flex-1 py-2.5 text-xs font-bold transition-colors border-b-2 flex items-center justify-center gap-2 ${
                  activeTab === 'join'
                    ? 'border-rose-400 text-rose-300 bg-rose-950/20'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Rejoindre un Salon</span>
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              {activeTab === 'host' ? (
                /* ONGLET 1 : CRÉER UN SALON */
                <div className="space-y-4">
                  {/* Sélection du Jeu */}
                  <div>
                    <label className="text-[11px] uppercase font-bold text-neutral-400 block mb-1.5">
                      Jeu Arcade à héberger :
                    </label>
                    <select
                      value={selectedGameId}
                      onChange={(e) => setSelectedGameId(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                    >
                      {games.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.title} ({g.players || 2} Joueurs)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Badge récapitulatif 2P vs 4P */}
                  <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-neutral-400">Capacité du Jeu</span>
                      <p className="text-xs font-bold text-white">{selectedGame.title}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-black uppercase ${
                      maxPlayersForGame === 4 
                        ? 'bg-amber-400 text-black shadow-md shadow-amber-400/20' 
                        : 'bg-cyan-500 text-black shadow-md shadow-cyan-500/20'
                    }`}>
                      {maxPlayersForGame === 4 ? '🎮 4 Joueurs Simultanés' : '👥 2 Joueurs Max'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[10px] text-cyan-300 font-bold uppercase block truncate">
                          {lanInfo?.lanUrl ? 'Accès mobile sur le même Wi-Fi :' : 'Adresse du salon (Même Wi-Fi & Web) :'}
                        </span>
                        <span className="text-xs font-mono text-white select-all truncate block">{shareBaseUrl}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleCopyCode(shareBaseUrl)}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-cyan-300 transition-colors flex items-center gap-1 text-[11px]"
                        title="Copier l'adresse"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span className="hidden xs:inline">Copier</span>
                      </button>
                      <button
                        onClick={() => setShowQrModal(true)}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-cyan-300 transition-colors"
                        title="Afficher le QR Code"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Une fois le salon créé, vos amis sur le même réseau Wi-Fi ou à distance pourront se joindre à vous en entrant votre code ou en scannant le QR code.
                  </p>

                  <button
                    onClick={handleCreateRoom}
                    className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/30 active:scale-98 transition-transform"
                  >
                    <Radio className="w-4 h-4" />
                    <span>Ouvrir le Salon Réseau</span>
                  </button>
                </div>
              ) : (
                /* ONGLET 2 : REJOINDRE UN SALON */
                <div className="space-y-4">
                  {/* Saisie directe du Code */}
                  <div>
                    <label className="text-[11px] uppercase font-bold text-neutral-400 block mb-1.5">
                      Code du Salon (ex: ARC-74) :
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        placeholder="ARC-XXXX"
                        className="flex-1 bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-sm font-bold text-white tracking-widest uppercase outline-none focus:border-rose-400"
                      />
                      <button
                        onClick={() => handleJoinRoom()}
                        className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs uppercase flex items-center gap-1.5 shadow-md shadow-rose-500/20 active:scale-98 transition-transform"
                      >
                        <span>Rejoindre</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Option Manette Sans Fil Mobile */}
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                      <div>
                        <span className="text-xs font-bold text-white block">Mode Manette Sans Fil</span>
                        <span className="text-[10px] text-neutral-400">Utiliser cet appareil uniquement comme manette tactile</span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={asControllerOnly}
                      onChange={(e) => setAsControllerOnly(e.target.checked)}
                      className="w-4 h-4 accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  {/* Salons ouverts détectés sur le réseau local */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] uppercase font-bold text-neutral-400 flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                        Salons ouverts sur le réseau local :
                      </span>
                      <button
                        onClick={loadRooms}
                        className="p-1 rounded text-neutral-400 hover:text-white transition-colors"
                        title="Actualiser la liste"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRooms ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {availableRooms.length === 0 ? (
                      <div className="p-4 rounded-xl bg-neutral-950/60 border border-neutral-800 text-center text-xs text-neutral-500">
                        Aucun salon ouvert détecté pour le moment sur votre réseau.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {availableRooms.map(r => (
                          <div
                            key={r.code}
                            className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-cyan-500/50 flex items-center justify-between transition-colors"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">{r.gameTitle}</span>
                                <span className="text-[10px] font-bold text-cyan-400 px-1.5 py-0.2 rounded bg-cyan-950 border border-cyan-800">
                                  {r.code}
                                </span>
                              </div>
                              <span className="text-[10px] text-neutral-400">
                                Joueurs : {r.currentPlayers} / {r.maxPlayers}
                              </span>
                            </div>

                            <button
                              onClick={() => handleJoinRoom(r.code)}
                              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold transition-colors"
                            >
                              Rejoindre
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal QR Code Popup pour rejoindre sur mobile ou même Wi-Fi */}
        {showQrModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
            <div className="relative p-6 bg-neutral-900 border border-cyan-500/50 rounded-2xl flex flex-col items-center gap-4 shadow-2xl max-w-xs text-center w-full">
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-black uppercase text-cyan-300 tracking-wider flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-cyan-400" />
                  Scanner pour rejoindre
                </span>
                <button
                  onClick={() => setShowQrModal(false)}
                  className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-neutral-300 leading-snug">
                Pointez la caméra de votre smartphone sur le même Wi-Fi pour vous connecter directement.
              </p>

              <div className="p-3 bg-white rounded-xl shadow-lg border border-neutral-200">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareRoomUrl)}`}
                  alt="QR Code Netplay"
                  className="w-44 h-44 object-contain"
                />
              </div>

              <div className="w-full bg-neutral-950 p-2.5 rounded-xl border border-neutral-800 text-[11px] font-mono text-neutral-300 break-all select-all">
                {shareRoomUrl}
              </div>

              <button
                onClick={() => {
                  handleCopyCode(shareRoomUrl);
                  setShowQrModal(false);
                }}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-cyan-500/20"
              >
                Copier le lien & Fermer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
