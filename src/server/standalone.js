import http from 'node:http';
import { setupNetplayHub } from './netplayHub.js';

const PORT = process.env.PORT || 3003;

const middlewares = [];
const mockServer = {
  middlewares: {
    use(route, handler) {
      middlewares.push({ route, handler });
    }
  },
  httpServer: null,
};

const server = http.createServer((req, res) => {
  // CORS global
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1:3003'}`);
  const match = middlewares.find((m) => url.pathname === m.route || url.pathname.startsWith(m.route));

  if (match) {
    return match.handler(req, res);
  }

  // Health check
  if (url.pathname === '/api/health' || url.pathname === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Endpoint non trouvé', path: url.pathname }));
});

mockServer.httpServer = server;
setupNetplayHub(mockServer);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CSW-Arcade Backend] Serveur Netplay & Salons actif sur http://0.0.0.0:${PORT}`);
  console.log(`[CSW-Arcade Backend] Routes enregistrées :`, middlewares.map((m) => m.route));
});
