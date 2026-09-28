import { createServer } from 'node:http';
import { tripChatHandler } from './tripChat.mjs';

const PORT = 5174;

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/deepseek/trip-chat' && req.method === 'POST') {
    console.log('✓ Handling trip chat request...');
    tripChatHandler(req, res, process.env).catch(err => {
      console.error('Handler crashed:', err);
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Handler error' }));
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`✓ API server running at http://localhost:${PORT}`);
  console.log(`✓ Endpoint: POST /api/deepseek/trip-chat`);
});
