import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[role="switch"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const AXIS_DEADZONE = 0.45;
const INITIAL_REPEAT_DELAY = 320;
const REPEAT_INTERVAL = 115;

function isElementVisible(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function getActiveScopeRoot() {
  const scopes = Array.from(document.querySelectorAll('[data-gamepad-scope]')).filter(isElementVisible);
  if (scopes.length > 0) {
    // Choisir le scope au z-index le plus élevé (ou le dernier monté dans le DOM)
    let best = scopes[scopes.length - 1];
    let bestZ = Number(window.getComputedStyle(best).zIndex) || 0;
    for (const s of scopes) {
      const z = Number(window.getComputedStyle(s).zIndex) || 0;
      if (z >= bestZ) {
        best = s;
        bestZ = z;
      }
    }
    return best;
  }

  const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(isElementVisible);
  if (dialogs.length > 0) return dialogs[dialogs.length - 1];

  return document.body;
}

function getFocusableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isElementVisible);
}

function findNextElement(current, dir, elements) {
  if (!elements.length) return null;
  if (!current || !elements.includes(current)) {
    return elements.find((el) => el.hasAttribute('data-gamepad-autofocus')) || elements[0];
  }

  const curRect = current.getBoundingClientRect();
  const cx = curRect.left + curRect.width / 2;
  const cy = curRect.top + curRect.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const el of elements) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;

    const dx = ex - cx;
    const dy = ey - cy;

    let inDirection = false;
    let primary = 0;
    let secondary = 0;
    let overlapsPerp = false;

    if (dir === 'up') {
      inDirection = dy < -4;
      primary = -dy;
      secondary = Math.abs(dx);
      overlapsPerp = r.right > curRect.left && r.left < curRect.right;
    } else if (dir === 'down') {
      inDirection = dy > 4;
      primary = dy;
      secondary = Math.abs(dx);
      overlapsPerp = r.right > curRect.left && r.left < curRect.right;
    } else if (dir === 'left') {
      inDirection = dx < -4;
      primary = -dx;
      secondary = Math.abs(dy);
      overlapsPerp = r.bottom > curRect.top && r.top < curRect.bottom;
    } else if (dir === 'right') {
      inDirection = dx > 4;
      primary = dx;
      secondary = Math.abs(dy);
      overlapsPerp = r.bottom > curRect.top && r.top < curRect.bottom;
    }

    if (!inDirection) continue;

    // Privilégier les éléments alignés dans la même colonne/ligne
    const score = primary + secondary * (overlapsPerp ? 0.65 : 2.4);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

function findScrollableContainer(el, scopeRoot) {
  let cur = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 8) {
      return cur;
    }
    if (cur === scopeRoot) break;
    cur = cur.parentElement;
  }
  if (scopeRoot && scopeRoot !== document.body) {
    const inner = Array.from(scopeRoot.querySelectorAll('*')).find((node) => {
      const s = window.getComputedStyle(node);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 8;
    });
    if (inner) return inner;
  }
  return document.scrollingElement || document.documentElement;
}

