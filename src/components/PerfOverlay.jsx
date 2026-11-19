import { useEffect, useRef } from 'react';
import { thermalGovernor } from '../services/ThermalGovernor';

/**
 * Overlay FPS / temps image / profil / pression.
 * Mesure le FPS réel via requestAnimationFrame et met à jour le DOM
 * 2 fois par seconde, sans re-render React.
 */
export default function PerfOverlay({ visible = true, extraStats }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    let frames = 0;
    let last = performance.now();
    let rafId;

    const tick = (now) => {
      frames++;
      if (now - last >= 500) {
        const fps = (frames * 1000) / (now - last);
        frames = 0;
        last = now;
        const s = thermalGovernor.stats;
        const extra = typeof extraStats === 'function' ? extraStats() : null;
        if (ref.current) {
          ref.current.textContent =
            `FPS ${fps.toFixed(0)} | image ${s.avgFrameMs.toFixed(1)} ms | ${s.profile}` +
            ` | CPU ${s.pressure}${s.batteryLow ? ' | 🔋bas' : ''}` +
            (extra ? ` | ${Object.entries(extra).map(([k, v]) => `${k} ${v}`).join(' | ')}` : '');
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [visible, extraStats]);

  if (!visible) return null;
  return (
    <div
      ref={ref}
      className="fixed top-1 left-1 z-[9999] pointer-events-none px-2 py-0.5 rounded bg-black/70 text-[10px] font-mono text-lime-400"
    />
  );
}
