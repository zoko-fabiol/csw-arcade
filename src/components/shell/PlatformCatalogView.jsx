import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, Grid, List, Upload, Globe, Database, Play, Download, Trash2, Menu, X, Swords
} from 'lucide-react';
import {
  NINTENDO_CATALOG,
  PLAYSTATION_CATALOG,
  RETRO_EXT_CORE_MAP,
  RETRO_SYSTEMS,
  SEGA_CATALOG,
} from '../../data/platformCatalogs';
import neoGeoGames from '../../data/games.json';
import fbneoMapping from '../../data/fbneoMapping.json';
import neoragexVerified from '../../data/neoragexVerified.json';
import {
  downloadAndCacheRom,
  formatBytes,
  getCachedRom,
  listCachedRoms,
  markRomAsDead,
  padNeoRAGExZipFile,
  probeRomAvailability,
  removeCachedRom,
  searchOnlineRoms,
  subscribeDeadRoms,
} from '../../services/platformRomService';

const NEO_GEO_SHORTNAME_SET = new Set(
  Object.values(fbneoMapping || {}).map((v) => String(v || '').toLowerCase()).filter(Boolean)
);
const NATIVE_NEORAGEX_SET = new Set(
  (neoragexVerified?.nativeFbneo || []).map((v) => String(v || '').toLowerCase())
);
const PLAYABLE_EXTRAS_SET = new Set(
  (neoragexVerified?.playableExtras || []).map((v) => String(v || '').toLowerCase())
);
import { addCoins } from '../../services/walletService';
import { GameCover } from './GameCover';
import { getMultiplayerBadgeMeta, supportsOnlineMultiplayer } from '../../utils/gameCapabilities';

const PAGE_SIZE = 48;

const XBOX_CATALOG = [];
const PC_DOS_CATALOG = [];

const CATALOG_JSON_CACHE = new Map();
const CATALOG_INFLIGHT_CACHE = new Map();

async function fetchCachedCatalogJson(url) {
  if (CATALOG_JSON_CACHE.has(url)) return CATALOG_JSON_CACHE.get(url);
  if (CATALOG_INFLIGHT_CACHE.has(url)) return CATALOG_INFLIGHT_CACHE.get(url);
  const p = fetch(url)
    .then(async (res) => {
      if (!res.ok) return null;
      const json = await res.json();
      if (json) CATALOG_JSON_CACHE.set(url, json);
      return json;
    })
    .catch(() => null)
    .finally(() => {
      CATALOG_INFLIGHT_CACHE.delete(url);
    });
  CATALOG_INFLIGHT_CACHE.set(url, p);
  return p;
}

