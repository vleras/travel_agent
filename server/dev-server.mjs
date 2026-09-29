import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tripChatHandler } from './tripChat.mjs';
import { deepseekHandler } from './deepseek.ts';
import { foodHandler } from './food.ts';

// Load .env file
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      if (!process.env[key?.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
  console.log('✓ Loaded .env file');
} catch {
  console.warn('⚠ No .env file found or error reading it');
}

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

  const handler = {
    '/api/deepseek/trip-chat': tripChatHandler,
    '/api/deepseek/attractions': deepseekHandler,
    '/api/deepseek/food': foodHandler,
  }[req.url];
  if (handler && req.method === 'POST') {
    handler(req, res, process.env).catch(err => {
      console.error('Handler crashed:', err);
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Handler error' }));
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ API server running at http://localhost:${PORT}`);
  console.log(`✓ Endpoint: POST /api/deepseek/trip-chat`);
});
