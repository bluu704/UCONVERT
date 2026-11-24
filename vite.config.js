import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// public/_headers(Cloudflare Pages용)의 "/*" 헤더를 미리보기 서버에도 똑같이 적용해서 CSP를 로컬에서 시험한다
function headersFor(path = '/*') {
  const out = {};
  let cur = null;
  for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = line.trim(); continue; }
    if (cur === path) { const i = line.indexOf(':'); out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return out;
}

export default defineConfig({
  // ffmpeg.wasm은 자체 워커를 쓰므로 사전 번들링에서 뺀다
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '7z-wasm', '@jsquash/avif', '@jsquash/webp', 'libheif-js'] },
  worker: { format: 'es' },
  preview: { headers: headersFor('/*') },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
