import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, LayoutGrid, List, AlertOctagon, Terminal, Menu, UploadCloud, Check, HardDrive } from 'lucide-react';
import { GameCard } from './GameCard';
import { GameListItem } from './GameListItem';
import { romStorage } from '../../services/romStorage';

const VIEW_MODE_STORAGE_KEY = 'csw_arcade_view_mode';

export function GameLibrary({
  games,
  selectedGenre,
  isBiosReady,
  isRomAvailable,
  onLaunchSolo,
  onLaunchNetplay,
  onToggleMobileSidebar
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [importStatus, setImportStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleImportFiles = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setImportStatus('Stockage en cours...');
    let imported = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.toLowerCase().endsWith('.zip')) {
        try {
          const buf = await file.arrayBuffer();
          await romStorage.saveRom(file.name, buf);
          imported++;
        } catch(err) {
          console.error('[Import]', err);
        }
      }
    }

    setImportStatus(`${imported} ROM(s) stockée(s) !`);
    setTimeout(() => setImportStatus(null), 3500);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleToggleViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {}
  };

  // Filtrage combiné (Recherche textuelle + Catégorie + Disponibilité)
  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      // 1. Filtre par recherche textuelle
      const matchesSearch =
        game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        game.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
        game.genre.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      // 2. Filtre par catégorie
      if (selectedGenre === 'Tous les Jeux' || selectedGenre === 'Tous') return true;
      if (selectedGenre === 'Disponibles' || selectedGenre === 'Prêts') {
        return isRomAvailable(game.filename);
      }
      return game.genre.toLowerCase().includes(selectedGenre.toLowerCase());
    });
  }, [games, searchQuery, selectedGenre, isRomAvailable]);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-neutral-950 min-w-0">
      {/* Top Header Responsive avec recherche & bascule Grille / Liste */}
      <header className="p-3 sm:p-5 border-b border-neutral-800/80 bg-neutral-950/85 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
        
        {/* Titre & Hamburger Mobile */}
        <div className="flex items-center gap-3">
          {/* Bouton Hamburger Mobile (affiché sur écrans < 1024px) */}
          <button
            onClick={onToggleMobileSidebar}
            className="lg:hidden p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-cyan-500/50 active:scale-95 transition-all"
            title="Ouvrir le menu et les filtres"
            aria-label="Menu"
          >
            <Menu className="w-5 h-5 text-cyan-400" />
          </button>

          <div>
            <h2 className="text-sm sm:text-lg md:text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
              <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400 shrink-0" />
              <span className="hidden sm:inline">CATALOGUE NEO GEO MVS / AES</span>
              <span className="sm:hidden">NEO GEO ARCADE</span>
            </h2>
            <p className="text-[10px] sm:text-xs font-mono text-neutral-400 mt-0.5">
              <span className="font-bold text-cyan-400">{filteredGames.length}</span>{' '}
              <span className="hidden sm:inline">jeu{filteredGames.length > 1 ? 'x' : ''} répertorié{filteredGames.length > 1 ? 's' : ''}</span>
              <span className="sm:hidden">jeux</span>
              {selectedGenre && selectedGenre !== 'Tous les Jeux' && selectedGenre !== 'Tous' && (
                <span className="text-neutral-500"> • {selectedGenre}</span>
              )}
            </p>
          </div>
        </div>

        {/* Barre d'Outils Droite : Recherche & Sélecteur Grille / Liste */}
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          
          {/* Champ de Recherche Instantanée */}
          <div className="relative flex-1 min-w-0 sm:w-56 md:w-72 lg:w-80">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher (ex: kof, slug)..."
              className="w-full pl-9 pr-3 py-1.5 sm:py-2 bg-neutral-900/90 border border-neutral-800 rounded-xl text-xs font-mono text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-all"
            />
          </div>

          {/* Importateur de ROMs vers stockage local */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFiles}
            multiple
            accept=".zip"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Importer une ou plusieurs ROMs (.zip) dans le stockage local du navigateur"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-cyan-500/50 rounded-xl text-xs font-mono text-cyan-300 transition-all shrink-0 active:scale-95"
          >
            <UploadCloud className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="hidden md:inline font-semibold">Importer ROM</span>
          </button>

          {/* Toast / Notification Import */}
          {importStatus && (
            <div className="fixed bottom-5 right-5 z-50 px-4 py-2 rounded-xl bg-cyan-950/90 border border-cyan-500 text-cyan-200 text-xs font-mono shadow-2xl flex items-center gap-2 backdrop-blur-md animate-bounce">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{importStatus}</span>
            </div>
          )}

          {/* Bascule Grille / Liste */}
          <div className="flex items-center p-1 bg-neutral-900 rounded-xl border border-neutral-800 shrink-0">
            <button
              onClick={() => handleToggleViewMode('grid')}
              className={`p-1.5 sm:p-2 rounded-lg transition-all ${
                viewMode === 'grid'
                  ? 'bg-cyan-500 text-black shadow-sm font-bold'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              title="Affichage en Grille"
              aria-label="Affichage en Grille"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleToggleViewMode('list')}
              className={`p-1.5 sm:p-2 rounded-lg transition-all ${
                viewMode === 'list'
                  ? 'bg-cyan-500 text-black shadow-sm font-bold'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
              title="Affichage en Liste"
              aria-label="Affichage en Liste"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

        </div>
      </header>

      {/* Zone de Contenu Principale */}
      <main className="flex-1 overflow-y-auto p-2.5 sm:p-6 space-y-3.5 sm:space-y-6">
        
        {/* Alerte Critique BIOS Neo Geo */}
        {!isBiosReady && (
          <div className="p-3 sm:p-4 rounded-xl bg-gradient-to-r from-rose-950/60 to-red-950/40 border border-rose-500/40 flex items-start gap-3 sm:gap-4 text-xs font-mono">
            <AlertOctagon className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="min-w-0">
              <p className="font-bold text-rose-300 uppercase tracking-wider text-[11px] sm:text-xs">
                BIOS Critique : neogeo.zip requis
              </p>
              <p className="text-rose-200/80 mt-1 leading-relaxed text-[10px] sm:text-xs">
                Le core WebAssembly FBNeo nécessite{' '}
                <code className="bg-black/60 px-1 py-0.2 rounded text-cyan-300 font-bold">
                  neogeo.zip
                </code>{' '}
                pour démarrer les jeux Neo Geo.
              </p>
            </div>
          </div>
        )}

        {/* Affichage des Jeux (Grille OU Liste) */}
        {filteredGames.length > 0 ? (
          viewMode === 'grid' ? (
            /* Mode Grille (2 colonnes côte à côte sur mobile) */
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-4 md:gap-5">
              {filteredGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  isAvailable={isRomAvailable(game.filename)}
                  isBiosReady={isBiosReady}
                  onLaunchSolo={onLaunchSolo}
                  onLaunchNetplay={onLaunchNetplay}
                />
              ))}
            </div>
          ) : (
            /* Mode Liste dense et compact */
            <div className="flex flex-col gap-2 sm:gap-2.5 max-w-6xl mx-auto w-full">
              {filteredGames.map((game) => (
                <GameListItem
                  key={game.id}
                  game={game}
                  isAvailable={isRomAvailable(game.filename)}
                  isBiosReady={isBiosReady}
                  onLaunchSolo={onLaunchSolo}
                  onLaunchNetplay={onLaunchNetplay}
                />
              ))}
            </div>
          )
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-2xl">
            <Terminal className="w-10 h-10 text-neutral-600 mb-3" />
            <p className="text-sm font-mono text-neutral-300 font-bold">
              Aucun jeu ne correspond à votre recherche
            </p>
            <p className="text-xs font-mono text-neutral-500 mt-1">
              Essayez un autre mot-clé ou réinitialisez le filtre de catégorie
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
