// 각종 문서·전자책을 공통 모델로 읽는다.
// DocModel = { title, chapters: [{ title, html }] }  (이미지는 data: URL로 html 안에 포함)
import { escapeHtml, bytesToDataUrl, sniffImageMime } from './blocks.js';

const baseName = (n) => n.replace(/\.[^.]+$/, '').replace(/\.tar$/, '');

export async function readDoc(file, ext, progress) {
  const title = baseName(file.name);
  switch (ext) {
    case 'txt': return { title, chapters: [{ title, html: textToHtml(await readText(file)) }] };
    case 'md': {
      const { marked } = await import('marked');
      return { title, chapters: [{ title, html: marked.parse(await readText(file)) }] };
    }
    case 'html': return readHtml(await readText(file), title);
    case 'docx': {
      const mammoth = (await import('mammoth')).default;
      const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      return { title, chapters: [{ title, html: r.value }] };
    }
    case 'odt': return readOdf(file, title, false);
    case 'odp': return readOdf(file, title, true);
    case 'rtf': return { title, chapters: [{ title, html: rtfToHtml(new Uint8Array(await file.arrayBuffer())) }] };
    case 'pdf': return readPdf(file, title, progress);
    case 'pptx': return readPptx(file, title);
    case 'epub': return (await import('../ebook/epub.js')).readEpub(file, title);
    case 'mobi': case 'azw3': return (await import('../ebook/mobi.js')).readMobi(file, title);
    case 'fb2': return (await import('../ebook/fb2.js')).readFb2(file, title);
    case 'cbz': return readCbz(file, title);
  }
  throw new Error('이 형식은 읽을 수 없어요');
}

// 텍스트 파일 인코딩 추정 (UTF-8 실패 시 EUC-KR)
export async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); }
}

function textToHtml(t) {
  return t.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => p.trim() ? `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>` : '').join('\n');
}

function readHtml(src, fallbackTitle) {
  const d = new DOMParser().parseFromString(src, 'text/html');
  d.querySelectorAll('script,style,link,iframe,object,embed').forEach(e => e.remove());
  // 외부 이미지는 가져올 수 없으므로 뺀다 (data: 이미지는 유지)
  d.querySelectorAll('img').forEach(i => { if (!/^data:/.test(i.getAttribute('src') || '')) i.remove(); });
  const title = d.title?.trim() || fallbackTitle;
  return { title, chapters: [{ title, html: d.body.innerHTML }] };
}

/* ---------- ODT / ODP ---------- */
async function readOdf(file, title, isPresentation) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('ODF 파일 구조가 올바르지 않아요');
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  const imgCache = {};
  const img = async (href) => {
    if (imgCache[href] !== undefined) return imgCache[href];
    const f = zip.file(href.replace(/^\.\//, ''));
    if (!f) return (imgCache[href] = null);
    const b = await f.async('uint8array');
    const mime = sniffImageMime(b);
    return (imgCache[href] = mime ? bytesToDataUrl(b, mime) : null);
  };

  const walk = async (n) => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { s += escapeHtml(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (ln === 'h') { const lv = Math.min(6, +(c.getAttribute('text:outline-level') || 1)); s += `<h${lv}>${await walk(c)}</h${lv}>`; }
      else if (ln === 'p') s += `<p>${await walk(c)}</p>`;
      else if (ln === 'span' || ln === 'a' || ln === 'frame' || ln === 'text-box' || ln === 'section' || ln === 'list-header') s += await walk(c);
      else if (ln === 'list') s += `<ul>${await walk(c)}</ul>`;
      else if (ln === 'list-item') s += `<li>${await walk(c)}</li>`;
      else if (ln === 's') s += ' '.repeat(+(c.getAttribute('text:c') || 1));
      else if (ln === 'tab') s += ' ';
      else if (ln === 'line-break') s += '<br>';
      else if (ln === 'table') s += `<table>${await walk(c)}</table>`;
      else if (ln === 'table-row') s += `<tr>${await walk(c)}</tr>`;
      else if (ln === 'table-cell') s += `<td>${await walk(c)}</td>`;
      else if (ln === 'table-header-rows' || ln === 'table-rows') s += await walk(c);
      else if (ln === 'image') { const src = await img(c.getAttribute('xlink:href') || ''); if (src) s += `<img src="${src}">`; }
      else if (ln === 'note' || ln === 'annotation' || ln === 'tracked-changes' || ln === 'sequence-decls') { /* 건너뜀 */ }
      else s += await walk(c);
    }
    return s;
  };

  if (isPresentation) {
    const pages = [...d.getElementsByTagNameNS('*', 'page')];
    const chapters = [];
    let i = 0;
    for (const p of pages) {
      i++;
      const html = await walk(p);
      chapters.push({ title: `슬라이드 ${i}`, html: `<h2>슬라이드 ${i}</h2>${html}` });
    }
    return { title, chapters };
  }
  const body = d.getElementsByTagNameNS('*', 'text')[0] || d.documentElement;
  return { title, chapters: [{ title, html: await walk(body) }] };
}

/* ---------- PPTX ---------- */
async function readPptx(file, title) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  if (!slides.length) throw new Error('슬라이드를 찾지 못했어요');
  const chapters = [];
  let i = 0;
  for (const s of slides) {
    i++;
    const d = new DOMParser().parseFromString(await zip.file(s).async('string'), 'application/xml');
    const paras = [...d.getElementsByTagNameNS('*', 'p')].filter(p => p.namespaceURI?.includes('drawingml'));
    const lines = paras.map(p => [...p.getElementsByTagNameNS('*', 't')].map(t => t.textContent).join('')).filter(t => t.trim());
    const [head, ...rest] = lines;
    const html = `<h2>${escapeHtml(head || `슬라이드 ${i}`)}</h2>` + rest.map(t => `<p>${escapeHtml(t)}</p>`).join('');
    chapters.push({ title: head || `슬라이드 ${i}`, html });
  }
  return { title, chapters };
}

