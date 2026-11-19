import { checkIsMobile } from './deviceDetector';

/**
 * Profils de performance : chaque niveau définit les plafonds de rendu,
 * rollback, streaming et audio pour éviter la surchauffe.
 */
export const PERFORMANCE_PROFILES = {
  eco: {
    id: 'eco',
    label: 'Éco',
    renderScale: 2,
    scanlines: false,
    maxRollbackFrames: 4,
    maxShaderTier: 1,
    stream: { width: 640, height: 448, fps: 30, maxBitrate: 600_000 },
    audioSampleRate: 22050
  },
  balanced: {
    id: 'balanced',
    label: 'Équilibré',
    renderScale: 3,
    scanlines: true,
    maxRollbackFrames: 7,
    maxShaderTier: 2,
    stream: { width: 960, height: 672, fps: 30, maxBitrate: 1_000_000 },
    audioSampleRate: 44100
  },
  performance: {
    id: 'performance',
    label: 'Performance',
    renderScale: 4,
    scanlines: true,
    maxRollbackFrames: 10,
    maxShaderTier: 3,
    stream: { width: 960, height: 672, fps: 60, maxBitrate: 1_500_000 },
    audioSampleRate: 48000
  }
};

export const SHADER_PRESETS = [
  {
    id: 'none',
    label: 'Original (Pixels Bruts)',
    shortName: 'Original',
    tier: 1,
    desc: 'Pixel art arcade authentique 320×224 sans retouche. Vitesse maximale, chauffe zéro.',
    badge: '100% Fluide',
    cost: 'Très Faible'
  },
  {
    id: '2xScaleHQ.glslp',
    label: 'HD Lissé Doux',
    shortName: 'HD Doux',
    tier: 1,
    desc: 'Filtre ScaleHQ 2x : adoucit les arêtes des personnages sans dénaturer le style rétro.',
    badge: 'Recommandé',
    cost: 'Léger'
  },
  {
    id: '4xScaleHQ.glslp',
    label: 'Ultra HD Cartouche',
    shortName: 'Ultra HD',
    tier: 2,
    desc: 'Interpolation vectorielle 4xHQ haute résolution : rendu type dessin animé haute définition.',
    badge: 'Haute Qualité',
    cost: 'Moyen'
  },
  {
    id: 'crt-easymode.glslp',
    label: 'Borne Arcade CRT',
    shortName: 'Arcade CRT',
    tier: 2,
    desc: 'Émulation tube cathodique réaliste avec masque de phosphore RVB et lignes de balayage.',
    badge: 'Authentique 90s',
    cost: 'Moyen'
  },
  {
    id: 'crt-geom.glslp',
    label: 'CRT 3D Incurvé',
    shortName: 'Cathodique 3D',
    tier: 3,
    desc: 'Simulation 3D poussée : vitre d\'arcade incurvée, réfraction et brillance de tube cathodique.',
    badge: 'Immersion Ultime',
    cost: 'Élevé'
  }
];

/**
 * Valide et ajuste le shader demandé en fonction du profil de performance et du mode stream
 */
export function sanitizeShaderForProfile(requestedShader, profile, isStreamMode = false) {
  if (isStreamMode) return 'none';
  const target = requestedShader || 'none';
  const preset = SHADER_PRESETS.find(p => p.id === target) || SHADER_PRESETS[0];
  const maxTier = profile?.maxShaderTier ?? 2;
  if (preset.tier > maxTier) {
    // Rétrograde vers le meilleur shader autorisé
    const allowed = SHADER_PRESETS.filter(p => p.tier <= maxTier);
    return allowed[allowed.length - 1]?.id || 'none';
  }
  return target;
}

export const PROFILE_ORDER = ['eco', 'balanced', 'performance'];

function detectGpuRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '');
  } catch {
    return '';
  }
}

/**
 * Collecte des capacités matérielles disponibles côté navigateur.
 */
export function detectCapabilities() {
  if (typeof window === 'undefined') {
    return { cores: 4, memoryGb: 4, isMobile: false, gpu: '', lowEndGpu: false };
  }
  const gpu = detectGpuRenderer();
  return {
    cores: navigator.hardwareConcurrency || 4,
    memoryGb: navigator.deviceMemory || 4,
    isMobile: checkIsMobile(),
    gpu,
    lowEndGpu: /swiftshader|llvmpipe|mali-4|mali-t|adreno \(tm\) [1-5]\d\d|powervr|intel.*hd graphics [2-5]/i.test(gpu)
  };
}

/**
 * Choisit un profil de départ à partir des capacités détectées.
 * @returns {'eco'|'balanced'|'performance'}
 */
export function recommendProfile(caps = detectCapabilities()) {
  if (caps.lowEndGpu || caps.cores <= 2 || caps.memoryGb <= 2) return 'eco';
  if (caps.isMobile) return caps.cores >= 8 && caps.memoryGb >= 6 ? 'balanced' : 'eco';
  if (caps.cores >= 8 && caps.memoryGb >= 8) return 'performance';
  return 'balanced';
}

export function resolveProfile(mode) {
  const id = mode === 'auto' || !PERFORMANCE_PROFILES[mode] ? recommendProfile() : mode;
  return PERFORMANCE_PROFILES[id];
}
