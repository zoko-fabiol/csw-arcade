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
import {
  downloadAndCacheRom,
  formatBytes,
  getCachedRom,
  listCachedRoms,
  markRomAsDead,
  probeRomAvailability,
  removeCachedRom,
  searchOnlineRoms,
  subscribeDeadRoms,
} from '../../services/platformRomService';
import { addCoins } from '../../services/walletService';
import { GameCover } from './GameCover';

const PAGE_SIZE = 48;

const XBOX_CATALOG = [];
const PC_DOS_CATALOG = [];

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
      if (!mapped || seenRom.has(mapped)) return false;
      seenRom.add(mapped);
      return true;
    })
    .map((g) => {
      const rawKey = String(g.filename || g.rom || g.id || '').replace(/\.zip$/i, '').toLowerCase();
      const mapped = fbneoMapping[rawKey] || rawKey;
      const fn = `${mapped}.zip`;
      const encoded = encodeURIComponent(fn);
      return {
        id: `arc-neo-${mapped}`,
        title: g.title || g.name,
        platform: 'fbneo',
        platformLabel: 'Neo Geo MVS',
        core: 'fbneo',
        year: g.year || null,
        genre: g.genre || 'Neo Geo Arcade',
        players: '1–2J',
        estimatedSize: g.size || 'Auto',
        filename: fn,
        imageUrl: g.coverUrl || null,
        urls: [
          `/api/rom-proxy?file=${encoded}`,
          `https://archive.org/cors/neo-geo-mvs-romset/${encoded}`,
          `/api/rom-proxy?url=${encodeURIComponent(`https://archive.org/download/neo-geo-mvs-romset/${encoded}`)}`,
          `https://archive.org/download/neo-geo-mvs-romset/${encoded}`,
        ],
        description: g.description || 'ROM Neo Geo MVS — Lancement direct FBNeo.',
      };
    });
  return {
    neogeo: [...neoFromJson, ...extraNeo],
    mame: Array.isArray(arcJson?.mame) ? arcJson.mame : [],
    retro64_32: Array.isArray(arcJson?.retro64_32) ? arcJson.retro64_32 : [],
  };
}

