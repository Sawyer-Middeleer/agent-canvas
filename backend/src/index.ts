import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { handleSessionWS } from './routes/ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT ?? '3333';

const app = express();
app.use(express.json());

// CORS middleware for dev
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// API routes
app.use(apiRouter);

// Serve frontend static files
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send(`<!DOCTYPE html><html><body>
      <h1>Agent Canvas</h1>
      <p>Frontend not built yet. Run <code>cd frontend && npm run build</code></p>
      <p>API available at <a href="/api/projects">/api/projects</a></p>
    </body></html>`);
  });
}

// Create HTTP server and attach WebSocket
const server = createServer(app);
const wss = new WebSocketServer({ server, path: undefined });

// Route WebSocket connections
wss.on('connection', (ws, req) => {
  const url = req.url ?? '';
  if (url.startsWith('/ws/sessions/')) {
    handleSessionWS(ws, req);
  } else {
    ws.close(1008, 'Unknown WebSocket path');
  }
});

server.listen(parseInt(port, 10), () => {
  console.log(`Agent Canvas gateway listening on http://localhost:${port}`);
});
