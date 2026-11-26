// PDF 미리보기(썸네일)와 흰 여백 찾기 — pdf.js로 그린다
const MM = 72 / 25.4;
let pdfjsP = null;
const pdfjs = () => pdfjsP || (pdfjsP = import('../convert/doc/readers.js').then(m => m.getPdfjs()));

// entry: {id, file} → pdf.js 문서 (한 번만 연다)
export async function openDoc(entry) {
  if (!entry._doc) {
    entry._doc = (async () => {
      const lib = await pdfjs();
      const data = new Uint8Array(await entry.file.arrayBuffer());
      return lib.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
    })();
    entry._doc.catch(() => { entry._doc = null; });
  }
  return entry._doc;
}

// 쪽마다 보이는 크기(pt, 회전 반영)
export async function pageSizes(entry) {
  const doc = await openDoc(entry);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    out.push({ w: vp.width, h: vp.height });
  }
  return out;
}

const cache = new Map();   // key → Promise<objectURL>
export function thumb(entry, idx, width) {
  const key = `${entry.id}:${idx}:${width}`;
  if (!cache.has(key)) {
    const p = (async () => {
      const doc = await openDoc(entry);
      const page = await doc.getPage(idx + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: width / vp1.width * dpr });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      return URL.createObjectURL(blob);
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}
export function dropEntry(entry) {
  for (const [k, p] of cache) if (k.startsWith(entry.id + ':')) { p.then(u => URL.revokeObjectURL(u)).catch(() => {}); cache.delete(k); }
  entry._doc?.then(d => d.destroy()).catch(() => {});
  entry._doc = null;
}

// 흰 여백 찾기: 내용이 있는 영역 바깥 여백(mm, 보이는 방향). pages: 볼 쪽 번호들(0부터)
export async function findMargins(entry, pages) {
  const doc = await openDoc(entry);
  let best = null;
  for (const idx of pages.slice(0, 40)) {
    const page = await doc.getPage(idx + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 500 / Math.max(vp1.width, vp1.height) });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const { data, width: W, height: H } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      if (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) continue; // 빈 쪽
    const px = vp1.width / W / MM; // 1px = ? mm
    const m = { t: y0 * px, b: (H - 1 - y1) * px, l: x0 * px, r: (W - 1 - x1) * px };
    best = best ? { t: Math.min(best.t, m.t), b: Math.min(best.b, m.b), l: Math.min(best.l, m.l), r: Math.min(best.r, m.r) } : m;
  }
  if (!best) return { t: 0, b: 0, l: 0, r: 0 };
  // 내용에 바짝 붙지 않게 3mm 남기고 0.5mm 단위로
  const f = (v) => Math.max(0, Math.floor((v - 3) * 2) / 2);
  return { t: f(best.t), b: f(best.b), l: f(best.l), r: f(best.r) };
}
