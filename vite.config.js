import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { setupNetplayHub } from './src/server/netplayHub.js';

// Plugin pour streamer les ROMs en flux mémoire sans déclencher les gestionnaires de téléchargement externes (IDM)
function romStreamPlugin() {
  const mappingPath = path.resolve(__dirname, 'src/data/fbneoMapping.json');
  let nameMap = {};
  try {
    if (fs.existsSync(mappingPath)) {
      nameMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
  } catch(e) {}

  return {
    name: 'rom-stream-middleware',
    configureServer(server) {
      const romsDir = path.resolve(__dirname, 'public/roms');
      if (!fs.existsSync(romsDir)) fs.mkdirSync(romsDir, { recursive: true });

      const handleRomRequest = async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost:3003');
          const rawParam = url.searchParams.get('file') || url.searchParams.get('id') || req.url.replace(/^\//, '');
          const cleanName = path.basename(decodeURIComponent(rawParam)).replace(/\.(zip|bin|dat|rom)$/i, '').toLowerCase();

          // Resolution via mapping table ou nom direct
          const resolvedName = nameMap[cleanName] || cleanName;

          // 1. Vérifier si la ROM existe déjà dans public/roms/
          let filePath = path.resolve(romsDir, resolvedName + '.zip');
          if (!fs.existsSync(filePath)) {
            const fallbackPath = path.resolve(romsDir, cleanName + '.zip');
            if (fs.existsSync(fallbackPath)) {
              filePath = fallbackPath;
            }
          }

          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Allow-Headers': '*'
            });
            return res.end();
          }

          // Si la ROM est disponible localement, streaming direct
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Length': stat.size,
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
              'Cache-Control': 'public, max-age=31536000'
            });
            if (req.method === 'HEAD') return res.end();
            return fs.createReadStream(filePath).pipe(res);
          }

          // 2. Si la ROM n'existe pas encore, stream asynchrone depuis Archive.org sans bloquer le serveur
          console.log(`[CSW-Arcade] Streaming asynchrone de la ROM: ${resolvedName}.zip...`);
          const candidateUrls = [
            `https://archive.org/download/neo-geo-mvs-romset/${resolvedName}.zip`,
            `https://archive.org/download/NeoGeoRomCollectionByGhostware/${resolvedName}.zip`,
            `https://archive.org/download/mame-merged/${resolvedName}.zip`
          ];

          for (const remoteUrl of candidateUrls) {
            try {
              const remoteRes = await fetch(remoteUrl, {
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
              });

              if (remoteRes.ok) {
                const cl = remoteRes.headers.get('content-length');
                res.writeHead(200, {
                  'Content-Type': 'application/zip',
                  ...(cl ? { 'Content-Length': cl } : {}),
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                  'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
                  'Cache-Control': 'public, max-age=31536000'
                });

                if (req.method === 'HEAD') return res.end();

                const targetPath = path.resolve(romsDir, resolvedName + '.zip');
                const fileWriteStream = fs.createWriteStream(targetPath);
                const reader = remoteRes.body.getReader();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const buf = Buffer.from(value);
                  res.write(buf);
                  fileWriteStream.write(buf);
                }

                fileWriteStream.end();
                res.end();
                console.log(`[CSW-Arcade] ROM ${resolvedName}.zip téléchargée et mise en cache (${targetPath}).`);
                return;
              }
            } catch (dlErr) {
              console.warn(`[CSW-Arcade] Erreur stream source ${remoteUrl}:`, dlErr.message);
            }
          }

          res.statusCode = 404;
          return res.end(`ROM ${resolvedName}.zip introuvable sur les serveurs distants`);
        } catch (err) {
          res.statusCode = 500;
          res.end(err.message);
        }
      };

      server.middlewares.use('/api/rom-data', handleRomRequest);
      server.middlewares.use('/api/rom', handleRomRequest);
      server.middlewares.use('/api/rom-proxy', handleRomRequest);

      // Endpoint d'audit des ROMs pour le frontend (Web & Electron)
      server.middlewares.use('/api/roms-list', (req, res) => {
        try {
          const files = fs.existsSync(romsDir) 
            ? fs.readdirSync(romsDir).filter(f => f.toLowerCase().endsWith('.zip')) 
            : [];
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ success: true, files }));
        } catch(e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      });
    }
  };
}

const NEORAGEX_DIR = 'E:\\Telechargement\\EMULADORDENEOGEO\\NeoRAGEx_5.0\\NEO GEO\\NeoRAGEx_5.0';
const NEORAGEX_EXE = path.join(NEORAGEX_DIR, 'NeoRAGEx 5.0.exe');
const NEORAGEX_INI = path.join(NEORAGEX_DIR, 'neoragex5.0.ini');

