import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// The browser calls same-origin `/api/*`, which Vite proxies to the sync-engine
// (reachable as `engine` on the compose network), so no CORS is needed in dev.
export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,
    port: 5173,
    // Allow access via the compose service name (e.g. http://web:5173).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.ENGINE_URL ?? 'http://engine:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