export function PlatformCatalogView({ mode, onLaunchStage, onCacheChanged, onJoinChannel, onRequireCoin }) {
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
    setErrorMsg('');
    refreshCache();

    let cancelled = false;
    async function loadCatalog() {
      if (mode === 'all') {
        const base = [...PLAYSTATION_CATALOG, ...SEGA_CATALOG, ...NINTENDO_CATALOG, ...XBOX_CATALOG, ...PC_DOS_CATALOG];
        setCatalog(base);
        try {
          const [arcRes, extRes, javaRes] = await Promise.all([
            fetch('./app/data/arcade-catalog.json'),
            fetch('./app/data/extended-catalogs.json'),
            fetch('./app/data/java-catalog.json'),
          ]);
          const arcJson = arcRes.ok ? await arcRes.json() : {};
          const extJson = extRes.ok ? await extRes.json() : {};
          const javaJson = javaRes.ok ? await javaRes.json() : [];
          const arc = buildMergedArcade(arcJson);
          if (!cancelled) {
            setCatalog([
              ...arc.neogeo,
              ...arc.mame,
              ...arc.retro64_32,
              ...(Array.isArray(extJson.segaMD) ? extJson.segaMD : []),
              ...base,
              ...(Array.isArray(javaJson) ? javaJson : []),
            ]);
          }
        } catch {
          /* keep base */
        }
      } else if (mode === 'arcade') {
        const base64_32 = NINTENDO_CATALOG.filter((g) => g.platform === 'n64' || g.platform === 'gba');
        setCatalog(base64_32);
        try {
          const res = await fetch('./app/data/arcade-catalog.json');
          if (res.ok && !cancelled) {
            const arc = buildMergedArcade(await res.json());
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
        setCatalog(SEGA_CATALOG);
        try {
          const res = await fetch('./app/data/extended-catalogs.json');
          if (res.ok && !cancelled) {
            const json = await res.json();
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
        setCatalog([]);
        try {
          const res = await fetch('./app/data/java-catalog.json');
          if (res.ok && !cancelled) {
            const json = await res.json();
            if (Array.isArray(json)) setCatalog(json);
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

  const cachedIds = useMemo(() => new Set(cachedRoms.map((c) => c.id)), [cachedRoms]);

  const liveCatalog = useMemo(
    () => catalog.filter((item) => item && Array.isArray(item.urls) && item.urls.length > 0 && !deadRomIds.has(item.id)),
    [catalog, deadRomIds]
  );

  const filteredCatalog = useMemo(() => {
    if (activeFilter === 'local') return [];
    const q = search.trim().toLowerCase();
    return liveCatalog.filter((item) => {
      if (activeFilter !== 'all' && item.core !== activeFilter && item.platform !== activeFilter) return false;
      if (!q) return true;
      return `${item.title || ''} ${item.platformLabel || ''} ${item.genre || ''} ${item.filename || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [liveCatalog, activeFilter, search]);

  const filteredCached = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cachedRoms.filter(
      (item) => !q || `${item.title || ''} ${item.filename || ''} ${item.core || ''}`.toLowerCase().includes(q)
    );
  }, [cachedRoms, search]);

  const launchFile = (file, coreOverride, titleOverride) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const resolvedCore = coreOverride || (ext === 'jar' ? 'j2me' : RETRO_EXT_CORE_MAP[ext] || cfg.defaultCore);
    onLaunchStage({
      kind: resolvedCore === 'j2me' || mode === 'java' ? 'j2me' : 'emu',
      title: titleOverride || file.name,
      filename: file.name,
      badge: `${resolvedCore.toUpperCase()} · ${resolvedCore === 'j2me' ? 'J2ME' : 'EmulatorJS'}`,
      core: resolvedCore,
      fileBlob: file,
      accent: cfg.accent,
    });
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
      launchFile(file, core, entry.title);
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
    if (onRequireCoin && !onRequireCoin()) return;
    const cached = await getCachedRom(item.id);
    if (!cached?.data) {
      refreshCache();
      return;
    }
    const f = new File([cached.data], cached.filename || item.filename, { type: 'application/octet-stream' });
    launchFile(f, item.core || cfg.defaultCore, item.title);
  };

  const handleOnlineSearch = async (e) => {
    e.preventDefault();
    if (!onlineQuery.trim()) return;
    setOnlineSearching(true);
    setErrorMsg('');
    try {
      const targetSys = activeFilter !== 'all' && activeFilter !== 'local' ? activeFilter : cfg.defaultCore;
      const res = await searchOnlineRoms(onlineQuery, { system: targetSys, limit: 12 });
      setOnlineResults(res);
      if (!res.length) setErrorMsg(`Aucune ROM trouvée en ligne pour « ${onlineQuery} ».`);
    } catch (err) {
      setErrorMsg(`Erreur recherche Archive.org : ${err.message}`);
    } finally {
      setOnlineSearching(false);
    }
  };

  const visibleItems = filteredCatalog.slice(0, visibleLimit);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Sidebar Filtres */}
      <aside
        className={`${
          mobileSidebarOpen ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden'
        } md:static md:flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/70 p-3 overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-2 md:hidden">
          <span className="text-xs font-bold uppercase text-neutral-400">Filtres</span>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="p-1 rounded bg-neutral-800 text-neutral-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 px-2 mb-2">
          Catégories
        </div>
        <div className="space-y-1">
          {cfg.filters.map((f) => {
            const count =
              f.id === 'all'
                ? liveCatalog.length
                : f.id === 'local'
                  ? cachedRoms.length
                  : liveCatalog.filter((g) => g.core === f.id || g.platform === f.id).length;
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setActiveFilter(f.id);
                  setVisibleLimit(PAGE_SIZE);
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-neutral-300 hover:bg-neutral-800/70 border border-transparent'
                }`}
              >
                <span className="truncate">{f.label}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-950 text-neutral-400">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Contenu Principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* En-tête Vue */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-neutral-800 bg-neutral-900/40">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-2 rounded-lg bg-neutral-800 text-neutral-200"
              aria-label="Filtres"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-sm font-black tracking-wide text-white">{cfg.title}</h2>
              <p className="text-[11px] font-mono text-neutral-400">
                {liveCatalog.length} jeux vérifiés · {cachedRoms.length} en cache IndexedDB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisibleLimit(PAGE_SIZE);
                }}
                placeholder={cfg.searchPlaceholder}
                className="pl-8 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500 w-56"
              />
            </div>

            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
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

            <div className="flex rounded-lg border border-neutral-800 bg-neutral-900 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-400'}`}
                title="Grille"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-cyan-500/20 text-cyan-300' : 'text-neutral-400'}`}
                title="Liste"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Corps scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Barre Recherche Archive.org */}
          <form onSubmit={handleOnlineSearch} className="flex gap-2 flex-wrap">
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
            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                Résultats Archive.org ({onlineResults.length})
              </h3>
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2'}>
                {onlineResults.map((item) => {
                  const ext = item.filename?.split('.').pop()?.toLowerCase() || '';
                  const guessedCore = RETRO_EXT_CORE_MAP[ext] || cfg.defaultCore;
                  const isBusy = downloadingId === item.id;
                  return (
                    <article
                      key={item.id}
                      className={`rounded-xl bg-neutral-900/90 border border-neutral-800 hover:border-cyan-500/50 p-3 flex gap-3 transition-colors ${
                        viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between'
                      }`}
                    >
                      <GameCover title={item.title} platformLabel={guessedCore.toUpperCase()} filename={item.filename} compact={viewMode === 'list'} />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-white truncate">{item.title}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 shrink-0">
                            {guessedCore.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 truncate">
                          {item.filename} · {item.size ? formatBytes(item.size) : 'Auto'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(downloadingId)}
                        onClick={() => handleLaunchCatalogEntry({ ...item, core: guessedCore })}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black text-xs font-bold flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{isBusy ? downloadProgress : 'Télécharger & Jouer'}</span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* ROMs en cache IndexedDB */}
          {(activeFilter === 'local' || activeFilter === 'all') && filteredCached.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  En cache IndexedDB ({filteredCached.length})
                </h3>
              </div>
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2'}>
                {filteredCached.map((item) => {
                  const matchedEntry = catalog.find((c) => c.id === item.id || c.filename === item.filename);
                  const displayTitle = matchedEntry?.title || item.title;
                  return (
                  <article
                    key={item.id}
                    className={`rounded-xl bg-neutral-900/90 border border-emerald-500/30 p-3 flex gap-3 ${
                      viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between'
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
                      <div className="font-bold text-sm text-white truncate">{displayTitle}</div>
                      <div className="text-[11px] font-mono text-neutral-400 truncate">
                        {item.filename} · {formatBytes(item.size)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLaunchCached(item)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold flex items-center gap-1"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Lancer</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await removeCachedRom(item.id);
                          refreshCache();
                        }}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 text-neutral-400 hover:text-rose-300"
                        title="Supprimer du cache"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Catalogue vérifié ({filteredCatalog.length} jeux)
                </h3>
                {mode === 'arcade' && (
                  <span className="text-[11px] font-mono text-neutral-500">
                    {RETRO_SYSTEMS.length} cœurs EmulatorJS supportés
                  </span>
                )}
              </div>

              {filteredCatalog.length === 0 ? (
                <div className="p-8 rounded-xl bg-neutral-900/50 border border-neutral-800 text-center text-xs text-neutral-500">
                  Aucun jeu ne correspond à votre filtre.
                </div>
              ) : (
                <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'space-y-2'}>
                  {visibleItems.map((entry, idx) => {
                    const isCached = cachedIds.has(entry.id);
                    const isBusy = downloadingId === entry.id;
                    const isFocused = focusedIdx === idx;
                    return (
                      <article
                        key={entry.id}
                        onMouseEnter={() => setFocusedIdx(idx)}
                        className={`rounded-xl bg-neutral-900/90 border p-3 flex gap-3 transition-all ${
                          isFocused
                            ? 'border-cyan-400 shadow-lg shadow-cyan-500/15'
                            : 'border-neutral-800 hover:border-cyan-500/50'
                        } ${viewMode === 'grid' ? 'flex-col' : 'flex-row items-center justify-between'}`}
                      >
                        <GameCover
                          title={entry.title}
                          platformLabel={entry.platformLabel}
                          filename={entry.filename}
                          imageUrl={entry.imageUrl || entry.coverUrl}
                          compact={viewMode === 'list'}
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-white truncate">{entry.title}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shrink-0">
                              {entry.platformLabel}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-neutral-400 truncate">
                            {[entry.year, entry.genre, entry.estimatedSize].filter(Boolean).join(' · ')}
                          </div>
                          {viewMode === 'grid' && entry.description && (
                            <p className="text-[11px] text-neutral-400 line-clamp-2">{entry.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={Boolean(downloadingId)}
                            onClick={() => handleLaunchCatalogEntry(entry)}
                            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                              isCached
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                                : 'bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black'
                            }`}
                          >
                            {isCached ? <Play className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                            <span>{isBusy ? downloadProgress : isCached ? 'Jouer' : 'Jouer Local'}</span>
                          </button>
                          {onJoinChannel && (
                            <button
                              type="button"
                              onClick={() => onJoinChannel(entry)}
                              title="Rejoindre le salon Fightcade 2"
                              className="px-2.5 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/35 border border-purple-500/40 text-purple-200 text-xs font-bold flex items-center gap-1 transition-colors"
                            >
                              <Swords className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Salon</span>
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
                    className="px-5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-200 transition-colors"
                  >
                    Afficher plus ({filteredCatalog.length - visibleLimit} restants)
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Barre d'actions rapides Game Mode (Clavier / Manette) */}
        <footer className="px-4 py-1.5 bg-neutral-900/90 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-neutral-400 shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span><strong className="text-emerald-400">[A / Entrée]</strong> Jouer Local (1 Coin)</span>
            <span><strong className="text-purple-400">[X]</strong> Rejoindre Salon En Ligne</span>
            <span><strong className="text-amber-400">[Y]</strong> Acheter / Insérer Coin</span>
            <span><strong className="text-neutral-300">[Tab]</strong> Quick Menu</span>
          </div>
          <span className="hidden sm:inline text-neutral-500">Game Mode · Clavier, Souris &amp; Manette</span>
        </footer>
      </div>
    </div>
  );
}
