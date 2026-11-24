// 오디오·영상 변환
// 1순위: Mediabunny (브라우저 내장 WebCodecs, 파일을 조금씩 읽고 써서 큰 파일도 처리)
// 2순위: ffmpeg.wasm (AVI·WMA·GIF 등, 또는 1순위가 실패했을 때)
import { MIME } from '../formats.js';

const BIG = 300 * 1024 * 1024; // 이보다 큰 결과물은 메모리 대신 브라우저 저장소(OPFS)에 바로 쓴다
const AUDIO_ONLY = new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus']);
const BITRATE = { '128': 128e3, '192': 192e3, '256': 256e3, '320': 320e3 };

export async function convertMedia(file, ext, target, opts, progress, signal) {
  const viaMb = !['avi', 'gif'].includes(target) && !['avi', 'wma', 'gif'].includes(ext);
  if (viaMb) {
    try {
      return await withMediabunny(file, target, opts, progress, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('Mediabunny 실패, ffmpeg로 다시 시도', e);
      progress?.(0);
    }
  }
  return withFfmpeg(file, ext, target, opts, progress, signal);
}

/* ---------- Mediabunny ---------- */
// 브라우저에 인코더가 없으면 WebAssembly 인코더를 끼운다
const registered = new Set();
async function ensureEncoder(MB, codec) {
  if (registered.has(codec) || await MB.canEncodeAudio(codec).catch(() => false)) return;
  if (codec === 'mp3') (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
  else if (codec === 'aac') (await import('@mediabunny/aac-encoder')).registerAacEncoder();
  else if (codec === 'flac') (await import('@mediabunny/flac-encoder')).registerFlacEncoder();
  registered.add(codec);
}

async function withMediabunny(file, target, opts, progress, signal) {
  const MB = await import('mediabunny');
  if (typeof VideoEncoder === 'undefined' && typeof AudioEncoder === 'undefined') throw new Error('WebCodecs 없음');
  const need = { mp3: 'mp3', m4a: 'aac', aac: 'aac', flac: 'flac', mp4: 'aac', mov: 'aac', mkv: 'aac' }[target];
  if (need) await ensureEncoder(MB, need);
  const formats = {
    mp4: () => new MB.Mp4OutputFormat(), m4a: () => new MB.Mp4OutputFormat(), mov: () => new MB.MovOutputFormat(),
    webm: () => new MB.WebMOutputFormat(), mkv: () => new MB.MkvOutputFormat(), wav: () => new MB.WavOutputFormat(),
    mp3: () => new MB.Mp3OutputFormat(), ogg: () => new MB.OggOutputFormat(), opus: () => new MB.OggOutputFormat(),
    aac: () => new MB.AdtsOutputFormat(), flac: () => new MB.FlacOutputFormat(),
  };
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });

  // 결과가 클 것 같으면 OPFS에 바로 쓴다
  let target_, opfs = null;
  if (file.size > BIG && navigator.storage?.getDirectory) {
    try {
      const dir = await navigator.storage.getDirectory();
      const name = `uc-${Date.now()}-${Math.random().toString(36).slice(2)}.${target}`;
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      opfs = { dir, name, handle, writable };
      target_ = new MB.StreamTarget(writable, { chunked: true });
    } catch { opfs = null; }
  }
  if (!target_) target_ = new MB.BufferTarget();

  const output = new MB.Output({ format: formats[target](), target: target_ });
  const audioOnly = AUDIO_ONLY.has(target);
  const res = { '1080p': 1080, '720p': 720, '480p': 480 }[opts.res];
  const audio = {};
  // 브라우저는 Vorbis 인코딩을 못 하므로 OGG에는 Opus를 담는다
  if (target === 'opus' || target === 'ogg') audio.codec = 'opus';
  if (target === 'flac') audio.codec = 'flac';
  if (target === 'm4a' || target === 'aac') audio.codec = 'aac';
  if (BITRATE[opts.bitrate] && ['mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(target)) { audio.bitrate = BITRATE[opts.bitrate]; audio.forceTranscode = true; }

  // MP4·MOV는 어디서나 재생되도록 H.264 + AAC를 쓴다 (인코더가 있을 때)
  const compat = (target === 'mp4' || target === 'mov') && await MB.canEncodeVideo('avc').catch(() => false);
  if (compat && !audio.codec) audio.codec = 'aac';
  const conv = await MB.Conversion.init({
    input, output, showWarnings: false,
    video: audioOnly ? { discard: true } : (track) => ({
      ...(res && track.displayHeight > res ? { height: res } : {}),
      ...(compat ? { codec: 'avc' } : {}),
    }),
    audio,
  });
  if (!conv.isValid) {
    await opfs?.writable.abort?.().catch(() => {});
    throw new Error('Mediabunny로 처리할 수 없는 조합');
  }
  conv.onProgress = (p) => progress?.(Math.min(0.99, p));
  const onAbort = () => conv.cancel();
  signal?.addEventListener('abort', onAbort);
  try { await conv.execute(); }
  finally { signal?.removeEventListener('abort', onAbort); }

  if (opfs) {
    const f = await opfs.handle.getFile();
    return { blob: f, cleanup: () => opfs.dir.removeEntry(opfs.name).catch(() => {}) };
  }
  return { blob: new Blob([target_.buffer], { type: MIME[target] }) };
}

/* ---------- ffmpeg.wasm ---------- */
let ffPromise = null;
// ffmpeg 코어(약 31MB)는 Cloudflare Pages 파일 크기 한도(25MB)를 넘어서 CDN에서 받는다
const CORES = import.meta.env.VITE_FFMPEG_CORE ? [import.meta.env.VITE_FFMPEG_CORE] : [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm',
];
async function getFfmpeg() {
  if (!ffPromise) ffPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    let lastErr;
    for (const base of CORES) {
      try {
        const ff = new FFmpeg();
        await ff.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        return ff;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  })().catch(e => { ffPromise = null; throw new Error('변환 엔진(ffmpeg)을 불러오지 못했어요. 인터넷 연결을 확인해 주세요'); });
  return ffPromise;
}

let ffBusy = Promise.resolve();
async function withFfmpeg(file, ext, target, opts, progress, signal) {
  // ffmpeg 인스턴스는 하나라서 차례로 실행한다
  const run = ffBusy.then(() => ffJob(file, ext, target, opts, progress, signal));
  ffBusy = run.catch(() => {});
  return run;
}

async function ffJob(file, ext, target, opts, progress, signal) {
  progress?.(0.01);
  const ff = await getFfmpeg();
  const dir = '/in' + Date.now();
  await ff.createDir(dir);
  await ff.mount('WORKERFS', { files: [file] }, dir);
  const inp = `${dir}/${file.name}`;
  const out = `out.${target}`;
  const onProg = ({ progress: p }) => { if (p >= 0 && p <= 1) progress?.(Math.min(0.99, p)); };
  ff.on('progress', onProg);
  const onAbort = () => ff.terminate();
  signal?.addEventListener('abort', onAbort);

  const res = { '1080p': 1080, '720p': 720, '480p': 480 }[opts.res];
  // H.264·VP8은 가로세로가 짝수여야 한다
  const scale = ['-vf', res ? `scale=-2:'min(${res},ih)'` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const br = BITRATE[opts.bitrate] ? `${BITRATE[opts.bitrate] / 1000}k` : '192k';
  const A = {
    mp3: ['-vn', '-c:a', 'libmp3lame', '-b:a', br], m4a: ['-vn', '-c:a', 'aac', '-b:a', br], aac: ['-vn', '-c:a', 'aac', '-b:a', br],
    ogg: ['-vn', '-c:a', 'libvorbis', '-b:a', br], opus: ['-vn', '-c:a', 'libopus', '-b:a', br], flac: ['-vn', '-c:a', 'flac'], wav: ['-vn', '-c:a', 'pcm_s16le'],
  };
  const V = {
    mp4: [...scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
    mov: [...scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'],
    mkv: [...scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'],
    webm: [...scale, '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'],
    avi: [...scale, '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-b:a', '192k'],
    gif: ['-vf', `fps=12,scale='min(${res || 480},iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-loop', '0'],
  };
  try {
    let code = 1;
    // 영상 → 영상은 먼저 재인코딩 없이 담기만 시도 (빠름)
    if (['mp4', 'mov', 'mkv'].includes(target) && !res && ext !== 'gif') {
      code = await ff.exec(['-i', inp, '-map', '0:v?', '-map', '0:a?', '-c', 'copy', ...(target === 'mp4' ? ['-movflags', '+faststart'] : []), out]);
    }
    if (code !== 0) {
      await ff.deleteFile(out).catch(() => {});
      code = await ff.exec(['-i', inp, ...(A[target] || V[target]), out]);
    }
    if (code !== 0) throw new Error('변환에 실패했어요. 파일이 손상됐거나 지원하지 않는 코덱일 수 있어요');
    const data = await ff.readFile(out);
    await ff.deleteFile(out).catch(() => {});
    return { blob: new Blob([data], { type: MIME[target] }) };
  } finally {
    ff.off('progress', onProg);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) ffPromise = null;
    else { await ff.unmount(dir).catch(() => {}); await ff.deleteDir(dir).catch(() => {}); }
  }
}

// 지난번에 남은 임시 파일 정리
export async function cleanupOpfs() {
  try {
    const dir = await navigator.storage.getDirectory();
    for await (const [name] of dir.entries()) if (name.startsWith('uc-')) await dir.removeEntry(name).catch(() => {});
  } catch { /* 지원 안 함 */ }
}
