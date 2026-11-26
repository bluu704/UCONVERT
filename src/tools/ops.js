// PDF 도구: 합치기·나누기·쪽 정리·쪽 번호·워터마크·암호·자르기/여백 (모두 브라우저 안에서)
import { fontBytes, getFontkit } from '../convert/doc/pdf.js';

const MM = 72 / 25.4;
let lib = null;
async function pdfLib() { return lib || (lib = await import('pdf-lib')); }

export const baseName = (n) => n.replace(/\.pdf$/i, '');
const safeName = (n) => n.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document';

export function needPassword(msg) { const e = new Error(msg); e.code = 'PDF_LOCKED'; return e; }

async function load(file) {
  const { PDFDocument } = await pdfLib();
  try {
    return await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw needPassword(`${file.name}: 암호가 걸린 PDF예요. 암호 도구에서 먼저 풀어 주세요`);
    throw new Error(`${file.name}: PDF를 읽지 못했어요`);
  }
}
const out = (pdf) => pdf.save({ useObjectStreams: true });
const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

async function zipOf(items, zipName) {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  for (const it of items) z.file(it.name, it.bytes);
  return { blob: await z.generateAsync({ type: 'blob', mimeType: 'application/zip' }), name: zipName };
}

/* ---------- 쪽을 눈에 보이는 방향으로 다루기 ---------- */
// 회전된 쪽에서도 '위·아래·왼쪽·오른쪽'이 화면에 보이는 대로 맞도록 좌표를 바꾼다
function frame(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const { x, y, width: w, height: h } = box;
  const side = rot % 180 === 0;
  const VW = side ? w : h, VH = side ? h : w;
  const toOrig = (vx, vy) => {
    if (rot === 90) return { x: x + w - vy, y: y + vx };
    if (rot === 180) return { x: x + w - vx, y: y + h - vy };
    if (rot === 270) return { x: x + vy, y: y + h - vx };
    return { x: x + vx, y: y + vy };
  };
  // 보이는 쪽 기준 위/아래/왼/오른 → 원래 쪽의 위/아래/왼/오른
  const sides = ({ t, b, l, r }) => (
    rot === 90 ? { L: t, T: r, R: b, B: l } :
    rot === 180 ? { B: t, T: b, R: l, L: r } :
    rot === 270 ? { R: t, B: r, T: l, L: b } : { T: t, B: b, L: l, R: r });
  return { box, rot, VW, VH, toOrig, sides };
}
// (cx,cy)를 중심으로 각도 a(도, 반시계)만큼 돌린 글자/이미지를 그릴 때의 시작점
function rotatedOrigin(cx, cy, w, h, a) {
  const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: cx - (c * w / 2 - s * h / 2), y: cy - (s * w / 2 + c * h / 2) };
}
async function koreanFont(pdf, bold) {
  pdf.registerFontkit(await getFontkit());
  return pdf.embedFont(await fontBytes(bold ? 'NanumGothic-Bold' : 'NanumGothic-Regular'), { subset: true });
}

/* ---------- 합치기 ---------- */
export async function merge(files, outName, progress) {
  const { PDFDocument } = await pdfLib();
  const dst = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const src = await load(files[i]);
    const pages = await dst.copyPages(src, src.getPageIndices());
    pages.forEach(p => dst.addPage(p));
    progress?.((i + 1) / files.length * 0.9);
  }
  const name = safeName(baseName(outName || '합친문서')) + '.pdf';
  return { blob: pdfBlob(await out(dst)), name };
}

/* ---------- 나누기 ---------- */
export function parseRanges(text, total) {
  const groups = [];
  for (const part of String(text).split(/[,，\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*[-~]\s*(\d+)?$|^(\d+)$/);
    if (!m) throw new Error(`"${part}"은(는) 쪽 범위로 읽을 수 없어요`);
    let a, b;
    if (m[3]) a = b = +m[3]; else { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`${total}쪽까지만 있어요`);
    if (a > b) [a, b] = [b, a];
    groups.push([a, b]);
  }
  if (!groups.length) throw new Error('쪽 범위를 적어 주세요');
  return groups;
}
export function splitGroups(mode, total, range, every) {
  if (mode === 'one') return Array.from({ length: total }, (_, i) => [i + 1, i + 1]);
  if (mode === 'every') {
    const n = Math.max(1, Math.floor(+every || 1)); const g = [];
    for (let a = 1; a <= total; a += n) g.push([a, Math.min(total, a + n - 1)]);
    return g;
  }
  return parseRanges(range, total);
}
export async function split(file, groups, progress) {
  const { PDFDocument } = await pdfLib();
  const src = await load(file);
  const base = safeName(baseName(file.name));
  const items = [];
  for (let i = 0; i < groups.length; i++) {
    const [a, b] = groups[i];
    const dst = await PDFDocument.create();
    const pages = await dst.copyPages(src, Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k));
    pages.forEach(p => dst.addPage(p));
    items.push({ name: `${base}_${a === b ? a : `${a}-${b}`}.pdf`, bytes: await out(dst) });
    progress?.((i + 1) / groups.length * 0.9);
  }
  if (items.length === 1) return { blob: pdfBlob(items[0].bytes), name: items[0].name };
  return zipOf(items, `${base}_나눔.zip`);
}

