import { defineConfig } from 'vite';

export default defineConfig({
  // ffmpeg.wasm은 자체 워커를 쓰므로 사전 번들링에서 뺀다
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '7z-wasm', '@jsquash/avif', '@jsquash/webp'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
