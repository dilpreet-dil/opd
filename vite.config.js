import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['images/hospital-ambient.mp4', 'images/hospital-ambient-previous.mp4', 'pwa-icon.svg'],
    manifest: {
      name: 'OPD Saathi Hospital Services',
      short_name: 'OPD Saathi',
      description: 'Hospital registration, queue status and indoor directions.',
      theme_color: '#f2f7f4',
      background_color: '#edf4f0',
      display: 'standalone',
      start_url: '/',
      icons: [{ src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    workbox: {
      navigateFallback: '/index.html',
      maximumFileSizeToCacheInBytes: 9 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,mp4,json}'],
      runtimeCaching: [{
        urlPattern: ({ url }) => url.pathname === '/api/public/board',
        handler: 'NetworkFirst',
        options: { cacheName: 'public-hospital-data', networkTimeoutSeconds: 2, expiration: { maxEntries: 24, maxAgeSeconds: 86400 } },
      }],
    },
  })],
  server: {
    host: '0.0.0.0',
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3010', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3010', changeOrigin: true, ws: true },
    },
  },
});
