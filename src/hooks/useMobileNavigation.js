import { useEffect, useRef, useState } from 'react';

/**
 * Hook de navigation native mobile pour PWA
 * - Empêche la fermeture accidentelle de la PWA sur geste Retour Android ou balayage
 * - Ferme séquentiellement : Modales -> Menu Drawer -> Partie en cours
 * - Exige un double-tap Retour pour quitter depuis l'accueil avec toast informatif
 */
export function useMobileNavigation({
  layers = null,
  activeGame,
  onExitGame,
  isSettingsOpen,
  onCloseSettings,
  isLobbyOpen,
  onCloseLobby,
  mobileControllerSession,
  onCloseMobileController,
  isWebRtcTestOpen,
  onCloseWebRtcTest,
  isMobileSidebarOpen,
  onCloseMobileSidebar
} = {}) {
  const [exitToastVisible, setExitToastVisible] = useState(false);
  const lastBackPressTimeRef = useRef(0);
  const isNavigatingRef = useRef(false);

  const resolvedLayers = Array.isArray(layers)
    ? layers
    : [
        { id: 'settings', active: Boolean(isSettingsOpen), onClose: onCloseSettings },
        { id: 'lobby', active: Boolean(isLobbyOpen), onClose: onCloseLobby },
        { id: 'controller', active: Boolean(mobileControllerSession), onClose: onCloseMobileController },
        { id: 'webrtc', active: Boolean(isWebRtcTestOpen), onClose: onCloseWebRtcTest },
        { id: 'sidebar', active: Boolean(isMobileSidebarOpen), onClose: onCloseMobileSidebar },
        { id: 'game', active: Boolean(activeGame), onClose: onExitGame },
      ];

  const layersRef = useRef(resolvedLayers);
  layersRef.current = resolvedLayers;

  const activeLayerKey = resolvedLayers
    .filter((l) => l.active)
    .map((l) => l.id)
    .join(',');

  // Synchronisation de l'historique quand un écran ou modal s'ouvre
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!window.history.state) {
      window.history.replaceState({ screen: 'home' }, '');
    }

    const topLayer = layersRef.current.find((l) => l.active);
    if (topLayer) {
      if (!isNavigatingRef.current && window.history.state?.layer !== topLayer.id) {
        window.history.pushState({ layer: topLayer.id }, '');
      }
    }
    isNavigatingRef.current = false;
  }, [activeLayerKey]);

  // Écoute de l'événement popstate (Bouton retour Android / Swipe retour iOS)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      isNavigatingRef.current = true;

      const topLayer = layersRef.current.find((l) => l.active);
      if (topLayer) {
        topLayer.onClose?.();
        return;
      }

      // Racine (catalogue d'accueil) : protection double-tap
      const now = Date.now();
      if (lastBackPressTimeRef.current > 0 && now - lastBackPressTimeRef.current < 2000) {
        return;
      }

      lastBackPressTimeRef.current = now;
      window.history.pushState({ screen: 'home' }, '');
      setExitToastVisible(true);
      setTimeout(() => setExitToastVisible(false), 2000);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return { exitToastVisible };
}

/**
 * Hook pour détecter l'état de connexion (Online / Offline / Mode Avion)
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
