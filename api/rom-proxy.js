export const config = {
  runtime: 'edge', // Edge Runtime pour streaming illimité sans limite de payload de 4.5 Mo
};

export default async function handler(request) {
  // Gestion du preflight CORS OPTIONS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const url = new URL(request.url);
  const file = url.searchParams.get('file');
  const customUrl = url.searchParams.get('url');

  if (!file && !customUrl) {
    return new Response(JSON.stringify({ error: 'Paramètre "file" ou "url" requis' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Liste ordonnée de miroirs Archive.org haute disponibilité
  const candidateUrls = [];
  if (customUrl) {
    candidateUrls.push(customUrl);
  }
  if (file) {
    const cleanZip = file.toLowerCase().endsWith('.zip') ? file.toLowerCase() : file.toLowerCase() + '.zip';
    candidateUrls.push(
      `https://archive.org/cors/neo-geo-mvs-romset/${cleanZip}`,
      `https://archive.org/download/neo-geo-mvs-romset/${cleanZip}`,
      `https://archive.org/download/fbnarcade-fullset/${cleanZip}`,
      `https://archive.org/download/NeoGeoRomCollectionByGhostware/${cleanZip}`,
      `https://archive.org/download/mame-merged/${cleanZip}`
    );
  }

  let lastError = null;
  for (const remoteUrl of candidateUrls) {
    try {
      const response = await fetch(remoteUrl, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*'
        }
      });

      if (response.ok) {
        const headers = new Headers();
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        headers.set('Access-Control-Allow-Headers', '*');
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
        headers.set('Content-Type', 'application/zip');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        const cl = response.headers.get('content-length');
        if (cl) {
          headers.set('Content-Length', cl);
        }

        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers
          });
        }

        // Stream direct du corps de la réponse sans limite de taille
        return new Response(response.body, {
          status: 200,
          headers
        });
      }
    } catch (fetchErr) {
      lastError = fetchErr;
    }
  }

  return new Response(JSON.stringify({ 
    error: 'ROM introuvable sur les serveurs Archive.org', 
    file,
    details: lastError?.message 
  }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
