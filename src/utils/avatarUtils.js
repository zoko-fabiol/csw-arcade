/**
 * Utilitaires d'avatar joueur : génération d'initiales et redimensionnement/compression locale
 * (crop carré WebP/JPEG léger pour compatibilité Firestore, localStorage et relais LAN).
 */

export function getPlayerInitials(name) {
  const clean = String(name || 'J').trim();
  if (!clean) return 'J';
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function processAvatarFile(file, size = 160) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('Veuillez choisir un fichier image valide (JPG, PNG, WebP ou GIF).'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error('Image trop volumineuse (10 Mo maximum).'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Contexte graphique indisponible.');
        }

        const minSide = Math.min(img.width, img.height);
        const sx = Math.max(0, Math.floor((img.width - minSide) / 2));
        const sy = Math.max(0, Math.floor((img.height - minSide) / 2));
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        let dataUrl = canvas.toDataURL('image/webp', 0.82);
        if (!dataUrl.startsWith('data:image/webp') || dataUrl.length > 90000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        }
        if (dataUrl.length > 90000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.62);
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Impossible de lire cette image.'));
    };
    img.src = objectUrl;
  });
}
