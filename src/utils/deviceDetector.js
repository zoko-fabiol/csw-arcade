import { useState, useEffect } from 'react';

/**
 * Détection synchrone d'un appareil mobile / tablette / tactile
 */
export function checkIsMobile() {
  if (typeof window === 'undefined') return false;

  // 1. Détection via User-Agent
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);

  // 2. Détection via les capacités tactiles & pointer
  const hasTouchScreen = (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0
  );

  const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // 3. Détection via largeur d'écran (smartphone ou petite tablette)
  const isSmallScreen = window.innerWidth <= 1024;

  return isMobileUA || (hasTouchScreen && (isCoarsePointer || isSmallScreen));
}

/**
 * Détection iOS (Safari iPhone / iPad) pour particularités WebKit plein écran
 */
export function checkIsIOS() {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Hook React pour réagir dynamiquement aux changements de taille / orientation mobile
 */
export function useDeviceType() {
  const [isMobile, setIsMobile] = useState(() => checkIsMobile());
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(checkIsMobile());
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return {
    isMobile,
    isLandscape,
    isIOS: checkIsIOS()
  };
}
