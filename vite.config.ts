import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { deepseekHandler } from './server/deepseek.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  return {
    plugins: [react(), {
      name: 'deepseek-api',
      configureServer(server) {
        server.middlewares.use('/api/deepseek/attractions', (req, res) => {
          void deepseekHandler(req, res, env)
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/deepseek/attractions', (req, res) => {
          void deepseekHandler(req, res, env)
        })
      },
    }],
  }
})