/* ---------- 쪽 정리 ---------- */
// pages: [{src: 원래 쪽 번호(0부터) 또는 -1(빈 쪽), rot: 더할 각도, del}]
export async function organize(file, pages) {
  const { PDFDocument, degrees } = await pdfLib();
  const src = await load(file);
  const dst = await PDFDocument.create();
  const keep = pages.filter(p => !p.del);
  if (!keep.length) throw new Error('남은 쪽이 없어요');
  const copied = await dst.copyPages(src, keep.filter(p => p.src >= 0).map(p => p.src));
  let ci = 0, lastSize = src.getPage(0).getSize();
  for (const p of keep) {
    if (p.src < 0) { const pg = dst.addPage([lastSize.width, lastSize.height]); if (p.rot) pg.setRotation(degrees(p.rot)); continue; }
    const pg = dst.addPage(copied[ci++]);
    lastSize = pg.getSize();
    if (p.rot) pg.setRotation(degrees((pg.getRotation().angle + p.rot) % 360));
  }
  return { blob: pdfBlob(await out(dst)), name: `${safeName(baseName(file.name))}_정리.pdf` };
}

/* ---------- 쪽 번호 ---------- */
export const NUM_STYLES = [(n) => `${n}`, (n, t) => `${n} / ${t}`, (n) => `- ${n} -`, (n) => `${n}쪽`];
export async function pageNumbers(file, o) {
  const { rgb, degrees } = await pdfLib();
  const pdf = await load(file);
  const font = await koreanFont(pdf, false);
  const size = [9, 11, 14][o.size] ?? 11;
  const pages = pdf.getPages();
  const skip = o.skipFirst ? 1 : 0;
  const total = pages.length - skip + (o.start - 1);
  pages.forEach((page, i) => {
    if (i < skip) return;
    const text = NUM_STYLES[o.style](i - skip + o.start, total);
    const f = frame(page);
    const m = Math.min(f.VW, f.VH) * 0.045 + 6;
    const tw = font.widthOfTextAtSize(text, size);
    const vx = o.pos[1] === 'l' ? m : o.pos[1] === 'r' ? f.VW - m - tw : (f.VW - tw) / 2;
    const vy = o.pos[0] === 't' ? f.VH - m - size * 0.8 : m;
    const p = f.toOrig(vx, vy);
    page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(0.15, 0.16, 0.18), rotate: degrees(f.rot) });
  });
  return { blob: pdfBlob(await out(pdf)), name: `${safeName(baseName(file.name))}_번호.pdf` };
}

/* ---------- 워터마크 ---------- */
export const WM_COLORS = { '빨강': [0.82, 0.23, 0.19], '회색': [0.45, 0.47, 0.5], '파랑': [0.24, 0.36, 0.96] };
export async function watermark(file, o) {
  const { rgb, degrees } = await pdfLib();
  const pdf = await load(file);
  let font = null, img = null;
  if (o.kind === 'image') {
    if (!o.image) throw new Error('워터마크로 쓸 이미지를 골라 주세요');
    const bytes = new Uint8Array(await o.image.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!png && !jpg) throw new Error('워터마크 이미지는 PNG나 JPG만 돼요');
    img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } else {
    if (!o.text.trim()) throw new Error('워터마크 글자를 적어 주세요');
    font = await koreanFont(pdf, true);
  }
  const scale = [0.35, 0.55, 0.8][o.size] ?? 0.55;
  const [cr, cg, cb] = WM_COLORS[o.color] || WM_COLORS['빨강'];
  for (const page of pdf.getPages()) {
    const f = frame(page);
    const c = f.toOrig(f.VW / 2, f.VH / 2);
    const a = f.rot + o.angle;
    const span = Math.abs(o.angle) === 45 ? Math.hypot(f.VW, f.VH) * 0.9 : (o.angle ? f.VH : f.VW);
    if (img) {
      const w = Math.min(span * scale, img.width * 4), h = w * img.height / img.width;
      const p = rotatedOrigin(c.x, c.y, w, h, a);
      page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(a), opacity: o.opacity / 100 });
    } else {
      const text = o.text.trim();
      const size = Math.max(8, Math.min(200, span * scale / Math.max(1, font.widthOfTextAtSize(text, 1))));
      const w = font.widthOfTextAtSize(text, size), h = size * 0.72;
      const p = rotatedOrigin(c.x, c.y, w, h, a);
      page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(cr, cg, cb), opacity: o.opacity / 100, rotate: degrees(a) });
    }
  }
  return { blob: pdfBlob(await out(pdf)), name: `${safeName(baseName(file.name))}_워터마크.pdf` };
}

