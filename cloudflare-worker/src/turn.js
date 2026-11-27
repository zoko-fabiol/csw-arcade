/**
 * Génération & mise en cache des identifiants Cloudflare Anycast TURN + STUN
 * Remplace la lecture statique de config.php tout en priorisant le relais UDP.
 */

const BASE_STUN_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

const TURN_CACHE_TTL_MS = 10 * 3600 * 1000;
let cachedTurnServers = null;
let cachedTurnExpiresAt = 0;

export function normalizeTurnEntries(cfList) {
  const built = [];
  for (const entry of cfList) {
    const rawUrls = Array.isArray(entry?.urls)
      ? entry.urls
      : entry?.urls
        ? [entry.urls]
        : [];
    const udpFirst = [
      ...rawUrls.filter((u) => String(u).includes('transport=udp')),
      ...rawUrls.filter((u) => !String(u).includes('transport=udp')),
    ];
    if (udpFirst.length > 0) {
      built.push({ ...entry, urls: udpFirst });
    }
  }
  return built;
}

export async function getIceServers(env, fetchImpl = fetch) {
  const cfKeyId = env?.CLOUDFLARE_TURN_KEY_ID || '';
  const cfToken = env?.CLOUDFLARE_TURN_API_TOKEN || '';

  if (cfKeyId && cfToken) {
    if (cachedTurnServers && Date.now() < cachedTurnExpiresAt) {
      return [...BASE_STUN_SERVERS, ...cachedTurnServers];
    }
    try {
      const cfRes = await fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfKeyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );
      if (cfRes.ok) {
        const cfJson = await cfRes.json();
        const rawList = Array.isArray(cfJson?.iceServers)
          ? cfJson.iceServers
          : cfJson?.iceServers
            ? [cfJson.iceServers]
            : [];
        const built = normalizeTurnEntries(rawList);
        if (built.some((e) => e.urls.some((u) => String(u).startsWith('turn')))) {
          cachedTurnServers = built;
          cachedTurnExpiresAt = Date.now() + TURN_CACHE_TTL_MS;
          return [...BASE_STUN_SERVERS, ...built];
        }
      }
    } catch {
      /* repli sur STUN direct si l'API TURN est temporairement injoignable */
    }
  }

  return [...BASE_STUN_SERVERS];
}

export async function handleTurnCredentialsRequest(env, corsHeaders = {}) {
  const iceServers = await getIceServers(env);
  const hasTurn = iceServers.some((e) => {
    const urls = Array.isArray(e.urls) ? e.urls : [e.urls];
    return urls.some((u) => String(u).startsWith('turn'));
  });
  return new Response(
    JSON.stringify({
      ok: true,
      mode: hasTurn ? 'cloudflare-anycast-turn' : 'stun-only',
      iceServers,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...corsHeaders,
      },
    }
  );
}

export function resetTurnCacheForTest() {
  cachedTurnServers = null;
  cachedTurnExpiresAt = 0;
}
