import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

const FFMPEG_VERSION = '0.12.10'
const FFMPEG_UTIL_VERSION = '0.12.1'
const CDN = 'https://cdn.jsdelivr.net/npm'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  base: './',
  optimizeDeps: {
    // Prevent Vite's pre-bundler from rewriting @ffmpeg's internal Worker URL references
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // Don't bundle @ffmpeg packages — import them from CDN at runtime.
      // This prevents Rollup from transforming the dynamic import(coreURL) inside
      // @ffmpeg/ffmpeg's worker, which would break core loading in production.
      external: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
      output: {
        paths: {
          '@ffmpeg/ffmpeg': `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`,
          '@ffmpeg/util': `${CDN}/@ffmpeg/util@${FFMPEG_UTIL_VERSION}/dist/esm/index.js`,
        },
      },
    },
  },
  server: {
    // Required for SharedArrayBuffer (FFmpeg.wasm) during local dev
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
