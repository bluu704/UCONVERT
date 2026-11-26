// 영상·오디오 도구: 구간 자르기 · 소리만 빼기 · 용량 줄이기 · GIF 만들기 (Mediabunny + WebCodecs)
import { ensureEncoder, convertMedia } from '../convert/media.js';

let mbP = null;
const MB = () => mbP || (mbP = import('mediabunny'));
const base = (n) => n.replace(/\.[^.]+$/, '');
const MIME = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' };

async function input(file) {
  const M = await MB();
  return new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
}

// 길이·화면 크기·소리 유무
export async function probe(file) {
  const inp = await input(file);
  try {
    const v = await inp.getPrimaryVideoTrack(), a = await inp.getPrimaryAudioTrack();
    const dur = await inp.computeDuration();
    return { dur, video: v ? { w: v.displayWidth, h: v.displayHeight } : null, audio: !!a };
  } catch { throw new Error('이 파일은 읽을 수 없어요. 먼저 MP4로 변환해 보세요'); }
  finally { inp.dispose?.(); }
}

// 장면 띠용 작은 그림 n장
export async function frames(file, n, width) {
  const M = await MB(); const inp = await input(file);
  try {
    const v = await inp.getPrimaryVideoTrack(); if (!v) return [];
    const dur = await inp.computeDuration();
    const first = await v.getFirstTimestamp().catch(() => 0);
    const sink = new M.CanvasSink(v, { width, poolSize: 0 });
    const ts = Array.from({ length: n }, (_, i) => first + (dur - first) * (i + 0.5) / n);
    const out = [];
    for await (const w of sink.canvasesAtTimestamps(ts)) {
      if (!w) { out.push(null); continue; }
      const c = w.canvas;
      const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }) : await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
      out.push(URL.createObjectURL(blob));
    }
    return out;
  } finally { inp.dispose?.(); }
}

// 오디오 파일의 소리 모양 (막대 n개, 0~1)
export async function peaks(file, n) {
  if (file.size > 200 * 1024 * 1024) return null;
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out = [];
  for (let i = 0; i < n; i++) {
    let m = 0; const s = i * step, e = Math.min(d.length, s + step);
    for (let k = s; k < e; k += 16) { const v = Math.abs(d[k]); if (v > m) m = v; }
    out.push(m);
  }
  const top = Math.max(0.01, ...out);
  return out.map(v => v / top);
}

// 입력 형식 → 같은 종류의 출력 형식
const SAME = { mp4: 'mp4', m4v: 'mp4', mov: 'mov', webm: 'webm', mkv: 'mkv', mp3: 'mp3', m4a: 'm4a', wav: 'wav', ogg: 'ogg', opus: 'ogg', flac: 'flac', aac: 'aac' };
function outputFor(M, fmt) {
  return {
    mp4: () => new M.Mp4OutputFormat(), m4a: () => new M.Mp4OutputFormat(), mov: () => new M.MovOutputFormat(), webm: () => new M.WebMOutputFormat(),
    mkv: () => new M.MkvOutputFormat(), mp3: () => new M.Mp3OutputFormat(), wav: () => new M.WavOutputFormat(), ogg: () => new M.OggOutputFormat(),
    flac: () => new M.FlacOutputFormat(), aac: () => new M.AdtsOutputFormat(),
  }[fmt]();
}
async function runConversion(conv, progress, signal) {
  if (!conv.isValid) throw new Error('이 파일은 이 방법으로 처리할 수 없어요');
  conv.onProgress = (p) => progress?.(Math.min(0.99, p));
  const stop = () => conv.cancel(); signal?.addEventListener('abort', stop);
  try { await conv.execute(); } finally { signal?.removeEventListener('abort', stop); }
}

/* ---------- 구간 자르기 ---------- */
export async function trim(file, ext, s, e, fast, progress) {
  const fmt = SAME[ext];
  if (!fmt) throw new Error(`${ext.toUpperCase()}는 자를 수 없어요. 먼저 MP4로 변환해 보세요`);
  const M = await MB();
  if (['mp3', 'm4a', 'aac', 'flac'].includes(fmt)) await ensureEncoder(M, { m4a: 'aac' }[fmt] || fmt);
  const target = new M.BufferTarget();
  const output = new M.Output({ format: outputFor(M, fmt), target });
  const conv = await M.Conversion.init({
    input: await input(file), output, showWarnings: false,
    trim: { start: s, end: e },
    // 빠르게: 다시 인코딩하지 않고 가장 가까운 키프레임부터 복사 / 정확하게: 다시 인코딩
    copy: fast ? { shiftTolerance: Infinity } : false,
  });
  await runConversion(conv, progress);
  return { blob: new Blob([target.buffer], { type: MIME[fmt] }), name: `${base(file.name)}_자름.${fmt === 'aac' ? 'aac' : fmt}` };
}

