// 이미지 변환: 읽기(디코드) → 캔버스 → 쓰기(인코드)
import { loadImage } from './doc/blocks.js';
import { MIME } from '../formats.js';

export async function decodeImage(file, ext) {
  let blob = file;
  if (ext === 'heic') {
    const heic2any = (await import('heic2any')).default;
    const r = await heic2any({ blob: file, toType: 'image/png' });
    blob = Array.isArray(r) ? r[0] : r;
  }
  if (ext === 'tiff') {
    const UTIF = (await import('utif')).default || (await import('utif'));
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds.length) throw new Error('TIFF 파일을 읽지 못했어요');
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const c = canvas(ifds[0].width, ifds[0].height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), ifds[0].width, ifds[0].height), 0, 0);
    return c;
  }
  let src;
  if (ext === 'svg') {
    const text = await blob.text();
    const svgBlob = new Blob([text], { type: 'image/svg+xml' });
    const img = await loadImage(svgBlob);
    // 크기 정보가 없는 SVG는 1024px로
    let w = img.naturalWidth || 0, h = img.naturalHeight || 0;
    if (!w || !h) {
      const vb = text.match(/viewBox="[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/);
      const r = vb ? +vb[2] / +vb[1] : 1;
      w = 1024; h = Math.round(1024 * r);
    }
    const sc = Math.max(1, 1024 / Math.max(w, h));
    const c = canvas(Math.round(w * sc), Math.round(h * sc));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  try { src = await createImageBitmap(blob); }
  catch { src = await loadImage(blob); }
  const c = canvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  src.close?.();
  return c;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('이미지 저장에 실패했어요')), type, q));