/* ---------- CBZ ---------- */
async function readCbz(file, title) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) throw new Error('만화책 안에 이미지가 없어요');
  const chapters = [];
  for (const n of names) {
    const b = await zip.file(n).async('uint8array');
    const mime = sniffImageMime(b) || 'image/jpeg';
    chapters.push({ title: n.split('/').pop(), html: `<img src="${bytesToDataUrl(b, mime)}" alt="">` });
  }
  return { title, chapters, imagesOnly: true };
}

/* ---------- PDF (글자만) ---------- */
export async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

async function readPdf(file, title, progress) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const meta = await pdf.getMetadata().catch(() => null);
  const docTitle = meta?.info?.Title?.trim() || title;
  let html = '';
  let total = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // 줄 단위로 묶기
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(cur.y - y) > h * 0.5) { cur = { y, h, text: '' }; lines.push(cur); }
      cur.text += it.str;
      if (it.hasEOL) cur = null;
    }
    // 문단 나누기: 줄 간격이 평소보다 크면 새 문단
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
    const typical = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)] : 0;
    let para = '';
    const paras = [];
    lines.forEach((l, i) => {
      const t = l.text.replace(/\s+/g, ' ').trim();
      if (!t) return;
      const gap = i ? Math.abs(lines[i - 1].y - l.y) : 0;
      if (para && typical && gap > typical * 1.45) { paras.push(para); para = ''; }
      para = para ? (/[-‐]$/.test(para) ? para.slice(0, -1) + t : para + (/[가-힣]$/.test(para) && /^[가-힣]/.test(t) ? ' ' : ' ') + t) : t;
    });
    if (para) paras.push(para);
    total += paras.length;
    html += paras.map(t => `<p>${escapeHtml(t)}</p>`).join('\n');
    progress?.(p / pdf.numPages * 0.6);
  }
  if (!total) throw new Error('이 PDF에는 글자 정보가 없어요 (스캔한 이미지 PDF일 수 있어요)');
  return { title: docTitle, chapters: [{ title: docTitle, html }] };
}

/* ---------- RTF ---------- */
function rtfToHtml(bytes) {
  const src = new TextDecoder('latin1').decode(bytes);
  let cp = 'windows-1252';
  const m = src.match(/\\ansicpg(\d+)/);
  if (m) cp = { 949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 65001: 'utf-8' }[m[1]] || `windows-${m[1]}`;
  let dec;
  try { dec = new TextDecoder(cp); } catch { dec = new TextDecoder('windows-1252'); }

  const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'object', 'fldinst', 'bkmkstart', 'bkmkend', 'field', 'fldrslt_skip']);
  const paras = [];
  let cur = '', bytesBuf = [];
  let stack = [], skip = false, uc = 1, skipChars = 0, bold = false;
  const flushBytes = () => { if (bytesBuf.length) { cur += dec.decode(new Uint8Array(bytesBuf)); bytesBuf = []; } };
  const emit = (t) => { if (skip) return; if (skipChars > 0) { const n = Math.min(skipChars, t.length); skipChars -= n; t = t.slice(n); } flushBytes(); cur += escapeHtml(t); };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') { flushBytes(); stack.push({ skip, uc, bold }); i++; if (src.startsWith('\\*', i)) { skip = true; } continue; }
    if (ch === '}') { flushBytes(); const s = stack.pop(); if (s) ({ skip, uc } = s); i++; continue; }
    if (ch === '\\') {
      const nx = src[i + 1];
      if (nx === "'") {
        const hex = src.substr(i + 2, 2);
        if (!skip) { if (skipChars > 0) skipChars--; else bytesBuf.push(parseInt(hex, 16)); }
        i += 4; continue;
      }
      if (nx === '\\' || nx === '{' || nx === '}') { emit(nx); i += 2; continue; }
      if (nx === '~') { emit(' '); i += 2; continue; }
      if (nx === '\n' || nx === '\r') { if (!skip) { flushBytes(); paras.push(cur); cur = ''; } i += 2; continue; }
      const mm = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!mm) { i += 2; continue; }
      i += mm[0].length;
      const w = mm[1], arg = mm[2] !== undefined ? +mm[2] : null;
      if (SKIP_DEST.has(w)) { skip = true; continue; }
      if (skip) continue;
      if (w === 'par' || w === 'sect') { flushBytes(); paras.push(cur); cur = ''; }
      else if (w === 'line') emit('\n');
      else if (w === 'tab') emit(' ');
      else if (w === 'uc') uc = arg ?? 1;
      else if (w === 'u') { flushBytes(); let c = arg; if (c < 0) c += 65536; cur += escapeHtml(String.fromCharCode(c)); skipChars = uc; }
      else if (w === 'emdash') emit('—');
      else if (w === 'endash') emit('–');
      else if (w === 'bullet') emit('•');
      else if (w === 'lquote') emit('‘'); else if (w === 'rquote') emit('’');
      else if (w === 'ldblquote') emit('“'); else if (w === 'rdblquote') emit('”');
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    emit(ch); i++;
  }
  flushBytes();
  if (cur) paras.push(cur);
  return paras.map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '').join('\n');
}