const MODE_CONFIG = {
  all: {
    title: 'TOUS LES JEUX — GAME MODE',
    accent: '#00f0ff',
    cacheMode: null,
    defaultCore: 'mame2003_plus',
    accept: '.zip,.chd,.pbp,.bin,.iso,.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.md,.sms,.gg,.jar',
    extractExts: ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.md', '.sms', '.gg', '.jar'],
    searchPlaceholder: 'Filtrer parmi tous les univers…',
    onlinePlaceholder: 'Rechercher n’importe quelle ROM sur Archive.org…',
    filters: [
      { id: 'all', label: 'Tous les univers' },
      { id: 'multiplayer', label: 'Multijoueur en ligne' },
      { id: 'fbneo', label: 'Neo Geo MVS' },
      { id: 'mame2003_plus', label: 'MAME 2003-Plus' },
      { id: 'ps1', label: 'PlayStation' },
      { id: 'segaMD', label: 'Sega Mega Drive' },
      { id: 'snes', label: 'Super Nintendo' },
      { id: 'n64', label: 'Nintendo 64' },
      { id: 'j2me', label: 'Java / Gameloft J2ME' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  arcade: {
    title: 'ARCADE & CONSOLES RÉTRO',
    accent: '#00f0ff',
    cacheMode: 'retro',
    defaultCore: 'mame2003_plus',
    accept: '.zip,.nes,.sfc,.smc,.gba,.gb,.gbc,.n64,.z64,.v64,.md,.gen,.bin,.sms,.gg,.pce,.nds',
    extractExts: ['.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc', '.n64', '.z64', '.v64', '.md', '.gen', '.sms', '.gg', '.pce', '.nds'],
    searchPlaceholder: 'Filtrer Neo Geo, MAME, N64, GBA…',
    onlinePlaceholder: 'Rechercher une ROM Arcade / MAME / Console sur Archive.org…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'multiplayer', label: 'Multijoueur en ligne' },
      { id: 'fbneo', label: 'Neo Geo MVS (Auto-DL)' },
      { id: 'mame2003_plus', label: 'MAME 2003-Plus (32/16-bit)' },
      { id: 'n64', label: 'Nintendo 64 (64-bit)' },
      { id: 'gba', label: 'GBA (32-bit)' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  playstation: {
    title: 'UNIVERS PLAYSTATION',
    accent: '#3b82f6',
    cacheMode: 'playstation',
    defaultCore: 'psx',
    accept: '.chd,.pbp,.bin,.img,.iso,.zip',
    extractExts: ['.chd', '.pbp', '.bin', '.img', '.iso'],
    searchPlaceholder: 'Filtrer le catalogue PlayStation…',
    onlinePlaceholder: 'Rechercher un jeu PS1 sur Archive.org (ex: Tekken, Crash)…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'multiplayer', label: 'Multijoueur en ligne' },
      { id: 'ps1', label: 'PlayStation (PS1)' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  sega: {
    title: 'UNIVERS SEGA',
    accent: '#0ea5e9',
    cacheMode: 'sega',
    defaultCore: 'segaMD',
    accept: '.md,.gen,.bin,.sms,.gg,.zip',
    extractExts: ['.md', '.gen', '.bin', '.sms', '.gg'],
    searchPlaceholder: 'Filtrer le catalogue Sega…',
    onlinePlaceholder: 'Rechercher un jeu Sega sur Archive.org (ex: Sonic, Aladdin)…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'multiplayer', label: 'Multijoueur en ligne' },
      { id: 'segaMD', label: 'Mega Drive / Genesis' },
      { id: 'segaMS', label: 'Master System' },
      { id: 'segaGG', label: 'Game Gear' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  nintendo: {
    title: 'UNIVERS NINTENDO',
    accent: '#ef4444',
    cacheMode: 'nintendo',
    defaultCore: 'snes',
    accept: '.nes,.sfc,.smc,.gb,.gbc,.gba,.n64,.z64,.v64,.nds,.zip',
    extractExts: ['.nes', '.sfc', '.smc', '.gb', '.gbc', '.gba', '.n64', '.z64', '.v64', '.nds'],
    searchPlaceholder: 'Filtrer le catalogue Nintendo…',
    onlinePlaceholder: 'Rechercher un jeu Nintendo sur Archive.org (ex: Mario, Zelda)…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'multiplayer', label: 'Multijoueur en ligne' },
      { id: 'nes', label: 'NES' },
      { id: 'snes', label: 'Super Nintendo (SNES)' },
      { id: 'n64', label: 'Nintendo 64' },
      { id: 'gba', label: 'Game Boy Advance' },
      { id: 'gbc', label: 'Game Boy Color' },
      { id: 'gb', label: 'Game Boy' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  java: {
    title: 'JAVA / GAMELOFT J2ME',
    accent: '#f59e0b',
    cacheMode: 'java',
    defaultCore: 'j2me',
    accept: '.jar,.zip',
    extractExts: ['.jar'],
    searchPlaceholder: 'Filtrer les jeux Java / Gameloft…',
    onlinePlaceholder: 'Rechercher un jeu J2ME (.jar) sur Archive.org…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  xbox: {
    title: 'UNIVERS XBOX',
    accent: '#22c55e',
    cacheMode: 'xbox',
    defaultCore: 'xbox',
    accept: '.iso,.xiso,.zip',
    extractExts: [],
    searchPlaceholder: 'Filtrer le catalogue Xbox…',
    onlinePlaceholder: 'Rechercher un jeu Xbox sur Archive.org…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
  pc: {
    title: 'PC / MS-DOS & LAB',
    accent: '#a855f7',
    cacheMode: 'pc',
    defaultCore: 'dos',
    accept: '.exe,.com,.bat,.jsdos,.zip',
    extractExts: [],
    searchPlaceholder: 'Filtrer les jeux PC / MS-DOS…',
    onlinePlaceholder: 'Rechercher un jeu MS-DOS sur Archive.org…',
    filters: [
      { id: 'all', label: 'Tout le catalogue' },
      { id: 'local', label: 'En cache IndexedDB' },
    ],
  },
};

function buildMergedArcade(arcJson) {
  const neoFromJson = Array.isArray(arcJson?.neogeo) ? arcJson.neogeo : [];
  const seenRom = new Set(neoFromJson.map((g) => String(g.filename || g.id).replace(/\.zip$/i, '').toLowerCase()));
  const extraNeo = (Array.isArray(neoGeoGames) ? neoGeoGames : [])
    .filter((g) => {
      const rawKey = String(g.filename || g.rom || g.id || '').replace(/\.zip$/i, '').toLowerCase();
      const mapped = fbneoMapping[rawKey] || rawKey;
      if (!mapped || seenRom.has(mapped) || !PLAYABLE_EXTRAS_SET.has(mapped)) return false;
      seenRom.add(mapped);
      return true;
    })
    .map((g) => {
      const rawKey = String(g.filename || g.rom || g.id || '').replace(/\.zip$/i, '').toLowerCase();
      const mapped = fbneoMapping[rawKey] || rawKey;
      const fn = `${mapped}.zip`;
      const encoded = encodeURIComponent(fn);
      const supportsMulti =
        typeof g.supportsMultiplayer === 'boolean'
          ? g.supportsMultiplayer
          : Number(g.players || 2) >= 2;
      const playersLabel = supportsMulti
        ? Number(g.players) > 2
          ? `1–${g.players}J`
          : '1–2J'
        : '1J';
      return {
        id: `arc-neo-${mapped}`,
        title: g.title || g.name,
        platform: 'fbneo',
        platformLabel: 'Neo Geo MVS',
        core: 'fbneo',
        year: g.year || null,
        genre: g.genre || 'Neo Geo Arcade',
        players: playersLabel,
        supportsMultiplayer: supportsMulti,
        estimatedSize: g.size || 'Auto',
        filename: fn,
        imageUrl: g.coverUrl || null,
        urls: [
          `/api/rom-proxy?file=${encoded}`,
          `https://archive.org/cors/neo-geo-mvs-romset/${encoded}`,
          `/api/rom-proxy?url=${encodeURIComponent(`https://archive.org/download/neo-geo-mvs-romset/${encoded}`)}`,
          `https://archive.org/download/neo-geo-mvs-romset/${encoded}`,
        ],
        description:
          g.description ||
          (supportsMulti ? 'ROM Neo Geo MVS — Lancement direct FBNeo.' : 'ROM Neo Geo MVS (Mode Solo).'),
      };
    });
  return {
    neogeo: [...neoFromJson, ...extraNeo],
    mame: Array.isArray(arcJson?.mame) ? arcJson.mame : [],
    retro64_32: Array.isArray(arcJson?.retro64_32) ? arcJson.retro64_32 : [],
  };
}

export function PlatformCatalogView({ mode, onLaunchStage, onCacheChanged, onJoinChannel, onRequireCoin, onCatalogLoaded }) {
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.arcade;

  const [catalog, setCatalog] = useState([]);
  const [cachedRoms, setCachedRoms] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState([]);
  const [onlineSearching, setOnlineSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileOnlineMode, setMobileOnlineMode] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [deadRomIds, setDeadRomIds] = useState(() => new Set());

  useEffect(() => subscribeDeadRoms(setDeadRomIds), []);

  const refreshCache = async () => {
    const rows = await listCachedRoms(cfg.cacheMode);
    setCachedRoms(rows);
    onCacheChanged?.();
  };

  useEffect(() => {
    setActiveFilter('all');
    setSearch('');
    setVisibleLimit(PAGE_SIZE);
    setOnlineResults([]);
    setMobileOnlineMode(false);
    setErrorMsg('');
    refreshCache();

    let cancelled = false;
    async function loadCatalog() {
      if (mode === 'all') {
        const base = [...PLAYSTATION_CATALOG, ...SEGA_CATALOG, ...NINTENDO_CATALOG, ...XBOX_CATALOG, ...PC_DOS_CATALOG];
        const hasCachedAll =
          CATALOG_JSON_CACHE.has('./app/data/arcade-catalog.json') &&
          CATALOG_JSON_CACHE.has('./app/data/extended-catalogs.json') &&
          CATALOG_JSON_CACHE.has('./app/data/java-catalog.json');
        if (!hasCachedAll) setCatalog(base);
        try {
          const [arcJson, extJson, javaJson] = await Promise.all([
            fetchCachedCatalogJson('./app/data/arcade-catalog.json'),
            fetchCachedCatalogJson('./app/data/extended-catalogs.json'),
            fetchCachedCatalogJson('./app/data/java-catalog.json'),
          ]);
          const arc = buildMergedArcade(arcJson || {});
          if (!cancelled) {
            setCatalog([
              ...arc.neogeo,
              ...arc.mame,
              ...arc.retro64_32,
              ...(Array.isArray(extJson?.segaMD) ? extJson.segaMD : []),
              ...base,
              ...(Array.isArray(javaJson) ? javaJson : []),
            ]);
          }
        } catch {
          /* keep base */
        }
      } else if (mode === 'arcade') {
        const base64_32 = NINTENDO_CATALOG.filter((g) => g.platform === 'n64' || g.platform === 'gba');
        if (!CATALOG_JSON_CACHE.has('./app/data/arcade-catalog.json')) {
          setCatalog(base64_32);
        }
        try {
          const json = await fetchCachedCatalogJson('./app/data/arcade-catalog.json');
          if (json && !cancelled) {
            const arc = buildMergedArcade(json);
            setCatalog([
              ...arc.neogeo,
              ...arc.mame,
              ...arc.retro64_32,
              ...base64_32,
            ]);
          }
        } catch {
          /* keep base */
        }
      } else if (mode === 'playstation') {
        setCatalog(PLAYSTATION_CATALOG);
      } else if (mode === 'sega') {
        if (!CATALOG_JSON_CACHE.has('./app/data/extended-catalogs.json')) {
          setCatalog(SEGA_CATALOG);
        }
        try {
          const json = await fetchCachedCatalogJson('./app/data/extended-catalogs.json');
          if (json && !cancelled) {
            if (Array.isArray(json?.segaMD)) {
              const baseTitles = new Set(SEGA_CATALOG.map((g) => g.title.toLowerCase()));
              setCatalog([...SEGA_CATALOG, ...json.segaMD.filter((g) => !baseTitles.has(g.title.toLowerCase()))]);
            }
          }
        } catch {
          /* keep base */
        }
      } else if (mode === 'nintendo') {
        setCatalog(NINTENDO_CATALOG);
      } else if (mode === 'xbox') {
        setCatalog(XBOX_CATALOG);
      } else if (mode === 'pc') {
        setCatalog(PC_DOS_CATALOG);
      } else if (mode === 'java') {
        if (!CATALOG_JSON_CACHE.has('./app/data/java-catalog.json')) {
          setCatalog([]);
        }
        try {
          const json = await fetchCachedCatalogJson('./app/data/java-catalog.json');
          if (Array.isArray(json) && !cancelled) {
            setCatalog(json);
          }
        } catch {
          /* keep empty */
        }
      }
    }
    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (catalog.length > 0) {
      onCatalogLoaded?.(catalog);
    }
  }, [catalog, onCatalogLoaded]);

  const cachedIds = useMemo(() => new Set(cachedRoms.map((c) => c.id)), [cachedRoms]);

  const liveCatalog = useMemo(
    () => catalog.filter((item) => item && Array.isArray(item.urls) && item.urls.length > 0 && !deadRomIds.has(item.id)),
    [catalog, deadRomIds]
  );

  const filteredCatalog = useMemo(() => {
    if (activeFilter === 'local') return [];
    const q = search.trim().toLowerCase();
    return liveCatalog.filter((item) => {
      if (activeFilter === 'multiplayer') {
        if (!supportsOnlineMultiplayer(item, { mode })) return false;
      } else if (activeFilter !== 'all' && item.core !== activeFilter && item.platform !== activeFilter) {
        return false;
      }
      if (!q) return true;
      return `${item.title || ''} ${item.platformLabel || ''} ${item.genre || ''} ${item.filename || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [liveCatalog, activeFilter, search, mode]);

  const filteredCached = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cachedRoms.filter(
      (item) => !q || `${item.title || ''} ${item.filename || ''} ${item.core || ''}`.toLowerCase().includes(q)
    );
  }, [cachedRoms, search]);

  const launchFile = async (file, coreOverride, titleOverride, entryOverride = null) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const rawZipKey = ext === 'zip' ? file.name.replace(/\.zip$/i, '').toLowerCase() : '';
    const mappedNeoKey = rawZipKey ? fbneoMapping[rawZipKey] || '' : '';
    const isKnownNeoZip =
      Boolean(mappedNeoKey) ||
      (rawZipKey &&
        (NEO_GEO_SHORTNAME_SET.has(rawZipKey) ||
          catalog.some(
            (g) => g.core === 'fbneo' && String(g.filename || '').replace(/\.zip$/i, '').toLowerCase() === rawZipKey
          )));
    const resolvedCore =
      coreOverride ||
      (ext === 'jar' ? 'j2me' : isKnownNeoZip ? 'fbneo' : RETRO_EXT_CORE_MAP[ext] || cfg.defaultCore);
    const resolvedFilename =
      entryOverride?.filename ||
      (isKnownNeoZip ? `${mappedNeoKey || rawZipKey}.zip` : file.name);
    const matchedNeoMeta =
      !entryOverride && isKnownNeoZip
        ? (Array.isArray(neoGeoGames)
            ? neoGeoGames.find(
                (g) =>
                  String(g.id || '').toLowerCase() === rawZipKey ||
                  String(g.filename || '').replace(/\.zip$/i, '').toLowerCase() === rawZipKey
              )
            : null)
        : null;

    let finalBlob = file;
    if (!entryOverride && isKnownNeoZip) {
      if (neoragexVerified?.padFixable?.[rawZipKey]) {
        try {
          setDownloadingId('local-import');
          setDownloadProgress('Adaptation NeoRAGEx…');
          finalBlob = await padNeoRAGExZipFile(file, neoragexVerified.padFixable[rawZipKey], resolvedFilename);
        } catch {
          finalBlob = file;
        } finally {
          setDownloadingId(null);
          setDownloadProgress('');
        }
      } else if (!NATIVE_NEORAGEX_SET.has(rawZipKey)) {
        // Les dumps décryptés NeoRAGEx dont les CRC diffèrent de FBNeo (ex: metalslug1, metalslug3, kof98)
        // basculent automatiquement sur le romset FBNeo vérifié via /api/rom-proxy?source=fbneo si disponible.
        try {
          setDownloadingId('local-import');
          setDownloadProgress('Synchronisation FBNeo…');
          const res = await fetch(`/api/rom-proxy?file=${encodeURIComponent(resolvedFilename)}&source=fbneo`);
          if (res.ok) {
            const ab = await res.arrayBuffer();
            const u8 = new Uint8Array(ab);
            if (u8.byteLength > 4096 && u8[0] === 0x50 && u8[1] === 0x4b) {
              finalBlob = new File([ab], resolvedFilename, { type: 'application/octet-stream' });
            }
          }
        } catch {
          /* conserve le fichier importé si hors-ligne */
        } finally {
          setDownloadingId(null);
          setDownloadProgress('');
        }
      }
    }

    const isLocalImport = !entryOverride;
    const isJ2me = resolvedCore === 'j2me' || mode === 'java' || ext === 'jar';
    const canMulti =
      !isLocalImport &&
      !isJ2me &&
      supportsOnlineMultiplayer(entryOverride, { core: resolvedCore, mode });
    onLaunchStage(
      {
        kind: isJ2me ? 'j2me' : 'emu',
        gameId: entryOverride?.id || (isKnownNeoZip ? `arc-neo-${mappedNeoKey || rawZipKey}` : titleOverride || file.name),
        title: entryOverride?.title || matchedNeoMeta?.title || titleOverride || file.name,
        filename: resolvedFilename,
        badge: `${resolvedCore.toUpperCase()} · ${isJ2me ? 'J2ME' : 'EmulatorJS'}`,
        core: resolvedCore,
        fileBlob: finalBlob,
        gameUrl: entryOverride?.urls?.[0] || (isKnownNeoZip ? `/api/rom-proxy?file=${encodeURIComponent(resolvedFilename)}` : ''),
        isLocalImport,
        players: entryOverride?.players || (canMulti ? '1–2J' : '1J'),
        supportsMultiplayer: canMulti,
        accent: cfg.accent,
      },
      entryOverride
    );
  };

  const handleLaunchCatalogEntry = async (entry) => {
    if (onRequireCoin && !onRequireCoin()) return;
    if (!entry.urls?.length) {
      setErrorMsg(`Ce titre (${entry.title}) nécessite une image locale : cliquez sur « Importer ROM ».`);
      return;
    }
    const core = entry.core || entry.platform || cfg.defaultCore;
    const isArcadeZip = core === 'fbneo' || core === 'mame2003_plus';
    setErrorMsg('');
    setDownloadingId(entry.id);
    setDownloadProgress('Préparation…');
    try {
      const file = await downloadAndCacheRom(entry, {
        mode: cfg.cacheMode,
        core,
        extractExtensions: isArcadeZip ? [] : cfg.extractExts,
        onProgress: ({ received, total }) => {
          if (total > 0) {
            const pct = Math.min(100, Math.round((received / total) * 100));
            setDownloadProgress(`${pct}% (${formatBytes(received)})`);
          } else {
            setDownloadProgress(formatBytes(received));
          }
        },
      });
      await refreshCache();
      launchFile(file, core, entry.title, entry);
    } catch (err) {
      markRomAsDead(entry.id);
      addCoins(1);
      setErrorMsg(`ROM indisponible (« ${entry.title} ») : retirée automatiquement de la liste (1 Coin remboursé).`);
    } finally {
      setDownloadingId(null);
      setDownloadProgress('');
    }
  };

  const handleLaunchCached = async (item) => {
    const matchedEntry =
      catalog.find((c) => c.id === item.id || (item.filename && c.filename === item.filename)) || null;
    const cached = await getCachedRom(item.id);
    if (!cached?.data) {
      await refreshCache();
      if (matchedEntry?.urls?.length) {
        return handleLaunchCatalogEntry(matchedEntry);
      }
      setErrorMsg(`ROM en cache invalide ou expirée (« ${item.title} ») : veuillez la retélécharger.`);
      return;
    }
    if (onRequireCoin && !onRequireCoin()) return;
    const resolvedCore = matchedEntry?.core || matchedEntry?.platform || item.core || cfg.defaultCore;
    const resolvedEntry = matchedEntry || {
      id: item.id,
      title: item.title,
      filename: cached.filename || item.filename,
      core: resolvedCore,
      platform: item.platform || resolvedCore,
      players: item.players || null,
      supportsMultiplayer:
        typeof item.supportsMultiplayer === 'boolean' ? item.supportsMultiplayer : undefined,
    };
    const f = new File([cached.data], cached.filename || item.filename, { type: 'application/octet-stream' });
    launchFile(f, resolvedCore, matchedEntry?.title || item.title, resolvedEntry);
  };

  const handleOnlineSearch = async (e) => {
    e.preventDefault();
    if (!onlineQuery.trim()) return;
    setOnlineSearching(true);
    setErrorMsg('');
    try {
      const targetSys =
        activeFilter !== 'all' && activeFilter !== 'local' && activeFilter !== 'multiplayer'
          ? activeFilter
          : cfg.defaultCore;
      const res = await searchOnlineRoms(onlineQuery, { system: targetSys, limit: 12 });
      setOnlineResults(res);
      if (!res.length) setErrorMsg(`Aucune ROM trouvée en ligne pour « ${onlineQuery} ».`);
    } catch (err) {
      setErrorMsg(`Erreur recherche Archive.org : ${err.message}`);
    } finally {
      setOnlineSearching(false);
    }
  };

  // Déduplication intelligente des filtres :
  // - Cache tout filtre qui duplique 100% de l'univers déjà sélectionné (ex: "PlayStation (PS1)" dans l'onglet PlayStation)
  // - Cache les sous-catégories vides (0 jeu)
  // - En mode "all" sur mobile, évite les doublons avec la barre d'univers déjà visible en haut
  const dedupedFilters = useMemo(() => {
    const total = liveCatalog.length;
    return cfg.filters
      .map((f) => {
        const count =
          f.id === 'all'
            ? total
            : f.id === 'local'
              ? cachedRoms.length
              : f.id === 'multiplayer'
                ? liveCatalog.filter((g) => supportsOnlineMultiplayer(g, { mode })).length
                : liveCatalog.filter((g) => g.core === f.id || g.platform === f.id).length;
        return { ...f, count };
      })
      .filter((f) => {
        if (f.id === 'all') return true;
        if (f.id === 'local') return f.count > 0;
        if (f.count === 0) return false;
        // Doublon exact de la catégorie "Tout le catalogue" (ex: PS1 dans PlayStation) -> caché
        if (total > 0 && f.count === total) return false;
        return true;
      });
  }, [cfg.filters, liveCatalog, cachedRoms.length, mode]);

  // Sur mobile, quand on est dans "Tous les jeux", la barre d'univers en haut propose déjà PlayStation/Sega/Nintendo/Java :
  // on cache donc ces doublons de la barre de sous-filtres mobile !
  const TOP_BAR_DUPLICATES_IN_ALL = new Set(['ps1', 'segaMD', 'snes', 'n64', 'j2me']);
  const mobileSubFilters = useMemo(() => {
    const list =
      mode === 'all'
        ? dedupedFilters.filter((f) => !TOP_BAR_DUPLICATES_IN_ALL.has(f.id))
        : dedupedFilters;
    return list.length > 1 ? list : [];
  }, [dedupedFilters, mode]);

  const showDesktopSidebar = dedupedFilters.length > 1;
  const visibleItems = filteredCatalog.slice(0, visibleLimit);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Sidebar Filtres — Desktop uniquement, masquée automatiquement s'il n'y a aucune sous-catégorie utile */}
      {showDesktopSidebar && (
        <aside className="hidden md:flex w-60 lg:w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/70 p-3 overflow-y-auto">
          <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 px-2 mb-2">
            Catégories
          </div>
          <div className="space-y-1">
            {dedupedFilters.map((f) => {
              const active = activeFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setActiveFilter(f.id);
                    setVisibleLimit(PAGE_SIZE);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                      : 'text-neutral-300 hover:bg-neutral-800/70 border border-transparent'
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-950 text-neutral-400">
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Contenu Principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* En-tête Vue — Compact, lisible, zéro troncature */}
        <div className="px-3 md:px-4 py-2 md:py-3 border-b border-white/10 bg-neutral-900/50 backdrop-blur-md space-y-2 shrink-0">
          <div className="flex items-start md:items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xs sm:text-sm font-black tracking-wide text-white">{cfg.title}</h2>
                {mode === 'arcade' && (
                  <span className="px-1.5 py-0.5 rounded-md bg-cyan-950/80 border border-cyan-500/30 text-[10px] font-mono text-cyan-300 shrink-0">
                    {RETRO_SYSTEMS.length} cœurs
                  </span>
                )}
              </div>
              <p className="text-[11px] font-mono text-neutral-300 mt-0.5 tabular-nums">
                {liveCatalog.length} jeux vérifiés{cachedRoms.length > 0 ? ` · ${cachedRoms.length} en cache` : ''}
              </p>
            </div>

            {/* Actions à droite */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Champ recherche local (Desktop md+) */}
              <div className="relative hidden md:block">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setVisibleLimit(PAGE_SIZE);
                  }}
                  placeholder={cfg.searchPlaceholder}
                  className="arcade-focus-ring pl-8 pr-3 py-1.5 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-400 focus:border-cyan-400 w-56"
                />
              </div>

              <label
                className="arcade-focus-ring hidden md:flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-white/10 text-xs font-semibold text-neutral-100 cursor-pointer transition-colors"
                title="Importer une ROM locale"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>Importer ROM</span>
                <input
                  type="file"
                  accept={cfg.accept}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) launchFile(file, null, file.name);
                    e.target.value = '';
                  }}
                />
              </label>

              <div className="flex rounded-xl border border-white/10 bg-neutral-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Vue grille"
                  aria-pressed={viewMode === 'grid'}
                  className={`arcade-focus-ring p-1.5 min-w-[32px] min-h-[32px] rounded-lg flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-400 hover:text-white'}`}
                  title="Grille"
                >
                  <Grid className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Vue liste"
                  aria-pressed={viewMode === 'list'}
                  className={`arcade-focus-ring p-1.5 min-w-[32px] min-h-[32px] rounded-lg flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-400 hover:text-white'}`}
                  title="Liste"
                >
                  <List className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Barre de recherche + Web + Importer ROM UNIFIÉE Mobile (< md) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mobileOnlineMode) {
                handleOnlineSearch(e);
              }
            }}
            className="flex md:hidden items-center gap-1.5"
          >
            <div className="relative flex-1 min-w-0">
              {mobileOnlineMode ? (
                <Globe className="w-4 h-4 text-cyan-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              ) : (
                <Search className="w-4 h-4 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              )}
              <input
                type="search"
                value={mobileOnlineMode ? onlineQuery : search}
                onChange={(e) => {
                  if (mobileOnlineMode) {
                    setOnlineQuery(e.target.value);
                  } else {
                    setSearch(e.target.value);
                    setVisibleLimit(PAGE_SIZE);
                  }
                }}
                placeholder={mobileOnlineMode ? 'Chercher Archive.org…' : 'Filtrer le catalogue…'}
                className="arcade-focus-ring w-full pl-8 pr-2.5 py-1.5 min-h-[38px] rounded-xl bg-neutral-900 border border-white/10 text-base text-white placeholder:text-neutral-400 focus:border-cyan-400"
              />
            </div>
            <button
              type="button"
              onClick={() => setMobileOnlineMode((v) => !v)}
              title={mobileOnlineMode ? 'Revenir au filtre local' : 'Basculer sur la recherche Archive.org'}
              className={`arcade-focus-ring px-2.5 py-1.5 min-h-[38px] rounded-xl border text-xs font-bold shrink-0 flex items-center gap-1 transition-colors ${
                mobileOnlineMode
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-neutral-900 border-white/10 text-neutral-300'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Web</span>
            </button>
            {mobileOnlineMode ? (
              <button
                type="submit"
                disabled={onlineSearching}
                className="arcade-focus-ring px-3 py-1.5 min-h-[38px] rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black shrink-0"
              >
                {onlineSearching ? '…' : 'OK'}
              </button>
            ) : (
              <label
                className="arcade-focus-ring flex items-center gap-1 px-2.5 py-1.5 min-h-[38px] rounded-xl bg-neutral-800/90 hover:bg-neutral-700 border border-white/10 text-xs font-semibold text-neutral-100 cursor-pointer shrink-0"
                title="Importer une ROM locale"
              >
                <Upload className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>ROM</span>
                <input
                  type="file"
                  accept={cfg.accept}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) launchFile(file, null, file.name);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </form>

          {/* Toutes les Catégories Mobile (< md) avec compteurs — Sans perte d'information */}
          {dedupedFilters.length > 1 && (
            <div className="flex md:hidden items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {dedupedFilters.map((f) => {
                const active = activeFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setActiveFilter(f.id);
                      setVisibleLimit(PAGE_SIZE);
                    }}
                    className={`arcade-focus-ring px-3 py-1.5 min-h-[34px] rounded-full text-xs font-bold shrink-0 border transition-colors tabular-nums ${
                      active
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-neutral-900 border-white/10 text-neutral-300'
                    }`}
                  >
                    {f.label} <span className="opacity-75 font-mono">({f.count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Corps scrollable (avec marge basse mobile pour la Bottom Navigation Bar) */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 pb-20 md:pb-4 space-y-4 md:space-y-5">
          {/* Barre Recherche Archive.org — Desktop uniquement (fusionnée dans la barre unique sur mobile) */}
          <form onSubmit={handleOnlineSearch} className="hidden md:flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Globe className="w-4 h-4 text-cyan-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={onlineQuery}
                onChange={(e) => setOnlineQuery(e.target.value)}
                placeholder={cfg.onlinePlaceholder}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              type="submit"
              disabled={onlineSearching}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-xs font-bold transition-colors"
            >
              {onlineSearching ? 'Recherche…' : 'Rechercher en ligne'}
            </button>
          </form>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Résultats en ligne */}
          {onlineResults.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                Résultats Archive.org ({onlineResults.length})
              </h3>
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2.5'}>
                {onlineResults.map((item) => {
                  const ext = item.filename?.split('.').pop()?.toLowerCase() || '';
                  const guessedCore = RETRO_EXT_CORE_MAP[ext] || cfg.defaultCore;
                  const isBusy = downloadingId === item.id;
                  return (
                    <article
                      key={item.id}
                      className={`arcade-surface-elevated rounded-2xl border border-white/10 hover:border-cyan-400/60 p-3 flex gap-3 transition-all ${
                        viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between flex-wrap sm:flex-nowrap'
                      }`}
                    >
                      <GameCover title={item.title} platformLabel={guessedCore.toUpperCase()} filename={item.filename} compact={viewMode === 'list'} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-sm text-white line-clamp-2 leading-snug">{item.title}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/30 shrink-0">
                            {guessedCore.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-neutral-300 truncate tabular-nums">
                          {item.filename} · {item.size ? formatBytes(item.size) : 'Auto'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(downloadingId)}
                        onClick={() => handleLaunchCatalogEntry({ ...item, core: guessedCore, supportsMultiplayer: false })}
                        className="arcade-focus-ring px-3 py-2 min-h-[40px] rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 transition-all active:scale-[0.98]"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{isBusy ? downloadProgress : 'Jouer'}</span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* ROMs en cache IndexedDB */}
          {(activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Prêts hors-ligne ({filteredCached.length})
                </h3>
              </div>
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2.5'}>
                {filteredCached.map((item) => {
                  const matchedEntry = catalog.find((c) => c.id === item.id || c.filename === item.filename);
                  const displayTitle = matchedEntry?.title || item.title;
                  const cachedBadge = getMultiplayerBadgeMeta(matchedEntry || item, { mode });
                  return (
                    <article
                      key={item.id}
                      className={`arcade-surface-elevated rounded-2xl border border-emerald-500/30 hover:border-emerald-400/60 p-3 flex gap-3 transition-all ${
                        viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between flex-wrap sm:flex-nowrap'
                      }`}
                    >
                      <GameCover
                        title={displayTitle}
                        platformLabel={(item.core || item.platform || mode).toUpperCase()}
                        filename={item.filename}
                        imageUrl={matchedEntry?.imageUrl || matchedEntry?.coverUrl}
                        compact={viewMode === 'list'}
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-sm text-white line-clamp-2 leading-snug">{displayTitle}</div>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                              cachedBadge.isMultiplayer
                                ? 'bg-purple-950/80 text-purple-200 border-purple-500/40'
                                : 'bg-neutral-900 text-neutral-400 border-white/10'
                            }`}
                          >
                            {cachedBadge.shortLabel}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-neutral-300 truncate tabular-nums">
                          {item.filename} · {formatBytes(item.size)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleLaunchCached(item)}
                          className="arcade-focus-ring flex-1 px-3 py-2 min-h-[40px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                        >
                          <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Lancer</span>
                        </button>
                        {onJoinChannel && matchedEntry && cachedBadge.isMultiplayer && (
                          <button
                            type="button"
                            onClick={() => onJoinChannel(matchedEntry)}
                            title="Rejoindre le salon Fightcade 2"
                            className="arcade-focus-ring px-3 py-2 min-h-[40px] rounded-xl bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                          >
                            <Swords className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>Salon</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            await removeCachedRom(item.id);
                            refreshCache();
                          }}
                          aria-label={`Supprimer ${displayTitle} du cache`}
                          className="arcade-focus-ring p-2 min-w-[40px] min-h-[40px] rounded-xl bg-neutral-800 hover:bg-rose-950 border border-white/10 text-neutral-300 hover:text-rose-300 flex items-center justify-center transition-colors"
                          title="Supprimer du cache"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Catalogue principal */}
          {activeFilter !== 'local' && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                  Catalogue ({filteredCatalog.length})
                </h3>
                {mode === 'arcade' && (
                  <span className="text-[11px] font-mono text-neutral-400">
                    {RETRO_SYSTEMS.length} cœurs EmulatorJS supportés
                  </span>
                )}
              </div>

              {filteredCatalog.length === 0 ? (
                <div className="p-8 rounded-2xl bg-neutral-900/50 border border-white/10 text-center text-xs text-neutral-400">
                  Aucun jeu ne correspond à votre filtre.
                </div>
              ) : (
                <div className={viewMode === 'grid' ? 'grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2.5'}>
                  {visibleItems.map((entry, idx) => {
                    const isCached = cachedIds.has(entry.id);
                    const isBusy = downloadingId === entry.id;
                    const isFocused = focusedIdx === idx;
                    const showPlatformBadge = mode === 'all' || mode === 'arcade' || mode === 'nintendo' || mode === 'sega';
                    const badgeMeta = getMultiplayerBadgeMeta(entry, { mode });
                    return (
                      <article
                        key={entry.id}
                        onMouseEnter={() => setFocusedIdx(idx)}
                        className={`arcade-surface-elevated rounded-2xl border p-3 flex gap-3 transition-all ${
                          isFocused
                            ? 'border-cyan-400 shadow-lg shadow-cyan-500/15'
                            : 'border-white/10 hover:border-cyan-400/50'
                        } ${viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between flex-wrap sm:flex-nowrap'}`}
                      >
                        <GameCover
                          title={entry.title}
                          platformLabel={entry.platformLabel}
                          filename={entry.filename}
                          imageUrl={entry.imageUrl || entry.coverUrl}
                          compact={viewMode === 'list'}
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-sm text-white line-clamp-2 leading-snug">
                              {entry.title}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                title={badgeMeta.detailLabel}
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                                  badgeMeta.isMultiplayer
                                    ? 'bg-purple-950/80 text-purple-200 border-purple-500/40'
                                    : 'bg-neutral-900 text-neutral-400 border-white/10'
                                }`}
                              >
                                {badgeMeta.shortLabel}
                              </span>
                              {showPlatformBadge && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/30 shrink-0">
                                  {entry.platformLabel}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] font-mono text-neutral-300 truncate">
                            {showPlatformBadge
                              ? [entry.platformLabel, entry.year, entry.genre].filter(Boolean).join(' · ')
                              : [entry.year, entry.genre].filter(Boolean).join(' · ')}
                          </div>
                          {viewMode === 'grid' && entry.description && (
                            <p className="line-clamp-2 text-xs text-neutral-400 leading-relaxed">{entry.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          <button
                            type="button"
                            disabled={Boolean(downloadingId)}
                            onClick={() => handleLaunchCatalogEntry(entry)}
                            className={`arcade-focus-ring flex-1 px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${
                              isCached
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                                : 'bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black'
                            }`}
                          >
                            {isCached ? <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                            <span className="truncate">{isBusy ? downloadProgress : 'Jouer'}</span>
                          </button>
                          {onJoinChannel && badgeMeta.isMultiplayer && (
                            <button
                              type="button"
                              onClick={() => onJoinChannel(entry)}
                              title="Rejoindre le salon Fightcade 2"
                              className="arcade-focus-ring px-3 py-2 min-h-[40px] rounded-xl bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                            >
                              <Swords className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Salon</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {filteredCatalog.length > visibleLimit && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((v) => v + PAGE_SIZE)}
                    className="arcade-focus-ring px-5 py-2.5 min-h-[42px] rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-white/10 text-xs font-bold text-neutral-100 transition-colors"
                  >
                    Afficher plus ({filteredCatalog.length - visibleLimit} restants)
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Barre d'actions rapides Game Mode — Visible sur tous écrans (compacte & scrollable sur mobile) */}
        <footer className="flex px-3 md:px-4 py-1.5 bg-neutral-900/95 border-t border-white/10 items-center justify-between gap-3 text-[11px] font-mono text-neutral-300 shrink-0 overflow-x-auto no-scrollbar pb-16 md:pb-1.5">
          <div className="flex items-center gap-3 shrink-0">
            <span><strong className="text-emerald-400">[A / Entrée]</strong> Jouer Local (1 Coin)</span>
            {mode !== 'java' && (!visibleItems[focusedIdx] || supportsOnlineMultiplayer(visibleItems[focusedIdx], { mode })) && (
              <span><strong className="text-purple-400">[X]</strong> Rejoindre Salon En Ligne</span>
            )}
            <span><strong className="text-amber-400">[Y]</strong> Acheter / Insérer Coin</span>
            <span><strong className="text-neutral-200">[Tab]</strong> Quick Menu</span>
          </div>
          <span className="text-neutral-400 shrink-0">Game Mode · Clavier, Tactile &amp; Manette</span>
        </footer>
      </div>
    </div>
  );
}