function adjustRangeInput(input, deltaSign) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = Number(input.step || Math.max(1, (max - min) / 20));
  const cur = Number(input.value || 0);
  const next = Math.min(max, Math.max(min, cur + deltaSign * step));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(input, String(next));
  } else {
    input.value = String(next);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function triggerTabSwitch(scopeRoot, delta) {
  const localTabs = Array.from(scopeRoot.querySelectorAll('[data-gamepad-tab], [role="tab"]')).filter(isElementVisible);
  const tabs =
    localTabs.length > 1
      ? localTabs
      : Array.from(document.querySelectorAll('[data-gamepad-universe-tab]')).filter(isElementVisible);

  if (tabs.length < 2) return false;
  let activeIdx = tabs.findIndex(
    (t) => t.getAttribute('aria-selected') === 'true' || t.getAttribute('data-active') === 'true'
  );
  if (activeIdx < 0) activeIdx = 0;
  const nextIdx = (activeIdx + delta + tabs.length) % tabs.length;
  const nextTab = tabs[nextIdx];
  nextTab.click();
  nextTab.focus({ preventScroll: true });
  return true;
}

/**
 * Hook global de navigation manette 2D sur toute la plateforme.
 * Se met automatiquement en pause lorsqu'un jeu tourne au premier plan (sans overlay ouvert).
 */
export function useGamepadNavigation({ isGameplayActive = false } = {}) {
  const stateRef = useRef({ isGameplayActive });
  stateRef.current = { isGameplayActive };

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.getGamepads) return undefined;

    const clearGamepadClass = () => {
      document.documentElement.classList.remove('gamepad-nav-active');
    };
    window.addEventListener('pointerdown', clearGamepadClass, { passive: true });

    let rafId = 0;
    let lastDir = null;
    let dirPressedAt = 0;
    let lastRepeatAt = 0;
    const prevButtons = new Map();

    const readDirection = (pads) => {
      for (const p of pads) {
        if (!p) continue;
        const b = p.buttons || [];
        const axX = p.axes?.[0] ?? 0;
        const axY = p.axes?.[1] ?? 0;

        if (b[12]?.pressed || axY < -AXIS_DEADZONE) return 'up';
        if (b[13]?.pressed || axY > AXIS_DEADZONE) return 'down';
        if (b[14]?.pressed || axX < -AXIS_DEADZONE) return 'left';
        if (b[15]?.pressed || axX > AXIS_DEADZONE) return 'right';
      }
      return null;
    };

    const isBtnPressed = (pads, idx) => pads.some((p) => Boolean(p?.buttons?.[idx]?.pressed));

    const tick = () => {
      try {
        const pads = Array.from(navigator.getGamepads() || []).filter(Boolean);
        if (pads.length > 0) {
          const scopeRoot = getActiveScopeRoot();
          const hasExplicitOverlay =
            scopeRoot !== document.body ||
            Boolean(document.querySelector('[data-gamepad-scope], [role="dialog"][aria-modal="true"]'));

          // En jeu actif sans menu/modale ouvert, laisser 100 % des contrôles à l'émulateur
          const pausedForGame = stateRef.current.isGameplayActive && !hasExplicitOverlay;

          if (!pausedForGame) {
            const now = performance.now();
            const dir = readDirection(pads);

            if (dir) {
              document.documentElement.classList.add('gamepad-nav-active');
              const shouldTrigger =
                dir !== lastDir ||
                (now - dirPressedAt >= INITIAL_REPEAT_DELAY && now - lastRepeatAt >= REPEAT_INTERVAL);

              if (dir !== lastDir) {
                dirPressedAt = now;
              }

              if (shouldTrigger) {
                lastRepeatAt = now;
                const activeEl = document.activeElement;
                if (
                  activeEl?.tagName === 'INPUT' &&
                  activeEl.type === 'range' &&
                  (dir === 'left' || dir === 'right')
                ) {
                  adjustRangeInput(activeEl, dir === 'right' ? 1 : -1);
                } else {
                  const elements = getFocusableElements(scopeRoot);
                  const next = findNextElement(activeEl, dir, elements);
                  if (next) {
                    next.focus({ preventScroll: true });
                    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                  }
                }
              }
            } else {
              dirPressedAt = 0;
            }
            lastDir = dir;

            // Stick droit : scroll vertical fluide
            for (const p of pads) {
              const ry = p.axes?.[3] ?? 0;
              if (Math.abs(ry) > 0.35) {
                document.documentElement.classList.add('gamepad-nav-active');
                const scroller = findScrollableContainer(document.activeElement, scopeRoot);
                scroller?.scrollBy?.({ top: ry * 18 });
                break;
              }
            }

            // Boutons ponctuels (front montant)
            const checkEdge = (idx) => {
              const cur = isBtnPressed(pads, idx);
              const prev = Boolean(prevButtons.get(idx));
              prevButtons.set(idx, cur);
              return cur && !prev;
            };

            if (checkEdge(0)) {
              // A : Valider / Cliquer
              document.documentElement.classList.add('gamepad-nav-active');
              const activeEl = document.activeElement;
              if (activeEl && scopeRoot.contains(activeEl) && activeEl !== document.body) {
                activeEl.click();
              } else {
                const elements = getFocusableElements(scopeRoot);
                if (elements[0]) {
                  elements[0].focus({ preventScroll: true });
                }
              }
            }

            if (checkEdge(1)) {
              // B : Retour / Fermer la modale active
              document.documentElement.classList.add('gamepad-nav-active');
              const closeBtn = scopeRoot.querySelector('[data-gamepad-close]');
              if (closeBtn && isElementVisible(closeBtn)) {
                closeBtn.click();
              } else {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
              }
            }

            if (checkEdge(4)) {
              // LB / L1 : Onglet ou univers précédent
              document.documentElement.classList.add('gamepad-nav-active');
              triggerTabSwitch(scopeRoot, -1);
            }

            if (checkEdge(5)) {
              // RB / R1 : Onglet ou univers suivant
              document.documentElement.classList.add('gamepad-nav-active');
              triggerTabSwitch(scopeRoot, 1);
            }

            if (checkEdge(3)) {
              // Y : Focus rapide sur la recherche
              document.documentElement.classList.add('gamepad-nav-active');
              const searchEl =
                scopeRoot.querySelector('[data-gamepad-search]') || document.querySelector('[data-gamepad-search]');
              if (searchEl && isElementVisible(searchEl)) {
                searchEl.focus({ preventScroll: true });
                searchEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }
            }
          } else {
            lastDir = null;
            [0, 1, 3, 4, 5].forEach((idx) => prevButtons.set(idx, isBtnPressed(pads, idx)));
          }
        }
      } catch {
        /* noop */
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointerdown', clearGamepadClass);
    };
  }, []);
}
