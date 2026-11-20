import React, { useEffect, useState } from 'react';
import { X, Coins, CreditCard, Smartphone, CheckCircle2, AlertCircle, ExternalLink, RefreshCw, ShieldCheck, LogIn } from 'lucide-react';
import {
  createSasPayCheckout,
  fetchSasPayCountries,
  fetchSasPayNetworks,
  getPendingSasPayPayment,
  SASPAY_COIN_PACKS,
  savePendingSasPayPayment,
  verifySasPayPayment,
} from '../../services/saspayService';
import { addCoins } from '../../services/walletService';

const SAVED_PHONE_KEY = 'csw_player_phone_v1';

export function SasPayModal({ isOpen, onClose, onOpenAuth, userProfile, currentCoins = 0 }) {
  const [selectedPackId, setSelectedPackId] = useState('pack_99');
  const [payMode, setPayMode] = useState('checkout'); // 'checkout' | 'softpay'
  const [phone, setPhone] = useState(() => {
    try { return localStorage.getItem(SAVED_PHONE_KEY) || ''; } catch { return ''; }
  });
  const [network, setNetwork] = useState('');
  const [country, setCountry] = useState(userProfile?.region || 'CM');
  const [countriesData, setCountriesData] = useState([]);
  const [networksData, setNetworksData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [pendingTx, setPendingTx] = useState(() => getPendingSasPayPayment());

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccessMsg('');
    if (userProfile?.region) setCountry(userProfile.region);
    if (userProfile?.phone) setPhone(userProfile.phone);
    setPendingTx(getPendingSasPayPayment());
    fetchSasPayCountries()
      .then((data) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : [];
        setCountriesData(list);
      })
      .catch(() => {});
    fetchSasPayNetworks()
      .then((nets) => setNetworksData(Array.isArray(nets) ? nets : []))
      .catch(() => {});
  }, [isOpen, userProfile?.region, userProfile?.phone]);

  const selectedCountryObj = countriesData.find(
    (c) => String(c.iso_code || '').toUpperCase() === String(country || '').toUpperCase()
  );
  const filteredNetworks = networksData.filter((n) => {
    if (selectedCountryObj?.id && n.country === selectedCountryObj.id) return true;
    const suffix = `_${String(country || '').toLowerCase()}`;
    return String(n.code || '').toLowerCase().endsWith(suffix);
  });
  const displayNetworks = filteredNetworks.length > 0 ? filteredNetworks : networksData;

  useEffect(() => {
    if (displayNetworks.length === 0) return;
    const stillValid = displayNetworks.some((n) => n.code === network);
    if (!stillValid) {
      setNetwork(displayNetworks[0].code);
    }
  }, [country, networksData]);

  if (!isOpen) return null;

  const selectedPack = SASPAY_COIN_PACKS.find((p) => p.id === selectedPackId) || SASPAY_COIN_PACKS[1];

  const handleVerifyPending = async (txToCheck = pendingTx) => {
    if (!txToCheck?.paymentId) return;
    setVerifying(true);
    setError('');
    try {
      const res = await verifySasPayPayment(txToCheck.paymentId, userProfile?.uid);
      if (res.paid) {
        const coinsToCredit = res.coinsAdded || txToCheck.coins || 10;
        addCoins(coinsToCredit);
        savePendingSasPayPayment(null);
        setPendingTx(null);
        setSuccessMsg(`Paiement SasPay confirmé ! +${coinsToCredit} Coins ajoutés à votre compte.`);
      } else {
        setError(`Statut SasPay actuel : ${res.status || 'en attente'}. Finalisez le paiement puis revérifiez.`);
      }
    } catch (e) {
      setError(e?.message || 'Erreur lors de la vérification SasPay.');
    } finally {
      setVerifying(false);
    }
  };

  const handleStartPayment = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    if (phone.trim()) {
      try { localStorage.setItem(SAVED_PHONE_KEY, phone.trim()); } catch {}
    }
    try {
      const result = await createSasPayCheckout({
        uid: userProfile?.uid,
        email: userProfile?.email,
        firstName: userProfile?.firstName,
        lastName: userProfile?.lastName,
        displayName: userProfile?.displayName,
        packId: selectedPack.id,
        mode: payMode,
        phone,
        network,
        country,
      });

      if (result.paid) {
        const coinsToCredit = result.coinsAdded || selectedPack.coins;
        addCoins(coinsToCredit);
        savePendingSasPayPayment(null);
        setPendingTx(null);
        setSuccessMsg(`Paiement SasPay réussi ! +${coinsToCredit} Coins crédités instantanément.`);
        return;
      }

      const pendingInfo = {
        paymentId: result.paymentId,
        coins: selectedPack.coins,
        amount: selectedPack.amount,
        currency: selectedPack.currency,
        checkoutUrl: result.checkoutUrl || null,
        createdAtMs: Date.now(),
      };
      savePendingSasPayPayment(pendingInfo);
      setPendingTx(pendingInfo);

      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, '_blank', 'noopener,noreferrer');
      } else if (payMode === 'softpay') {
        setSuccessMsg('Demande Mobile Money envoyée sur votre téléphone ! Validez puis cliquez sur Vérifier.');
      }
    } catch (err) {
      setError(err?.message || 'Échec de création du paiement SasPay.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[135] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[94dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-neutral-900 border-t sm:border border-amber-500/40 shadow-2xl overflow-hidden text-neutral-100 pb-safe">
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-amber-950/60 via-neutral-900 to-neutral-900 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-wide text-white uppercase">
                Boutique Crédits · SasPay
              </h2>
              <p className="text-[11px] font-mono text-neutral-400">
                Solde actuel : <strong className="text-amber-300">{String(currentCoins).padStart(2, '0')}/99</strong> Coins
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!userProfile?.isAuthenticated ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 mx-auto">
              <LogIn className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-white uppercase">Connexion requise pour payer</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Connectez-vous ou créez votre compte CSW-Arcade avant d’acheter des crédits. Vos informations (Nom, Prénom, Email, Pays) seront remplies automatiquement et vos Coins seront synchronisés sur tous vos appareils.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onOpenAuth?.();
              }}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Se connecter / Créer un compte</span>
            </button>
          </div>
        ) : (
        <form onSubmit={handleStartPayment} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Infos client pré-remplies automatiquement depuis le compte connecté */}
          <div className="px-3 py-2 rounded-xl bg-neutral-950 border border-emerald-500/30 flex items-center justify-between gap-2 text-[11px]">
            <div className="truncate text-neutral-300">
              <span className="text-emerald-400 font-bold">Compte connecté :</span>{' '}
              {userProfile?.firstName || userProfile?.lastName
                ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
                : userProfile?.displayName}{' '}
              · <span className="text-neutral-400">{userProfile?.email}</span>
            </div>
            <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-cyan-300 font-mono text-[10px] shrink-0">
              {country}
            </span>
          </div>
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

          {/* Paiement en attente de confirmation */}
          {pendingTx && (
            <div className="p-3.5 rounded-xl bg-cyan-950/35 border border-cyan-500/40 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-cyan-300">Paiement en attente ({pendingTx.coins} Coins)</span>
                <span className="font-mono text-[10px] text-neutral-400">#{pendingTx.paymentId}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => handleVerifyPending(pendingTx)}
                  className="flex-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
                  <span>{verifying ? 'Vérification…' : 'Vérifier mon paiement'}</span>
                </button>
                {pendingTx.checkoutUrl && (
                  <a
                    href={pendingTx.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="py-2 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-cyan-300 text-xs font-bold flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Rouvrir</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Choix du Pack de Coins */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-neutral-400">
              1. Choisissez votre pack de Crédits
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {SASPAY_COIN_PACKS.map((pack) => {
                const active = pack.id === selectedPackId;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setSelectedPackId(pack.id)}
                    className={`p-3 rounded-xl border text-left transition-all relative ${
                      active
                        ? 'bg-amber-500/15 border-amber-400 shadow-lg'
                        : 'bg-neutral-950 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {pack.popular && (
                      <span className="absolute -top-2 right-2 px-1.5 py-0.5 rounded bg-amber-500 text-black text-[9px] font-black uppercase">
                        Meilleure Offre
                      </span>
                    )}
                    <div className="text-sm font-black text-white">{pack.coins} Coins</div>
                    <div className="text-[10px] text-neutral-400">{pack.label}</div>
                    <div className="text-xs font-mono font-black text-amber-300 mt-1">
                      {pack.amount.toLocaleString('fr-FR')} {pack.currency}{' '}
                      <span className="text-[10px] text-neutral-400 font-normal">({pack.eurApprox})</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Choix du mode SasPay */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-neutral-400">
              2. Mode de paiement SasPay
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPayMode('checkout')}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 ${
                  payMode === 'checkout'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Page SasPay (Carte / MM)</span>
              </button>
              <button
                type="button"
                onClick={() => setPayMode('softpay')}
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 ${
                  payMode === 'softpay'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>Mobile Money Direct</span>
              </button>
            </div>
          </div>

          {payMode === 'softpay' && (
            <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                    Réseau Mobile Money *
                  </label>
                  {displayNetworks.length > 0 ? (
                    <select
                      required
                      value={network}
                      onChange={(e) => setNetwork(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                    >
                      {displayNetworks.map((n) => (
                        <option key={n.id || n.code} value={n.code}>
                          {n.name} ({n.code})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={network}
                      onChange={(e) => setNetwork(e.target.value)}
                      placeholder="orange_cm / mtn_cm / wave_ci"
                      className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                    Pays *
                  </label>
                  {countriesData.length > 0 ? (
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                    >
                      {countriesData
                        .filter((c) => c.is_active !== false)
                        .map((c) => (
                          <option key={c.iso_code || c.id} value={c.iso_code}>
                            {c.name} ({c.iso_code})
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="CM / CI / SN"
                      className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                  Numéro Mobile Money (avec indicatif) *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+2250700000000"
                  className="w-full px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-700 text-xs text-white"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {loading
                ? 'Connexion à SasPay…'
                : `Payer ${selectedPack.amount.toLocaleString('fr-FR')} ${selectedPack.currency} · ${selectedPack.coins} Coins`}
            </span>
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
