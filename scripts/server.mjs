import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tripChatHandler } from '../server/tripChat.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

async function startServer() {
  const vite = await createViteServer({
    root: projectRoot,
    plugins: [react()],
    server: { middlewareMode: true, hmr: { protocol: 'ws', host: 'localhost', port: 5173 } },
  });

  const httpServer = createServer((req, res) => {
    // Handle API routes
    if (req.url === '/api/deepseek/trip-chat' && req.method === 'POST') {
      tripChatHandler(req, res, process.env);
    } else {
      // Everything else goes through Vite
      vite.middlewares(req, res);
    }
  });

  httpServer.listen(5173, () => {
    console.log('Dev server running at http://localhost:5173');
  });
}

startServer().catch(console.error);
