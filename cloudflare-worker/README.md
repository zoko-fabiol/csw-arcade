# CSW-Arcade Signaling Worker (Traduction VoiceBridge `api.php` -> Cloudflare Workers)

Ce Worker remplace **PHP (`api.php`) + VPS Node.js** pour :
1. **`VoiceBridge` (`POST /api.php?route=...` & `/api/voicebridge?route=...`)** : 1 Durable Object SQLite par salon (`VoiceBridgeRoomDO`), zéro verrou fichier global `state.json`.
2. **`CSW-Arcade` WebSockets temps réel (`/ws/voice`, `/ws/netplay`)** : Durable Object avec WebSocket Hibernation (`SignalingHubDO`), 100 % P2P WebRTC Opus sans relais audio.
3. **`Cloudflare Anycast TURN` (`GET /api/turn-credentials`)** : génération automatique des identifiants TURN éphémères UDP-first.

## Déploiement Cloudflare

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put CLOUDFLARE_TURN_API_TOKEN
npm run deploy
```

> Pour autoriser les appels depuis un domaine différent (ex: `https://csw-arcade.tech` vers `*.workers.dev`), ajoutez `"ALLOW_CROSS_ORIGIN": "1"` dans `"vars"` de `wrangler.jsonc`.