export async function encodeImage(c, target, opts = {}) {
  const q = (opts.quality ?? 85) / 100;
  switch (target) {
    case 'png': return toBlob(c, 'image/png');
    case 'jpg': {
      // JPG는 투명을 못 담으므로 흰 배경을 깐다
      const w = canvas(c.width, c.height), x = w.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w.width, w.height); x.drawImage(c, 0, 0);
      return toBlob(w, 'image/jpeg', q);
    }
    case 'webp': {
      const b = await toBlob(c, MIME.webp, q);
      if (b.type === MIME.webp) return b;
      // Safari 등 WebP 저장이 안 되는 브라우저 → WebAssembly 인코더
      const { encode } = await import('@jsquash/webp');
      return new Blob([await encode(c.getContext('2d').getImageData(0, 0, c.width, c.height), { quality: q * 100 })], { type: MIME.webp });
    }
    case 'avif': {
      // 브라우저 캔버스는 AVIF 저장을 못 하므로 WebAssembly 인코더를 쓴다
      const { encode } = await import('@jsquash/avif');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return new Blob([await encode(data, { quality: Math.round(q * 72), speed: 7 })], { type: MIME.avif });
    }
    case 'bmp': return new Blob([bmp(c)], { type: MIME.bmp });
    case 'gif': {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const palette = quantize(data, 256, { format: 'rgba4444' });
      const index = applyPalette(data, palette, 'rgba4444');
      const g = GIFEncoder();
      g.writeFrame(index, c.width, c.height, { palette, transparent: palette.some(p => p[3] === 0), transparentIndex: Math.max(0, palette.findIndex(p => p[3] === 0)) });
      g.finish();
      return new Blob([g.bytes()], { type: MIME.gif });
    }
    case 'tiff': {
      const UTIF = (await import('utif')).default || (await import('utif'));
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return new Blob([UTIF.encodeImage(data.buffer, c.width, c.height)], { type: MIME.tiff });
    }
    case 'ico': return new Blob([await ico(c)], { type: MIME.ico });
    case 'svg': {
      const png = await toBlob(c, 'image/png');
      const b64 = await blobToBase64(png);
      return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><image width="${c.width}" height="${c.height}" xlink:href="data:image/png;base64,${b64}"/></svg>`], { type: MIME.svg });
    }
    case 'pdf': return imagesToPdf([c], opts);
  }
  throw new Error('이 형식으로는 저장할 수 없어요');
}

function blobToBase64(b) {
  return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
}

function bmp(c) {
  const { width: w, height: h } = c;
  const { data } = c.getContext('2d').getImageData(0, 0, w, h);
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h;
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = 54 + y * row;
    for (let x = 0; x < w; x++) {
      const a = data[src + x * 4 + 3] / 255, bg = 255 * (1 - a);
      out[dst + x * 3] = data[src + x * 4 + 2] * a + bg;
      out[dst + x * 3 + 1] = data[src + x * 4 + 1] * a + bg;
      out[dst + x * 3 + 2] = data[src + x * 4] * a + bg;
    }
  }
  return out;
}

// 여러 크기를 담은 ICO (PNG 내장 방식)
async function ico(c) {
  const sizes = [16, 32, 48, 64, 128, 256].filter(s => s <= Math.max(c.width, c.height, 16));
  const pngs = [];
  for (const s of sizes) {
    const t = canvas(s, s), x = t.getContext('2d');
    const sc = Math.min(s / c.width, s / c.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, (s - c.width * sc) / 2, (s - c.height * sc) / 2, c.width * sc, c.height * sc);
    pngs.push(new Uint8Array(await (await toBlob(t, 'image/png')).arrayBuffer()));
  }
  const head = 6 + 16 * pngs.length;
  const total = head + pngs.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true);
  let off = head;
  pngs.forEach((p, i) => {
    const s = sizes[i], e = 6 + i * 16;
    out[e] = s >= 256 ? 0 : s; out[e + 1] = s >= 256 ? 0 : s;
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, p.length, true); v.setUint32(e + 12, off, true);
    out.set(p, off); off += p.length;
  });
  return out;
}

// 이미지 여러 장 → PDF (한 장에 한 쪽)
export async function imagesToPdf(canvases, opts = {}) {
  const { newPdf, PAPER_PT, MARGIN_PT } = await import('./doc/pdf.js');
  const { pdf } = await newPdf();
  for (const c of canvases) {
    const jpgLike = !hasAlpha(c);
    const bytes = new Uint8Array(await (await (jpgLike ? encodeImage(c, 'jpg', { quality: 92 }) : toBlob(c, 'image/png'))).arrayBuffer());
    const im = jpgLike ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const paper = PAPER_PT[opts.paper];
    if (paper) {
      const [PW, PH] = c.width > c.height ? [paper[1], paper[0]] : paper;
      const M = MARGIN_PT[opts.margin] ?? 36;
      const s = Math.min((PW - M * 2) / c.width, (PH - M * 2) / c.height);
      pdf.addPage([PW, PH]).drawImage(im, { x: (PW - c.width * s) / 2, y: (PH - c.height * s) / 2, width: c.width * s, height: c.height * s });
    } else {
      pdf.addPage([c.width * 0.75, c.height * 0.75]).drawImage(im, { x: 0, y: 0, width: c.width * 0.75, height: c.height * 0.75 });
    }
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

function hasAlpha(c) {
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] < 250) return true;
  return false;
}

// PDF 각 쪽 → 이미지 (여러 쪽이면 ZIP)
export async function pdfToImages(file, target, opts, progress) {
  const { getPdfjs } = await import('./doc/readers.js');
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const outs = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const c = canvas(vp.width, vp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp, canvas: c }).promise;
    outs.push(await encodeImage(c, target, opts));
    progress?.(p / pdf.numPages * 0.9);
  }
  if (outs.length === 1) return { blob: outs[0] };
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pad = String(outs.length).length;
  outs.forEach((b, i) => zip.file(`${String(i + 1).padStart(pad, '0')}.${target}`, b));
  return { blob: await zip.generateAsync({ type: 'blob', mimeType: MIME.zip }), ext: 'zip' };
}
