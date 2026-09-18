import React, { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, AlertOctagon, Terminal } from 'lucide-react';
import { GameCard } from './GameCard';

export function GameLibrary({
  games,
  selectedGenre,
  isBiosReady,
  isRomAvailable,
  onLaunchSolo,
  onLaunchNetplay
}) {
  const [searchQuery, setSearchQuery] = useState('');

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
      if (selectedGenre === 'Tous les Jeux') return true;
      if (selectedGenre === 'Disponibles') {
        return isRomAvailable(game.filename);
      }
      return game.genre.toLowerCase().includes(selectedGenre.toLowerCase());
    });
  }, [games, searchQuery, selectedGenre, isRomAvailable]);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-neutral-950">
      {/* Top Header & Recherche */}
      <header className="p-6 border-b border-neutral-800/80 bg-neutral-950/70 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold font-mono tracking-tight text-white flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400" />
            CATALOGUE NEO GEO MVS / AES
          </h2>
          <p className="text-xs font-mono text-neutral-400 mt-0.5">
            {filteredGames.length} jeu{filteredGames.length > 1 ? 'x' : ''} répertorié{filteredGames.length > 1 ? 's' : ''} dans la sélection
          </p>
        </div>

        {/* Barre de Recherche Instantanée */}
        <div className="relative w-72 md:w-96">
          <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par titre, rom (ex: mslug)..."
            className="w-full pl-10 pr-4 py-2 bg-neutral-900/90 border border-neutral-800 rounded-xl text-xs font-mono text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-all"
          />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Alerte Critique BIOS Neo Geo */}
        {!isBiosReady && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-rose-950/60 to-red-950/40 border border-rose-500/40 flex items-start gap-4 text-xs font-mono">
            <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
            <div>
              <p className="font-bold text-rose-300 uppercase tracking-wider">
                BIOS Critique Manquant : neogeo.zip requis
              </p>
              <p className="text-rose-200/80 mt-1 leading-relaxed">
                Le core WebAssembly FinalBurn Neo exige le fichier BIOS universel{' '}
                <code className="bg-black/60 px-1.5 py-0.5 rounded text-cyan-300 font-bold">
                  public/roms/neogeo.zip
                </code>{' '}
                pour initialiser l'architecture Motorola 68000 / Zilog Z80. Placez ce fichier pour débloquer les lancements.
              </p>
            </div>
          </div>
        )}

        {/* Grille des Jeux */}
        {filteredGames.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
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
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-2xl">
            <Terminal className="w-10 h-10 text-neutral-600 mb-3" />
            <p className="text-sm font-mono text-neutral-300 font-bold">
              Aucun jeu ne correspond à vos filtres
            </p>
            <p className="text-xs text-neutral-500 font-mono mt-1">
              Essayez une autre recherche ou sélectionnez "Tous les Jeux" dans le menu de gauche.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
