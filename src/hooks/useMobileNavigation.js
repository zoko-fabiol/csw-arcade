import { useEffect, useRef, useState } from 'react';

/**
 * Hook de navigation native mobile pour PWA
 * - Empêche la fermeture accidentelle de la PWA sur geste Retour Android ou balayage
 * - Ferme séquentiellement : Modales -> Menu Drawer -> Partie en cours
 * - Exige un double-tap Retour pour quitter depuis l'accueil avec toast informatif
 */
export function useMobileNavigation({
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
}) {
  const [exitToastVisible, setExitToastVisible] = useState(false);
  const lastBackPressTimeRef = useRef(0);
  const isNavigatingRef = useRef(false);

  // Synchronisation de l'historique quand un écran ou modal s'ouvre
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Assurer un état initial dans l'historique
    if (!window.history.state) {
      window.history.replaceState({ screen: 'home' }, '');
    }

    let currentLayer = null;
    if (activeGame) {
      currentLayer = 'game';
    } else if (isSettingsOpen) {
      currentLayer = 'settings';
    } else if (isLobbyOpen) {
      currentLayer = 'lobby';
    } else if (mobileControllerSession) {
      currentLayer = 'controller';
    } else if (isWebRtcTestOpen) {
      currentLayer = 'webrtc';
    } else if (isMobileSidebarOpen) {
      currentLayer = 'sidebar';
    }

    if (currentLayer) {
      // Pousser un état d'écran dans l'historique
      if (!isNavigatingRef.current && window.history.state?.layer !== currentLayer) {
        window.history.pushState({ layer: currentLayer }, '');
      }
    }
    isNavigatingRef.current = false;
  }, [
    activeGame,
    isSettingsOpen,
    isLobbyOpen,
    mobileControllerSession,
    isWebRtcTestOpen,
    isMobileSidebarOpen
  ]);

  // Écoute de l'événement popstate (Bouton retour Android / Swipe retour iOS)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = (event) => {
      isNavigatingRef.current = true;

      // 1. Si un modal secondaire est ouvert, fermer le modal
      if (isSettingsOpen) {
        onCloseSettings();
        return;
      }
      if (isLobbyOpen) {
        onCloseLobby();
        return;
      }
      if (mobileControllerSession) {
        onCloseMobileController();
        return;
      }
      if (isWebRtcTestOpen) {
        onCloseWebRtcTest();
        return;
      }

      // 2. Si le drawer de navigation mobile est ouvert, le fermer
      if (isMobileSidebarOpen) {
        onCloseMobileSidebar();
        return;
      }

      // 3. Si une partie est active, quitter proprement la partie vers le catalogue
      if (activeGame) {
        console.log('[MobileNav] Geste retour détecté : fermeture propre de la partie en cours');
        onExitGame();
        return;
      }

      // 4. Si nous sommes à la racine (catalogue d'accueil), protection double-tap
      const now = Date.now();
      if (lastBackPressTimeRef.current > 0 && (now - lastBackPressTimeRef.current < 2000)) {
        // Deuxième appui rapide : laisser Android quitter la PWA
        return;
      }

      // Premier appui : bloquer la fermeture, réinjecter l'état et afficher le toast
      lastBackPressTimeRef.current = now;
      window.history.pushState({ screen: 'home' }, '');
      setExitToastVisible(true);
      setTimeout(() => setExitToastVisible(false), 2000);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
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
  ]);

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
