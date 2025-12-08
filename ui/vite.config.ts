import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/config/ui/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    watch: {
      // Polling is more reliable on WSL2/VM/shared folders (e.g., /mnt/c) so HMR picks up file changes.
      usePolling: true,
      interval: 300,
    },
    proxy: {
      // Proxy management/backend APIs so Vite origin can call /config/* without CORS/404s in dev.
      '/config/api': {
        target: 'http://localhost:22100',
        changeOrigin: true,
      },
      '/config/collector': {
        target: 'http://localhost:22100',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
})
