/**
 * Service client pour la passerelle de paiement SasPay (via relais serveur sécurisé /api/saspay/*).
 */

export const SASPAY_COIN_PACKS = [
  { id: 'pack_10', coins: 10, amount: 250, eurApprox: '0,38 €', currency: 'XOF', label: 'Pack Dépannage', popular: false },
  { id: 'pack_25', coins: 25, amount: 400, eurApprox: '0,61 €', currency: 'XOF', label: 'Pack Standard', popular: false },
  { id: 'pack_50', coins: 50, amount: 550, eurApprox: '0,84 €', currency: 'XOF', label: 'Pack Joueur', popular: false },
  { id: 'pack_99', coins: 99, amount: 655, eurApprox: '1,00 €', currency: 'XOF', label: 'Pack Max · Meilleure Offre', popular: true },
];

const PENDING_PAYMENT_KEY = 'csw_saspay_pending_payment_v1';

export function savePendingSasPayPayment(info) {
  try {
    if (info) localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(info));
    else localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {}
}

export function getPendingSasPayPayment() {
  try {
    const raw = localStorage.getItem(PENDING_PAYMENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function fetchSasPayCountries() {
  const res = await fetch('/api/saspay/countries');
  const json = await res.json().catch(() => ({}));
  return json?.data || null;
}

export async function fetchSasPayNetworks() {
  const res = await fetch('/api/saspay/networks');
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json?.data) ? json.data : [];
}

export async function createSasPayCheckout({
  uid,
  email,
  firstName,
  lastName,
  displayName,
  packId,
  mode = 'checkout',
  phone = '',
  network = '',
  country = '',
}) {
  const res = await fetch('/api/saspay/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid,
      email,
      firstName,
      lastName,
      displayName,
      packId,
      mode,
      phone,
      network,
      country,
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const errText =
      typeof data?.error === 'string'
        ? data.error
        : data?.error
        ? JSON.stringify(data.error)
        : 'Impossible d’initier le paiement SasPay.';
    throw new Error(errText);
  }
  return data;
}

export async function verifySasPayPayment(paymentId, uid) {
  const res = await fetch(
    `/api/saspay/verify?paymentId=${encodeURIComponent(paymentId)}&uid=${encodeURIComponent(uid || '')}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Impossible de vérifier le paiement SasPay.');
  }
  return data;
}
