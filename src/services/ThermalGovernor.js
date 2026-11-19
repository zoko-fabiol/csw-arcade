import { PERFORMANCE_PROFILES, PROFILE_ORDER } from '../utils/performanceProfile';

const FRAME_BUDGET_MS = 1000 / 59.18;
const OVERLOAD_RATIO = 1.15;     // intervalle moyen > 115 % du budget = images perdues (throttling)
const DOWNGRADE_AFTER_MS = 5000;
const UPGRADE_AFTER_MS = 60000;  // hystérésis
const LOW_BATTERY = 0.2;

/**
 * Surveille la charge (temps de rafale, Compute Pressure API, batterie)
 * et ajuste dynamiquement le profil de performance actif.
 *
 * Usage :
 *   thermalGovernor.start('balanced');
 *   thermalGovernor.subscribe(profile => applyProfile(profile));
 *   // à chaque image : thermalGovernor.reportFrame(durationMs)
 */
class ThermalGovernor {
  constructor() {
    this.ceilingId = 'balanced';  // profil maximum autorisé (choix utilisateur / auto)
    this.currentId = 'balanced';
    this.listeners = new Set();
    this.avgFrameMs = 0;
    this.overloadSince = 0;
    this.stableSince = 0;
    this.pressure = 'nominal';
    this.batteryLow = false;
    this.observer = null;
    this.running = false;
  }

  get profile() {
    return PERFORMANCE_PROFILES[this.currentId];
  }

  get stats() {
    return {
      profile: this.currentId,
      avgFrameMs: this.avgFrameMs,
      pressure: this.pressure,
      batteryLow: this.batteryLow
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start(ceilingId = 'balanced') {
    this.ceilingId = PERFORMANCE_PROFILES[ceilingId] ? ceilingId : 'balanced';
    this.currentId = this.ceilingId;
    this.avgFrameMs = 0;
    this.overloadSince = 0;
    this.stableSince = performance.now();
    this.running = true;

    // Compute Pressure API (Chrome 125+)
    if ('PressureObserver' in window && !this.observer) {
      try {
        this.observer = new window.PressureObserver((records) => {
          this.pressure = records[records.length - 1]?.state || 'nominal';
          if (this.pressure === 'critical') this._step(-1, 'pression CPU critique');
        });
        await this.observer.observe('cpu', { sampleInterval: 2000 });
      } catch {
        this.observer = null;
      }
    }

    // Batterie
    try {
      const battery = await navigator.getBattery?.();
      if (battery) {
        const check = () => {
          this.batteryLow = !battery.charging && battery.level < LOW_BATTERY;
          if (this.batteryLow) this._setProfile('eco', 'batterie faible');
        };
        battery.addEventListener('levelchange', check);
        battery.addEventListener('chargingchange', check);
        check();
      }
    } catch { /* API non disponible */ }

    this._emit('démarrage');
  }

  stop() {
    this.running = false;
    try { this.observer?.disconnect(); } catch { /* noop */ }
    this.observer = null;
  }

  /**
   * À appeler une fois par image avec l'intervalle écoulé depuis l'image précédente (ms).
   */
  reportFrame(durationMs) {
    if (!this.running) return;
    // Moyenne mobile exponentielle (~1 s)
    this.avgFrameMs = this.avgFrameMs ? this.avgFrameMs * 0.98 + durationMs * 0.02 : durationMs;
    const now = performance.now();

    if (this.avgFrameMs > FRAME_BUDGET_MS * OVERLOAD_RATIO) {
      this.stableSince = 0;
      if (!this.overloadSince) this.overloadSince = now;
      else if (now - this.overloadSince > DOWNGRADE_AFTER_MS) {
        this.overloadSince = 0;
        this._step(-1, 'budget image dépassé');
      }
    } else {
      this.overloadSince = 0;
      if (!this.stableSince) this.stableSince = now;
      else if (now - this.stableSince > UPGRADE_AFTER_MS) {
        this.stableSince = now;
        if (!this.batteryLow && this.pressure !== 'serious' && this.pressure !== 'critical') {
          this._step(+1, 'stable');
        }
      }
    }
  }

  _step(dir, reason) {
    const idx = PROFILE_ORDER.indexOf(this.currentId);
    const max = PROFILE_ORDER.indexOf(this.ceilingId);
    const next = Math.max(0, Math.min(max, idx + dir));
    this._setProfile(PROFILE_ORDER[next], reason);
  }

  _setProfile(id, reason) {
    if (id === this.currentId) return;
    this.currentId = id;
    this._emit(reason);
  }

  _emit(reason) {
    const profile = this.profile;
    this.listeners.forEach((fn) => {
      try { fn(profile, reason); } catch (e) { console.error('[ThermalGovernor]', e); }
    });
  }
}

export const thermalGovernor = new ThermalGovernor();
