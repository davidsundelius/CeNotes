import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa';
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        globPatterns: ['**/[!reports]*.{html,png,jpg,jpeg,svg,ico,json,woff2}']
      },
      manifest: {
        name: 'CeNotes',
        short_name: 'CeNotes',
        description: 'Spela och läsa noter',
        theme_color: '#646cff',
        background_color: '#646cff'
      }
    }),
  ],
  esbuild: { legalComments: 'none' },
  build: {
    chunkSizeWarningLimit: 1173,
    target: 'esnext',
    reportCompressedSize: false
  }
})
