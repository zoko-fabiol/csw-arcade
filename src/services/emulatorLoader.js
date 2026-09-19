/**
 * Service de chargement et d'orchestration du Core WebAssembly FinalBurn Neo (EmulatorJS)
 */
class EmulatorLoaderService {
  constructor() {
    this.isScriptLoaded = false;
    this.currentBlobUrls = [];
  }

  /**
   * Injecte dynamiquement le loader WebAssembly s'il n'est pas déjà présent dans le DOM
   */
  loadScript() {
    if (this.isScriptLoaded || window.EJS_player) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/emulatorjs/loader.js';
      script.async = true;
      script.onload = () => {
        this.isScriptLoaded = true;
        console.log('[EmulatorLoader] Loader WebAssembly EmulatorJS chargé.');
        resolve();
      };
      script.onerror = (err) => {
        console.error('[EmulatorLoader] Échec chargement script WASM:', err);
        reject(new Error("Impossible de charger le moteur WebAssembly"));
      };
      document.body.appendChild(script);
    });
  }

  /**
   * Crée un Blob URL sécurisé pour alimenter l'émulateur en mémoire
   * @param {ArrayBuffer} buffer
   */
  createBlobUrl(buffer) {
    const blob = new Blob([buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    this.currentBlobUrls.push(url);
    return url;
  }

  /**
   * Révocation des URLs Blob pour libérer la mémoire RAM
   */
  revokeBlobs() {
    this.currentBlobUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    });
    this.currentBlobUrls = [];
  }
}

export const emulatorLoader = new EmulatorLoaderService();