/* ---------- 자르기 · 여백 넣기 ---------- */
// per: 쪽마다 {t,b,l,r} (mm, 보이는 방향 기준)
export async function cropPad(file, mode, per) {
  const pdf = await load(file);
  pdf.getPages().forEach((page, i) => {
    const v = per(i); if (!v) return;
    const f = frame(page);
    const s = f.sides({ t: v.t * MM, b: v.b * MM, l: v.l * MM, r: v.r * MM });
    const { x, y, width: w, height: h } = f.box;
    if (mode === 'trim') {
      const nw = w - s.L - s.R, nh = h - s.T - s.B;
      if (nw < 36 || nh < 36) throw new Error(`${i + 1}쪽: 너무 많이 잘라서 남는 부분이 없어요`);
      page.setCropBox(x + s.L, y + s.B, nw, nh);
    } else {
      const nb = [x - s.L, y - s.B, w + s.L + s.R, h + s.T + s.B];
      page.setMediaBox(...nb); page.setCropBox(...nb);
      try { page.setBleedBox(...nb); page.setTrimBox(...nb); page.setArtBox(...nb); } catch { /* 없음 */ }
    }
  });
  return { blob: pdfBlob(await out(pdf)), name: `${safeName(baseName(file.name))}_${mode === 'trim' ? '자름' : '여백'}.pdf` };
}

/* ---------- 암호 (qpdf) ---------- */
let qpdfUrl = null;
async function qpdfRun(args, input) {
  const createModule = (await import('@neslinesli93/qpdf-wasm')).default;
  qpdfUrl ||= (await import('@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url')).default;
  const log = [];
  const q = await createModule({ locateFile: () => qpdfUrl, noInitialRun: true, print: () => {}, printErr: (t) => log.push(t) });
  q.FS.writeFile('/in.pdf', input);
  let code;
  try { code = q.callMain(args); } catch (e) { code = typeof e?.status === 'number' ? e.status : 2; if (!log.length) log.push(String(e?.message || e)); }
  let res = null;
  try { res = q.FS.readFile('/out.pdf'); } catch { /* 결과 없음 */ }
  // 3 = 경고만 있고 결과는 정상
  if ((code === 0 || code === 3) && res) return res;
  const msg = log.join(' ');
  if (/invalid password/i.test(msg)) { const e = new Error('암호가 틀렸어요'); e.code = 'WRONG_PASSWORD'; throw e; }
  throw new Error('PDF를 처리하지 못했어요');
}
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');

export async function lockPdf(file, pw, perm) {
  if (!pw) throw new Error('암호를 적어 주세요');
  // 암호는 '--이름=값' 형태로 넘긴다 (@로 시작하는 값을 파일 이름으로 읽지 않게)
  const args = ['--encrypt', `--user-password=${pw}`, `--owner-password=${randomKey()}`, '--bits=256',
    `--print=${perm.print ? 'full' : 'none'}`, `--extract=${perm.copy ? 'y' : 'n'}`, `--modify=${perm.modify ? 'all' : 'none'}`,
    '--', '/in.pdf', '/out.pdf'];
  const res = await qpdfRun(args, new Uint8Array(await file.arrayBuffer()));
  return { blob: pdfBlob(res), name: `${safeName(baseName(file.name))}_암호.pdf` };
}
export async function unlockPdf(file, pw) {
  const data = new Uint8Array(await file.arrayBuffer());
  // qpdf는 오류를 콘솔로만 내므로 암호가 맞는지는 pdf.js로 먼저 확인한다
  const pdfjs = await (await import('../convert/doc/readers.js')).getPdfjs();
  try { const d = await pdfjs.getDocument({ data: data.slice(), password: pw, isEvalSupported: false }).promise; d.destroy(); }
  catch (e) { if (e?.name === 'PasswordException') { const err = new Error('암호가 틀렸어요'); err.code = 'WRONG_PASSWORD'; throw err; } }
  const res = await qpdfRun([`--password=${pw}`, '--decrypt', '/in.pdf', '/out.pdf'], data);
  return { blob: pdfBlob(res), name: `${safeName(baseName(file.name))}_해제.pdf` };
}
export async function bundle(results, zipName) {
  if (results.length === 1) return results[0];
  const items = [];
  const used = new Set();
  for (const r of results) {
    let n = r.name, k = 2; while (used.has(n)) n = r.name.replace(/(\.[^.]+)?$/, ` (${k++})$1`); used.add(n);
    items.push({ name: n, bytes: new Uint8Array(await r.blob.arrayBuffer()) });
  }
  return zipOf(items, zipName);
}
