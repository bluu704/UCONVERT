// 이미지 도구: 압축 · 크기 바꾸기 · 자르기/돌리기 · 위치정보 지우기
import { decodeImage, encodeImage, hasAlpha } from '../convert/image.js';
import { inspect, strip } from './exif.js';

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' };
const KEEP = new Set(['jpg', 'png', 'webp', 'avif']);
const base = (n) => n.replace(/\.[^.]+$/, '');
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// 목록에 보여 줄 작은 그림과 원래 크기, 들어 있는 정보
export async function info(file, ext) {
  const c = await decodeImage(file, ext);
  const w = c.width, h = c.height;
  const k = Math.min(1, 360 / Math.max(w, h));
  const t = canvas(w * k, h * k), x = t.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, t.width, t.height);
  const url = URL.createObjectURL(await new Promise(r => t.toBlob(r, 'image/jpeg', 0.8)));
  let meta = null;
  if (['jpg', 'png', 'webp'].includes(ext)) meta = inspect(new Uint8Array(await file.arrayBuffer()));
  c.width = c.height = 0;
  return { w, h, url, meta };
}

// 높은 화질로 줄이기 (한 번에 반 이상 줄이면 계단처럼 보여서 여러 번에 나눈다)
function scaleTo(src, w, h) {
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const half = canvas(cur.width / 2, cur.height / 2), x = half.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = canvas(w, h), x = out.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}
function outFmt(ext, want, c) {
  if (want && want !== 'auto') return want;
  if (KEEP.has(ext) && ext !== 'png') return ext;
  return hasAlpha(c) ? (ext === 'png' ? 'png' : 'webp') : 'jpg';
}

/* ---------- 압축 ---------- */
// o: {mode:'q'|'size', q, target(바이트), fmt:'auto'|'jpg'|'webp'|'avif'}
export async function compress(file, ext, o) {
  let c = await decodeImage(file, ext);
  let fmt = outFmt(ext, o.fmt, c);
  if (fmt === 'png') fmt = 'webp'; // PNG는 화질을 고를 수 없어 WebP로 줄인다
  let blob;
  if (o.mode === 'size') {
    // 목표 크기 이하가 되는 가장 높은 화질을 찾는다 (안 되면 크기도 조금씩 줄인다)
    for (let round = 0; round < 6 && !blob; round++) {
      let lo = 30, hi = 95, best = null;
      while (hi - lo > 3) {
        const mid = Math.round((lo + hi) / 2);
        const b = await encodeImage(c, fmt, { quality: mid });
        if (b.size <= o.target) { best = b; lo = mid; } else hi = mid;
      }
      if (!best) { const b = await encodeImage(c, fmt, { quality: lo }); if (b.size <= o.target) best = b; }
      if (best) blob = best;
      else c = scaleTo(c, c.width * 0.8, c.height * 0.8);
    }
    blob ||= await encodeImage(c, fmt, { quality: 30 });
  } else blob = await encodeImage(c, fmt, { quality: o.q });
  // 오히려 커졌으면 원본을 그대로 쓴다 (형식을 직접 고른 경우는 제외)
  if (blob.size >= file.size && (fmt === ext || !o.fmt || o.fmt === 'auto')) return { blob: file, name: file.name, same: true };
  return { blob, name: `${base(file.name)}.${fmt}` };
}

/* ---------- 크기 바꾸기 ---------- */
export function newSize(w, h, o) {
  let W, H;
  if (o.rs === 'pct') { W = w * o.pct / 100; H = h * o.pct / 100; }
  else if (o.rs === 'long') { const k = o.long / Math.max(w, h); W = w * k; H = h * k; }
  else {
    const pw = +o.pw || 0, ph = +o.ph || 0;
    if (o.lock) { const k = pw ? pw / w : ph / h; W = w * k; H = h * k; }
    else { W = pw || w; H = ph || h; }
  }
  if (o.noUp && (W > w || H > h)) { W = w; H = h; }
  return [Math.max(1, Math.round(W)), Math.max(1, Math.round(H))];
}
export async function resize(file, ext, o) {
  const c = await decodeImage(file, ext);
  const [W, H] = newSize(c.width, c.height, o);
  const out = W === c.width && H === c.height ? c : scaleTo(c, W, H);
  const fmt = KEEP.has(ext) ? ext : outFmt(ext, 'auto', out);
  return { blob: await encodeImage(out, fmt, { quality: 92 }), name: `${base(file.name)}_${W}x${H}.${fmt}` };
}

/* ---------- 자르기 · 돌리기 ---------- */
export const RATIOS = { '원본': 0, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '16:9': 16 / 9, '3:2': 3 / 2, '9:16': 9 / 16 };
// 돌린 뒤 크기 W×H에서 비율에 맞는 가장 큰 사각형 (cx,cy: 가운데 위치 0~1)
export function cropRect(W, H, ratio, cx = 0.5, cy = 0.5) {
  const r = RATIOS[ratio] || 0;
  if (!r) return { x: 0, y: 0, w: W, h: H };
  let w = W, h = W / r;
  if (h > H) { h = H; w = H * r; }
  const x = Math.min(W - w, Math.max(0, cx * W - w / 2)), y = Math.min(H - h, Math.max(0, cy * H - h / 2));
  return { x, y, w, h };
}
export function transformed(c, rot, fx, fy) {
  const r = ((rot % 360) + 360) % 360, side = r % 180 !== 0;
  const out = canvas(side ? c.height : c.width, side ? c.width : c.height), x = out.getContext('2d');
  x.translate(out.width / 2, out.height / 2);
  x.rotate(r * Math.PI / 180);
  x.scale(fx ? -1 : 1, fy ? -1 : 1);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}
export async function cropRotate(file, ext, o) {
  const c = transformed(await decodeImage(file, ext), o.rot, o.fx, o.fy);
  const r = cropRect(c.width, c.height, o.ratio, o.cx, o.cy);
  const out = canvas(r.w, r.h);
  out.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  const fmt = KEEP.has(ext) ? ext : outFmt(ext, 'auto', out);
  return { blob: await encodeImage(out, fmt, { quality: 92 }), name: `${base(file.name)}_편집.${fmt}` };
}

/* ---------- 위치정보 지우기 ---------- */
export async function cleanMeta(file, ext, o) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const out = ['jpg', 'png', 'webp'].includes(ext) ? strip(bytes, o) : null;
  if (out) return { blob: new Blob([out], { type: MIME[ext] || file.type }), name: file.name };
  // 그 밖의 형식은 다시 저장하면 모든 정보가 빠진다
  const c = await decodeImage(file, ext);
  const fmt = KEEP.has(ext) ? ext : outFmt(ext, 'auto', c);
  return { blob: await encodeImage(c, fmt, { quality: 95 }), name: `${base(file.name)}.${fmt}` };
}