/* ---------- 소리만 빼기 ---------- */
export async function extractAudio(file, ext, fmt, bitrate, progress) {
  const r = await convertMedia(file, ext, fmt, { bitrate }, progress);
  return { blob: r.blob, name: `${base(file.name)}.${fmt}`, cleanup: r.cleanup };
}

/* ---------- 용량 줄이기 ---------- */
export async function shrink(file, goalMB, res, mute, progress) {
  const M = await MB();
  if (!(await M.canEncodeVideo('avc').catch(() => false))) throw new Error('이 브라우저는 영상 인코딩을 지원하지 않아요. Chrome이나 Edge에서 해 주세요');
  const info = await probe(file);
  if (!info.video) throw new Error('영상이 없는 파일이에요');
  const goal = goalMB * 1024 * 1024;
  const aBits = mute || !info.audio ? 0 : 96000;
  if (!mute && info.audio) await ensureEncoder(M, 'aac');
  let vBits = Math.floor(goal * 8 * 0.92 / info.dur - aBits);
  if (vBits < 120000) throw new Error(`${goalMB}MB는 너무 작아요. 목표 크기를 더 크게 잡아 주세요`);
  const h = { '1080p': 1080, '720p': 720, '480p': 480 }[res];
  for (let tryN = 0; tryN < 2; tryN++) {
    const target = new M.BufferTarget();
    const output = new M.Output({ format: new M.Mp4OutputFormat(), target });
    const conv = await M.Conversion.init({
      input: await input(file), output, showWarnings: false,
      video: (t) => ({ codec: 'avc', bitrate: vBits, forceTranscode: true, ...(h && t.displayHeight > h ? { height: h } : {}) }),
      audio: aBits ? { codec: 'aac', bitrate: aBits, forceTranscode: true } : { discard: true },
    });
    await runConversion(conv, progress);
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    if (blob.size <= goal || tryN === 1) return { blob, name: `${base(file.name)}_${goalMB}MB.mp4`, over: blob.size > goal };
    vBits = Math.floor(vBits * goal / blob.size * 0.9); // 목표보다 크면 한 번 더 낮춰서
  }
}

/* ---------- GIF 만들기 ---------- */
export const gifEstimate = (len, w, h, fps) => len * fps * w * h * 0.1;
export async function makeGif(file, s, e, width, fps, loop, progress) {
  const M = await MB(); const inp = await input(file);
  try {
    const v = await inp.getPrimaryVideoTrack(); if (!v) throw new Error('영상이 없는 파일이에요');
    const n = Math.min(600, Math.max(1, Math.round((e - s) * fps)));
    if ((e - s) * fps > 600) throw new Error(`GIF는 600장까지예요. 구간을 ${Math.floor(600 / fps)}초 이하로 줄여 주세요`);
    const w = Math.min(width, v.displayWidth), h = Math.round(w * v.displayHeight / v.displayWidth / 2) * 2;
    const sink = new M.CanvasSink(v, { width: w, height: h, fit: 'fill', poolSize: 0 });
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
    const g = GIFEncoder();
    const ts = Array.from({ length: n }, (_, i) => s + i / fps);
    let i = 0, last = null;
    for await (const wc of sink.canvasesAtTimestamps(ts)) {
      const c = wc?.canvas || last; if (!c) { i++; continue; }
      const data = c.getContext('2d').getImageData(0, 0, w, h).data;
      const palette = quantize(data, 256, { format: 'rgb565' });
      g.writeFrame(applyPalette(data, palette, 'rgb565'), w, h, { palette, delay: Math.round(1000 / fps), repeat: loop ? 0 : -1 });
      last = c; progress?.(++i / n);
    }
    g.finish();
    return { blob: new Blob([g.bytes()], { type: 'image/gif' }), name: `${base(file.name)}.gif` };
  } finally { inp.dispose?.(); }
}