function syncNeoRAGExIni(settings) {
  try {
    if (!fs.existsSync(NEORAGEX_INI)) return;
    let ini = fs.readFileSync(NEORAGEX_INI, 'utf8');

    if (settings?.video?.scanlines !== undefined) {
      ini = ini.replace(/SCANLINES:(YES|NO)/gi, `SCANLINES:${settings.video.scanlines ? 'YES' : 'NO'}`);
    }

    if (settings?.system?.biosMode) {
      const mode = settings.system.biosMode === 'mvs' ? 'ARCADE' : 'CONSOLE';
      ini = ini.replace(/SYSTEM:(ARCADE|CONSOLE)/gi, `SYSTEM:${mode}`);
    }

    if (settings?.audio?.volume !== undefined) {
      ini = ini.replace(/MAINVOLUME:\d+/gi, `MAINVOLUME:${Math.round(settings.audio.volume)}`);
    }

    fs.writeFileSync(NEORAGEX_INI, ini, 'utf8');
  } catch (err) {
    console.warn('[syncNeoRAGExIni] Erreur mise à jour INI:', err.message);
  }
}

function nativeLauncherPlugin() {
  return {
    name: 'native-launcher-middleware',
    configureServer(server) {
      server.middlewares.use('/api/launch-native', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = body ? JSON.parse(body) : {};
            syncNeoRAGExIni(data.settings);

            if (!fs.existsSync(NEORAGEX_EXE)) {
              res.statusCode = 404;
              return res.end(JSON.stringify({ success: false, error: 'NeoRAGEx 5.0.exe introuvable sur le disque E:' }));
            }

            const child = spawn(NEORAGEX_EXE, [], {
              cwd: NEORAGEX_DIR,
              detached: true,
              stdio: 'ignore'
            });
            child.unref();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, pid: child.pid }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });
    }
  };
}

function netplayPlugin() {
  return {
    name: 'netplay-middleware',
    configureServer(server) {
      try {
        setupNetplayHub(server);

        // Fournit l'IP locale Wi-Fi/LAN du PC hôte pour connecter facilement les mobiles
        server.middlewares.use('/api/network-info', (req, res) => {
          try {
            const interfaces = os.networkInterfaces();
            let localIp = '127.0.0.1';
            for (const name of Object.keys(interfaces)) {
              for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                  localIp = iface.address;
                  break;
                }
              }
            }
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
              success: true,
              localIp,
              port: 3003,
              lanUrl: `http://${localIp}:3003`
            }));
          } catch(e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
      } catch(e) {
        console.warn('[Vite] Erreur init netplayHub:', e.message);
      }
    }
  };
}

function romManifestPlugin() {
  return {
    name: 'rom-manifest-generator',
    buildStart() {
      try {
        const romsDir = path.resolve(__dirname, 'public/roms');
        const manifestPath = path.resolve(__dirname, 'public/roms-manifest.json');
        const files = fs.existsSync(romsDir)
          ? fs.readdirSync(romsDir).filter(f => f.toLowerCase().endsWith('.zip'))
          : [];
        if (!files.some(f => f.toLowerCase() === 'neogeo.zip') && fs.existsSync(path.join(romsDir, 'neogeo.zip'))) {
          files.push('neogeo.zip');
        }
        fs.writeFileSync(manifestPath, JSON.stringify({ success: true, files }, null, 2), 'utf8');
        console.log(`[CSW-Arcade] Manifeste public/roms-manifest.json généré (${files.length} fichiers).`);
      } catch(e) {}
    }
  };
}

// Détection de l'environnement : Web pur (Netlify / PWA) vs Desktop Electron
// Les plugins Electron ne sont activés QUE pour le build desktop dédié, jamais sur le web ou Netlify
const isElectron = Boolean(
  !process.env.NETLIFY && 
  process.env.BUILD_TARGET !== 'web' && 
  fs.existsSync(path.resolve(__dirname, 'electron/main.js')) &&
  (process.env.ELECTRON === 'true' || process.env.npm_lifecycle_event === 'build:electron')
);

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    romStreamPlugin(),
    nativeLauncherPlugin(),
    netplayPlugin(),
    romManifestPlugin(),
    ...(isElectron ? [
      electron([
        {
          // Main process entry file of the Electron App.
          entry: 'electron/main.js',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron']
              }
            }
          }
        },
        {
          // Preload scripts
          entry: 'electron/preload.js',
          onstart(options) {
            // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
            options.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron']
              }
            }
          }
        }
      ]),
      renderer()
    ] : [])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        player: path.resolve(__dirname, 'player.html')
      }
    }
  },
  server: {
    host: true,
    port: 3003,
    strictPort: true,
    watch: {
      ignored: ['**/public/**', '**/release/**', '**/dist/**', '**/dist-electron/**']
    },
    proxy: {
      '/api/archive-rom': {
        target: 'https://archive.org/download',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/archive-rom/, '')
      }
    }
  }
});
