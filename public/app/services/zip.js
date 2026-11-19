/**
 * Chargeur partagé pour JSZip (extraction locale de ROMs et d'archives DOS côté navigateur).
 */

export async function ensureJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.onload = () => (window.JSZip ? resolve() : reject(new Error('JSZip non initialisé')));
    script.onerror = () => reject(new Error('Impossible de charger JSZip (connexion requise).'));
    document.head.append(script);
  });
  return window.JSZip;
}

export function getExtension(filename) {
  return (String(filename || '').split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
}
