import { createServer } from 'http';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

async function startServer() {
  const { tripChatHandler } = await import('../server/tripChat.ts');

  const vite = await createViteServer({
    root: projectRoot,
    plugins: [react()],
    server: { middlewareMode: true },
  });

  const httpServer = createServer((req, res) => {
    // Handle API routes FIRST
    if (req.url === '/api/deepseek/trip-chat' && req.method === 'POST') {
      tripChatHandler(req, res, process.env);
      return;
    }

    // Everything else goes through Vite middleware
    vite.middlewares(req, res, () => {
      res.writeHead(404);
      res.end('Not found');
    });
  });

  httpServer.listen(5173, () => {
    console.log('✓ Dev server running at http://localhost:5173');
    console.log('✓ API endpoint available at /api/deepseek/trip-chat');
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
