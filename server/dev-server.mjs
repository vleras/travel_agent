import { createServer } from 'node:http';
import { tripChatHandler } from './tripChat.ts';

const PORT = 5174;

const server = createServer((req, res) => {
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
    tripChatHandler(req, res, process.env);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`✓ API server running at http://localhost:${PORT}`);
  console.log(`✓ Endpoint: POST /api/deepseek/trip-chat`);
});
