import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, LogIn, UserPlus, User, ShieldCheck, Globe, Trophy, LogOut, Sparkles, CheckCircle2, AlertCircle, BarChart3, Award, RefreshCw, Pencil, Check, Camera, Trash2, Copy
} from 'lucide-react';
import {
  formatFirebaseAuthError,
  getPlayerFriendTag,
  loginAsGuest,
  loginWithEmail,
  loginWithGoogle,
  logoutUser,
  registerWithEmail,
  updateUserProfile,
} from '../../services/authService';
import { ALL_COUNTRIES, getCountryByCode } from '../../data/countries';
import { getRankTierMeta, loadPlayerGameStats } from '../../services/scoreRankingService';
import { processAvatarFile } from '../../utils/avatarUtils';
import { PlayerAvatar } from '../common/PlayerAvatar';

function formatPlayTime(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

export function AuthModal({ isOpen, onClose, userProfile, activeChannels = [] }) {
  const [tab, setTab] = useState(userProfile?.isAuthenticated ? 'profile' : 'register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lastName, setLastName] = useState(userProfile?.lastName || '');
  const [firstName, setFirstName] = useState(userProfile?.firstName || '');
  const [displayName, setDisplayName] = useState(userProfile?.displayName || userProfile?.name || '');
  const [region, setRegion] = useState(userProfile?.region || 'FR');
  const [countrySearch, setCountrySearch] = useState('');
  const [editingField, setEditingField] = useState(null); // 'lastName' | 'firstName' | 'displayName' | 'region' | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [syncingStats, setSyncingStats] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [copiedTag, setCopiedTag] = useState(false);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setLastName(userProfile?.lastName || '');
    setFirstName(userProfile?.firstName || '');
    setDisplayName(userProfile?.displayName || userProfile?.name || '');
    setRegion(userProfile?.region || 'FR');
    setCountrySearch('');
    setEditingField(null);
    setTab(userProfile?.isAuthenticated ? 'profile' : 'register');
    setError('');
    setSuccessMsg('');
  }, [isOpen, userProfile?.uid, userProfile?.isAuthenticated]);

  useEffect(() => {
    setEditingField(null);
  }, [tab]);

  useEffect(() => {
    if (!isOpen || !userProfile?.uid) return;
    loadPlayerGameStats(userProfile.uid).catch(() => {});
  }, [isOpen, tab, userProfile?.uid]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return ALL_COUNTRIES;
    return ALL_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    );
  }, [countrySearch]);

  if (!isOpen) return null;

  const isLoggedIn = Boolean(userProfile?.isAuthenticated);
  const activeTab = isLoggedIn && (tab === 'register' || tab === 'login') ? 'profile' : tab;
  const rankMeta = getRankTierMeta(userProfile?.rank || 'D');
  const countryMeta = getCountryByCode(userProfile?.region || 'FR');
  const gameStats = Array.isArray(userProfile?.gameStats) ? userProfile.gameStats : [];
  const totalPlayTimeSeconds = gameStats.reduce((acc, st) => acc + Number(st.playTimeSeconds || 0), 0);

  const handleRefreshStats = async () => {
    if (!userProfile?.uid || syncingStats) return;
    setSyncingStats(true);
    try {
      await loadPlayerGameStats(userProfile.uid);
    } finally {
      setTimeout(() => setSyncingStats(false), 350);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      await loginWithEmail({ email, password });
      setSuccessMsg('Connexion Firebase réussie !');
      setTimeout(() => onClose?.(), 650);
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      await registerWithEmail({
        lastName,
        firstName,
        displayName,
        region,
        email,
        password,
      });
      setSuccessMsg('Compte CSW-Arcade créé et connecté !');
      setTimeout(() => onClose?.(), 650);
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      await loginWithGoogle();
      setSuccessMsg('Connecté avec Google !');
      setTimeout(() => onClose?.(), 600);
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const startEditField = (field) => {
    setError('');
    setSuccessMsg('');
    setLastName(userProfile?.lastName || '');
    setFirstName(userProfile?.firstName || '');
    setDisplayName(userProfile?.displayName || userProfile?.name || '');
    setRegion(userProfile?.region || 'FR');
    setCountrySearch('');
    setEditingField(field);
  };

  const cancelEditField = () => {
    setLastName(userProfile?.lastName || '');
    setFirstName(userProfile?.firstName || '');
    setDisplayName(userProfile?.displayName || userProfile?.name || '');
    setRegion(userProfile?.region || 'FR');
    setCountrySearch('');
    setError('');
    setEditingField(null);
  };

  const handleSaveProfileField = async (e, field) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    const payload = {
      lastName: field === 'lastName' ? lastName : (userProfile?.lastName || ''),
      firstName: field === 'firstName' ? firstName : (userProfile?.firstName || ''),
      displayName: field === 'displayName' ? displayName : (userProfile?.displayName || userProfile?.name || ''),
      region: field === 'region' ? region : (userProfile?.region || 'FR'),
    };
    if (field === 'displayName' && !String(payload.displayName || '').trim()) {
      setError('Veuillez choisir un pseudo.');
      return;
    }

    setLoading(true);
    try {
      if (!userProfile?.isAuthenticated) {
        await loginAsGuest(payload);
      } else {
        await updateUserProfile(payload);
      }
      setEditingField(null);
      setCountrySearch('');
      setSuccessMsg('Profil mis à jour dans tous les salons !');
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError('');
    try {
      await logoutUser();
      setTab('login');
      setSuccessMsg('Déconnecté. Vous êtes maintenant en mode Invité.');
    } finally {
      setLoading(false);
    }
  };

  const friendTag = userProfile?.friendTag || getPlayerFriendTag(userProfile?.displayName || userProfile?.name, userProfile?.uid);

  const handleCopyFriendTag = async () => {
    try {
      await navigator.clipboard.writeText(friendTag);
      setCopiedTag(true);
      setTimeout(() => setCopiedTag(false), 1800);
    } catch {
      /* noop */
    }
  };

  const handleAvatarSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setSuccessMsg('');
    setUploadingPhoto(true);
    try {
      const dataUrl = await processAvatarFile(file, 160);
      if (!userProfile?.isAuthenticated) {
        await loginAsGuest({ photoURL: dataUrl });
      } else {
        await updateUserProfile({ photoURL: dataUrl });
      }
      setSuccessMsg('Photo de profil mise à jour !');
    } catch (err) {
      setError(err?.message || 'Impossible de mettre à jour la photo de profil.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setError('');
    setSuccessMsg('');
    setUploadingPhoto(true);
    try {
      await updateUserProfile({ photoURL: null });
      setSuccessMsg('Photo de profil supprimée.');
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Compte, Stats et Rang"
    >
      <div className="w-full sm:max-w-xl max-h-[94dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-neutral-900 border-t sm:border u-accent-border shadow-2xl overflow-hidden text-neutral-100 pb-safe">
        {/* En-tête thématisé par la console active */}
        <div className="u-banner flex items-center justify-between px-4 sm:px-5 py-4 border-b shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PlayerAvatar
              photoURL={userProfile?.photoURL}
              name={userProfile?.displayName || userProfile?.name || 'Joueur'}
              size="md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white truncate">
                  Compte &amp; Rang
                </h2>
                <span
                  className={`px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-black shrink-0 ${rankMeta.color}`}
                  title={`Rang évalué automatiquement : ${rankMeta.id} (${rankMeta.label})`}
                >
                  Rang {rankMeta.id}
                </span>
              </div>
              <p className="text-[11px] font-mono text-neutral-300 truncate mt-0.5">
                {friendTag} · {rankMeta.label} · {userProfile?.ratingPoints || 0} RP
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le compte"
            className="arcade-focus-ring p-2 min-w-[44px] min-h-[44px] rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-200 hover:text-white flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Onglets — Pilules segmentées thématisées */}
        <div className="p-2.5 border-b border-white/10 bg-neutral-950/80 shrink-0">
          <div
            className={`${
              isLoggedIn ? 'grid grid-cols-2' : 'flex overflow-x-auto no-scrollbar sm:grid sm:grid-cols-4'
            } gap-1.5 p-1 rounded-2xl bg-neutral-900 border border-white/10 text-xs font-bold`}
          >
            {!isLoggedIn && (
              <>
                <button
                  type="button"
                  onClick={() => { setTab('register'); setError(''); setSuccessMsg(''); }}
                  className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all shrink-0 ${
                    activeTab === 'register'
                      ? 'u-btn-primary'
                      : 'text-neutral-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Créer</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setTab('login'); setError(''); setSuccessMsg(''); }}
                  className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all shrink-0 ${
                    activeTab === 'login'
                      ? 'u-btn-primary'
                      : 'text-neutral-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Connexion</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { setTab('stats'); setError(''); setSuccessMsg(''); }}
              className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all shrink-0 ${
                activeTab === 'stats'
                  ? 'u-btn-primary'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Stats &amp; Rang</span>
            </button>
            <button
              type="button"
              onClick={() => { setTab('profile'); setError(''); setSuccessMsg(''); }}
              className={`arcade-focus-ring py-2 px-3 min-h-[40px] rounded-xl flex items-center justify-center gap-1.5 transition-all shrink-0 ${
                activeTab === 'profile'
                  ? 'u-btn-primary'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Profil</span>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ONGLET INSCRIPTION COMPLÈTE (Nom, Prénom, Pseudo, Pays parmi tous les pays, Email, Mot de passe) */}
          {!isLoggedIn && activeTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                    Nom *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Ex: Dupont"
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                    Prénom *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Ex: Lucas"
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Pseudo (affiché aux salons &amp; classements) *
                </label>
                <input
                  type="text"
                  required
                  maxLength={24}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex: Ryu_FR99"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3 u-accent-text" /> Pays ({ALL_COUNTRIES.length} pays) *
                  </span>
                  <span className="text-[10px] u-accent-text">
                    {getCountryByCode(region).flag} {getCountryByCode(region).name}
                  </span>
                </label>
                <input
                  type="text"
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  placeholder="Filtrer un pays (ex: France, Sénégal, Maroc, Japon, Brésil…)"
                  className="w-full px-3 py-1.5 mb-1.5 rounded-lg bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white placeholder:text-neutral-400 focus:outline-none arcade-focus-ring"
                />
                <select
                  required
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                >
                  {filteredCountries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joueur@csw-arcade.com"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Mot de passe (min. 6 caractères) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Votre <strong>Rang (D → C → B → A → S → S+)</strong> sera évalué automatiquement en fonction de vos meilleurs scores sur les jeux que vous jouez.
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs transition-colors"
              >
                {loading ? 'Création du compte…' : 'Créer mon compte CSW-Arcade'}
              </button>
            </form>
          )}

          {/* ONGLET LOGIN */}
          {!isLoggedIn && activeTab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Email Firebase
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joueur@csw-arcade.com"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                  Mot de passe
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl u-btn-primary disabled:opacity-50 font-black text-xs transition-colors"
              >
                {loading ? 'Connexion en cours…' : 'Se connecter (Login)'}
              </button>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-neutral-800" />
                <span className="shrink mx-3 text-[10px] font-mono uppercase text-neutral-400">OU</span>
                <div className="flex-grow border-t border-neutral-800" />
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={handleGoogle}
                className="w-full py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-neutral-900 font-bold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Continuer avec Google</span>
              </button>
            </form>
          )}

          {/* ONGLET STATS DU PERSONNAGE & ÉVALUATION AUTOMATIQUE DU RANG */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              {/* Carte Évaluation du Rang */}
              <div className="p-4 rounded-xl bg-neutral-950 border border-amber-500/35 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <PlayerAvatar
                        photoURL={userProfile?.photoURL}
                        name={userProfile?.displayName || userProfile?.name || 'Joueur'}
                        size="card"
                        shape="rounded"
                      />
                      <span
                        className={`absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded border text-[9px] font-mono font-black ${rankMeta.color}`}
                        title={`Rang ${rankMeta.id} — ${rankMeta.label}`}
                      >
                        {rankMeta.id}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-mono uppercase text-amber-300 flex items-center gap-1">
                        <Award className="w-3.5 h-3.5" /> Évaluation du Personnage
                      </div>
                      <div className="text-base font-black text-white">
                        Rang {rankMeta.id} — {rankMeta.label}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-mono font-black u-accent-text">
                      {userProfile?.ratingPoints || 0} <span className="text-xs">RP</span>
                    </div>
                    <div className="text-[10px] font-mono text-neutral-400">
                      {userProfile?.nextRank
                        ? `Prochain rang (${userProfile.nextRank}) : ${userProfile.nextRankThreshold} RP`
                        : 'Rang Maximum atteint !'}
                    </div>
                  </div>
                </div>

                {/* Barre de progression vers le rang suivant */}
                <div className="space-y-1">
                  <div className="w-full h-2.5 rounded-full bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-400 transition-all duration-500"
                      style={{ width: `${userProfile?.progressPercent || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-neutral-400">
                    <span>Progression : {userProfile?.progressPercent || 0}%</span>
                    <span>
                      {userProfile?.gamesCount || 0} jeu(x) joué(s) · {userProfile?.totalParties || 0} partie(s)
                      {totalPlayTimeSeconds > 0 ? ` · ⏱ ${formatPlayTime(totalPlayTimeSeconds)}` : ''}
                    </span>
                  </div>
                </div>

                {/* Compteurs globaux */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-center">
                    <div className="text-[10px] font-mono text-neutral-400">MEILLEUR SCORE</div>
                    <div className="text-xs font-mono font-black text-amber-300">
                      {(userProfile?.highestScore || 0).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-center">
                    <div className="text-[10px] font-mono text-neutral-400">JEUX JOUÉS</div>
                    <div className="text-xs font-mono font-black u-accent-text">
                      {userProfile?.gamesCount || 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-center">
                    <div className="text-[10px] font-mono text-neutral-400">PARTIES · TEMPS</div>
                    <div className="text-xs font-mono font-black text-emerald-300">
                      {userProfile?.totalParties || 0}
                      {totalPlayTimeSeconds > 0 ? ` · ${formatPlayTime(totalPlayTimeSeconds)}` : ''}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-neutral-400 leading-relaxed pt-0.5">
                  Barème équilibré : jusqu’à 221 RP par score (plafonné), +60 RP de régularité (4 RP/partie terminée) et +60 RP de temps de jeu (~341 RP max/jeu, S+ à 5 000 RP).
                </p>
              </div>

              {/* Liste des stats par jeu */}
              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase text-neutral-400 flex items-center justify-between gap-2">
                  <span>Stats &amp; Scores par jeu ({gameStats.length})</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-400 hidden sm:inline">RAM Auto</span>
                    <button
                      type="button"
                      onClick={handleRefreshStats}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] font-mono u-accent-text transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${syncingStats ? 'animate-spin' : ''}`} />
                      <span>Actualiser</span>
                    </button>
                  </div>
                </div>

                {gameStats.length === 0 ? (
                  <div className="p-5 rounded-xl bg-neutral-950 border border-neutral-800 text-center text-xs text-neutral-400 space-y-1">
                    <p className="font-bold text-neutral-300">Aucune statistique enregistrée pour le moment.</p>
                    <p className="text-[11px]">
                      Lancez un jeu : vos parties, votre temps de jeu et vos scores RAM sont enregistrés et synchronisés automatiquement.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {gameStats.map((st) => {
                      const gRank = getRankTierMeta(st.gameRank || 'D');
                      const hasScore = Number(st.bestScore || 0) > 0;
                      return (
                        <div
                          key={st.gameId}
                          className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black border ${gRank.color}`}>
                                {gRank.id}
                              </span>
                              <span className="text-xs font-bold text-white truncate">{st.gameTitle}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-neutral-400 mt-1">
                              <span className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 u-accent-text">
                                {st.platformLabel || 'Arcade'}
                              </span>
                              <span>{st.gamesPlayed || 1} partie(s)</span>
                              {st.playTimeSeconds > 0 && <span>· ⏱ {formatPlayTime(st.playTimeSeconds)}</span>}
                              <span className="text-amber-300/90">· +{st.gameRatingPoints || 0} RP</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {hasScore ? (
                              <>
                                <div className="text-xs font-mono font-black text-amber-300">
                                  🏆 {Number(st.bestScore).toLocaleString('fr-FR')} pts
                                </div>
                                {Number(st.lastScore || 0) > 0 && (
                                  <div className="text-[10px] font-mono text-neutral-400">
                                    Dernier : {Number(st.lastScore).toLocaleString('fr-FR')}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-[11px] font-mono font-bold text-neutral-300">
                                  Session suivie
                                </div>
                                <div className="text-[10px] font-mono text-neutral-400">
                                  En attente score RAM
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ONGLET PROFIL JOUEUR */}
          {activeTab === 'profile' && (() => {
            const profileTextFields = [
              {
                key: 'lastName',
                label: 'Nom',
                value: lastName,
                savedValue: userProfile?.lastName,
                setter: setLastName,
                maxLength: 40,
                required: false,
                placeholder: 'Votre nom',
                emptyText: 'Non renseigné',
              },
              {
                key: 'firstName',
                label: 'Prénom',
                value: firstName,
                savedValue: userProfile?.firstName,
                setter: setFirstName,
                maxLength: 40,
                required: false,
                placeholder: 'Votre prénom',
                emptyText: 'Non renseigné',
              },
              {
                key: 'displayName',
                label: 'Pseudo (salons & classements)',
                value: displayName,
                savedValue: userProfile?.displayName || userProfile?.name,
                setter: setDisplayName,
                maxLength: 24,
                required: true,
                placeholder: 'Votre pseudo',
                emptyText: 'Joueur',
              },
            ];

            return (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <PlayerAvatar
                        photoURL={userProfile?.photoURL}
                        name={userProfile?.displayName || userProfile?.name || 'Joueur'}
                        size="lg"
                      />
                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={() => photoInputRef.current?.click()}
                        aria-label="Changer la photo de profil"
                        title="Importer une photo de profil"
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full u-btn-primary disabled:opacity-50 border-2 border-neutral-950 flex items-center justify-center shadow-lg transition-colors cursor-pointer"
                      >
                        <Camera aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleAvatarSelected}
                        className="hidden"
                      />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span className="truncate">
                          {userProfile?.firstName || userProfile?.lastName
                            ? `${[userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ')} (${userProfile?.displayName})`
                            : userProfile?.displayName}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-neutral-400 truncate flex items-center gap-1.5">
                        <ShieldCheck
                          aria-hidden="true"
                          className={`w-3.5 h-3.5 shrink-0 ${userProfile?.isAuthenticated ? 'text-emerald-400' : 'text-amber-400'}`}
                        />
                        <span className="truncate">
                          {userProfile?.isAuthenticated ? userProfile.email : 'Profil Invité actif aux salons'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <button
                          type="button"
                          onClick={handleCopyFriendTag}
                          title="Copier mon Tag Ami pour le partager à mes amis"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-[10px] font-mono u-accent-text transition-colors cursor-pointer"
                        >
                          <span>Tag : {friendTag}</span>
                          <Copy aria-hidden="true" className="w-2.5 h-2.5" />
                          {copiedTag && <span className="text-emerald-300 font-bold">Copié !</span>}
                        </button>
                        {userProfile?.photoURL && (
                          <button
                            type="button"
                            disabled={uploadingPhoto}
                            onClick={handleRemoveAvatar}
                            aria-label="Supprimer la photo de profil"
                            title="Supprimer la photo"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-neutral-900 hover:bg-rose-950/70 border border-neutral-800 hover:border-rose-500/40 text-[10px] font-mono text-neutral-400 hover:text-rose-200 transition-colors cursor-pointer"
                          >
                            <Trash2 aria-hidden="true" className="w-2.5 h-2.5" />
                            <span>Retirer photo</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded border text-[11px] font-mono font-black shrink-0 ${rankMeta.color}`}>
                    Rang {rankMeta.id}
                  </span>
                </div>

                {/* Informations utilisateur en lecture seule avec bouton stylo par champ */}
                <div className="rounded-xl bg-neutral-950 border border-neutral-800 divide-y divide-neutral-800/80">
                  {profileTextFields.map((field) => {
                    const isEditing = editingField === field.key;
                    const hasValue = Boolean(String(field.savedValue || '').trim());
                    return (
                      <div key={field.key} className="px-3.5 py-2.5">
                        {isEditing ? (
                          <form onSubmit={(e) => handleSaveProfileField(e, field.key)} className="space-y-1.5">
                            <label
                              htmlFor={`profile-field-${field.key}`}
                              className="block text-[10px] font-mono uppercase tracking-wider u-accent-text"
                            >
                              {field.label}
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                id={`profile-field-${field.key}`}
                                type="text"
                                autoFocus
                                required={field.required}
                                maxLength={field.maxLength}
                                value={field.value}
                                placeholder={field.placeholder}
                                onChange={(e) => field.setter(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelEditField();
                                  }
                                }}
                                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-neutral-900 border u-accent-border text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                              />
                              <button
                                type="submit"
                                disabled={loading}
                                aria-label={`Enregistrer ${field.label}`}
                                title="Enregistrer"
                                className="w-8 h-8 rounded-lg u-btn-primary disabled:opacity-50 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                              >
                                <Check aria-hidden="true" className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={cancelEditField}
                                aria-label={`Annuler la modification (${field.label})`}
                                title="Annuler"
                                className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                              >
                                <X aria-hidden="true" className="w-4 h-4" />
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                                {field.label}
                              </div>
                              <div
                                className={`text-xs mt-0.5 truncate ${
                                  hasValue ? 'font-semibold text-white' : 'text-neutral-400 italic'
                                }`}
                              >
                                {hasValue ? field.savedValue : field.emptyText}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => startEditField(field.key)}
                              aria-label={`Modifier ${field.label}`}
                              title={`Modifier ${field.label}`}
                              className="w-8 h-8 rounded-lg text-neutral-400 hover:u-accent-text hover:bg-neutral-800/80 border border-transparent hover:border-neutral-700 flex items-center justify-center shrink-0 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                            >
                              <Pencil aria-hidden="true" className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Pays */}
                  <div className="px-3.5 py-2.5">
                    {editingField === 'region' ? (
                      <form onSubmit={(e) => handleSaveProfileField(e, 'region')} className="space-y-1.5">
                        <label
                          htmlFor="profile-field-region"
                          className="block text-[10px] font-mono uppercase tracking-wider u-accent-text flex items-center gap-1"
                        >
                          <Globe aria-hidden="true" className="w-3 h-3" /> Pays ({ALL_COUNTRIES.length} pays)
                        </label>
                        <input
                          type="text"
                          value={countrySearch}
                          onChange={(e) => setCountrySearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditField();
                            }
                          }}
                          placeholder="Rechercher un pays…"
                          className="w-full px-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-base sm:text-xs text-white placeholder:text-neutral-400 focus:outline-none arcade-focus-ring"
                        />
                        <div className="flex items-center gap-1.5">
                          <select
                            id="profile-field-region"
                            autoFocus
                            value={region}
                            onChange={(e) => setRegion(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEditField();
                              }
                            }}
                            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-neutral-900 border u-accent-border text-base sm:text-xs text-white focus:outline-none arcade-focus-ring"
                          >
                            {filteredCountries.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.flag} {c.name} ({c.code})
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={loading}
                            aria-label="Enregistrer le pays"
                            title="Enregistrer"
                            className="w-8 h-8 rounded-lg u-btn-primary disabled:opacity-50 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                          >
                            <Check aria-hidden="true" className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={cancelEditField}
                            aria-label="Annuler la modification du pays"
                            title="Annuler"
                            className="w-8 h-8 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                          >
                            <X aria-hidden="true" className="w-4 h-4" />
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 flex items-center gap-1">
                            <Globe aria-hidden="true" className="w-3 h-3" /> Pays
                          </div>
                          <div className="text-xs font-semibold text-white mt-0.5 truncate">
                            {countryMeta.name} ({countryMeta.code})
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startEditField('region')}
                          aria-label="Modifier le pays"
                          title="Modifier le pays"
                          className="arcade-focus-ring w-10 h-10 rounded-xl text-neutral-300 hover:u-accent-text hover:bg-white/10 border border-transparent hover:border-white/15 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                        >
                          <Pencil aria-hidden="true" className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Jeux / Salons où le joueur est actuellement actif */}
                <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-white/10">
                  <div className="text-[10px] font-mono uppercase text-neutral-300 mb-2">
                    Salons &amp; Jeux sélectionnés où vous êtes actif ({activeChannels.length}/3) :
                  </div>
                  {activeChannels.length === 0 ? (
                    <p className="text-xs text-neutral-400">
                      Lancez un jeu ou cliquez sur Salon dans le catalogue pour apparaître actif.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {activeChannels.map((ch) => (
                        <span
                          key={ch.gameId}
                          className="px-2.5 py-1 rounded-lg u-badge text-[11px] font-bold"
                        >
                          {ch.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {userProfile?.isAuthenticated && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="arcade-focus-ring px-4 py-2.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-rose-950 border border-white/10 hover:border-rose-500/40 text-neutral-200 hover:text-rose-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <LogOut aria-hidden="true" className="w-4 h-4" />
                      <span>Déconnexion</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
