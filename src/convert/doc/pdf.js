// 블록 → PDF 조판 (pdf-lib + 나눔 글꼴)
import { htmlToBlocks, toEmbeddable } from './blocks.js';

export const PAPER_PT = { A4: [595.28, 841.89], A5: [419.53, 595.28], B5: [498.9, 708.66], Letter: [612, 792] };
export const MARGIN_PT = { '좁게': 36, '보통': 64, '넓게': 96 };

const fontCache = {};
export async function fontBytes(name) {
  if (!fontCache[name]) fontCache[name] = fetch(`/fonts/${name}.ttf`).then(r => { if (!r.ok) throw new Error('글꼴을 불러오지 못했어요'); return r.arrayBuffer(); });
  return fontCache[name];
}

// pdf-lib 기본 fontkit(1.x)은 한글 글꼴 서브셋을 깨뜨린다. fontkit 2를 pdf-lib 방식에 맞춰 연결한다.
let fontkitShim = null;
export async function getFontkit() {
  if (fontkitShim) return fontkitShim;
  const fk = await import('fontkit');
  const base = fk.default || fk;
  fontkitShim = {
    create(buf) {
      const font = base.create(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
      const createSubset = font.createSubset.bind(font);
      font.createSubset = () => {
        const sub = createSubset();
        // pdf-lib는 스트림(encodeStream)을 기대하지만 fontkit 2는 encode()만 있다
        sub.encodeStream = () => {
          const h = {};
          const api = { on(ev, cb) { h[ev] = cb; return api; } };
          setTimeout(() => { try { h.data?.(sub.encode()); h.end?.(); } catch (e) { h.error?.(e); } }, 0);
          return api;
        };
        return sub;
      };
      return font;
    },
  };
  return fontkitShim;
}

export async function newPdf() {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(await getFontkit());
  return { pdf, rgb };
}

// 한·중·일 문자 중 한 글자씩 줄을 바꿔도 되는 것 (한글은 어절 단위로 둔다)
const CJK_CHAR = /[⺀-⿿　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

export async function writePdf(doc, opts = {}, progress) {
  const { pdf, rgb } = await newPdf();
  const family = opts.font === '고딕' ? 'NanumGothic' : 'NanumMyeongjo';
  const [reg, bold] = await Promise.all([fontBytes(`${family}-Regular`), fontBytes(`${family}-Bold`)]);
  const F = { r: await pdf.embedFont(reg, { subset: true }), b: await pdf.embedFont(bold, { subset: true }) };
  const mono = family === 'NanumGothic' ? F.r : await pdf.embedFont(await fontBytes('NanumGothic-Regular'), { subset: true });
  pdf.setTitle(doc.title || '');
  pdf.setCreator('UCONVERT');

  const [PW, PH] = PAPER_PT[opts.paper] || PAPER_PT.A4;
  const M = MARGIN_PT[opts.margin] ?? 64;
  const CW = PW - M * 2;
  const BASE = PW < 450 ? 10 : 11;
  const ink = rgb(0.1, 0.1, 0.12), dim = rgb(0.42, 0.42, 0.46);

  // 이미지만 있는 책(만화 등)은 페이지마다 그림 하나
  if (doc.imagesOnly) {
    let i = 0;
    for (const c of doc.chapters) {
      for (const b of htmlToBlocks(c.html)) {
        if (b.type !== 'img') continue;
        const e = await toEmbeddable(b.src);
        if (!e) continue;
        const im = e.kind === 'png' ? await pdf.embedPng(e.bytes) : await pdf.embedJpg(e.bytes);
        if (opts.paper && opts.paper !== '원본' && PAPER_PT[opts.paper]) {
          const page = pdf.addPage([PW, PH]);
          const s = Math.min((PW - M * 2) / e.width, (PH - M * 2) / e.height);
          page.drawImage(im, { x: (PW - e.width * s) / 2, y: (PH - e.height * s) / 2, width: e.width * s, height: e.height * s });
        } else {
          const page = pdf.addPage([e.width * 0.75, e.height * 0.75]);
          page.drawImage(im, { x: 0, y: 0, width: e.width * 0.75, height: e.height * 0.75 });
        }
      }
      progress?.(0.6 + 0.35 * ++i / doc.chapters.length);
    }
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  let page = null, y = 0;
  const pages = [];
  const newPage = () => { page = pdf.addPage([PW, PH]); pages.push(page); y = PH - M; };
  const ensure = (h) => { if (!page || y - h < M) newPage(); };

  const wcache = new Map();
  const width = (font, size, t) => {
    const k = (font === F.b ? 'b' : font === mono ? 'm' : 'r') + size + '|' + t;
    let w = wcache.get(k);
    if (w === undefined) {
      try { w = font.widthOfTextAtSize(t, size); } catch { w = size * t.length * 0.6; }
      wcache.set(k, w);
    }
    return w;
  };

  // runs → 토큰 (줄바꿈 가능한 단위)
  const tokenize = (runs, size, forceFont) => {
    const toks = [];
    for (const r of runs) {
      if (r.br) { toks.push({ br: true }); continue; }
      const font = forceFont || (r.b ? F.b : F.r);
      const parts = r.text.match(/\s+|[^\s]+/g) || [];
      for (const p of parts) {
        if (/^\s+$/.test(p)) { toks.push({ t: ' ', font, size, space: true }); continue; }
        // 한자·가나는 글자 단위, 나머지(한글·영문)는 어절 단위
        let buf = '';
        for (const ch of p) {
          if (CJK_CHAR.test(ch)) { if (buf) toks.push({ t: buf, font, size, glue: true }); buf = ''; toks.push({ t: ch, font, size, glue: true }); }
          else buf += ch;
        }
        if (buf) toks.push({ t: buf, font, size });
        // 공백 없이 이어진 조각들은 한 단어 취급하지 않고 글자 사이에서 끊을 수 있게 둔다
      }
    }
    return toks;
  };

  const layoutLines = (toks, maxW) => {
    const lines = [];
    let line = [], w = 0;
    const push = () => { while (line.length && line[line.length - 1].space) { w -= line[line.length - 1].w; line.pop(); } lines.push({ items: line, w }); line = []; w = 0; };
    for (const tk of toks) {
      if (tk.br) { push(); continue; }
      if (tk.space && !line.length) continue;
      const tw = width(tk.font, tk.size, tk.t);
      if (w + tw > maxW && line.length) {
        push();
        if (tk.space) continue;
      }
      if (tw > maxW) {
        // 너무 긴 단어는 글자 단위로 자른다
        let buf = '';
        for (const ch of tk.t) {
          const cw = width(tk.font, tk.size, buf + ch);
          if (w + cw > maxW && buf) { line.push({ ...tk, t: buf, w: width(tk.font, tk.size, buf) }); w += width(tk.font, tk.size, buf); push(); buf = ch; }
          else buf += ch;
        }
        if (buf) { const bw = width(tk.font, tk.size, buf); line.push({ ...tk, t: buf, w: bw }); w += bw; }
        continue;
      }
      line.push({ ...tk, w: tw }); w += tw;
    }
    if (line.length) push();
    return lines;
  };

  const drawLines = (lines, x0, size, lh, color, align) => {
    for (const ln of lines) {
      ensure(lh);
      y -= lh;
      let x = x0 + (align === 'center' ? (CW - (x0 - M) - ln.w) / 2 : 0);
      // 같은 글꼴이 이어지면 한 번에 그린다
      let buf = '', bf = null, bx = x;
      const out = () => { if (buf) { try { page.drawText(buf, { x: bx, y: y + lh * 0.22, size, font: bf, color }); } catch { /* 글꼴에 없는 글자 */ } } };
      for (const it of ln.items) {
        if (it.font !== bf) { out(); buf = ''; bf = it.font; bx = x; }
        buf += it.t; x += it.w;
      }
      out();
    }
  };

  const blocks = doc.chapters.flatMap((c, i) => (i ? [{ type: 'break' }] : []).concat(htmlToBlocks(c.html)));
  const HS = [2, 1.6, 1.35, 1.2, 1.1, 1.05];
  let n = 0;
  newPage();
  for (const b of blocks) {
    if (++n % 40 === 0) progress?.(0.6 + 0.35 * n / blocks.length);
    if (b.type === 'break') { if (y < PH - M - 1) newPage(); continue; }
    if (b.type === 'h') {
      const size = BASE * HS[b.level - 1];
      const lines = layoutLines(tokenize(b.runs, size, F.b), CW);
      const need = lines.length * size * 1.4 + size * 2;
      if (y - need < M) newPage();
      else if (y < PH - M - 1) y -= size * (b.level <= 2 ? 1.2 : 0.8);
      drawLines(lines, M, size, size * 1.4, ink);
      y -= size * 0.5;
      continue;
    }
    if (b.type === 'p') {
      const ind = (b.indent || 0) * 14;
      const toks = tokenize(b.bullet ? [{ text: b.bullet + ' ' }, ...b.runs] : b.runs, BASE);
      const lines = layoutLines(toks, CW - ind);
      drawLines(lines, M + ind, BASE, BASE * 1.7, b.quote ? dim : ink);
      y -= BASE * 0.6;
      continue;
    }
    if (b.type === 'pre') {
      const size = BASE * 0.85;
      const lines = layoutLines(tokenize(b.text.split('\n').flatMap((l, i) => i ? [{ br: true }, { text: l }] : [{ text: l }]), size, mono), CW - 12);
      drawLines(lines, M + 12, size, size * 1.5, dim);
      y -= BASE * 0.6;
      continue;
    }
    if (b.type === 'table') {
      for (const row of b.rows) {
        const runs = row.flatMap((c, i) => (i ? [{ text: '   ·   ' }] : []).concat(c));
        drawLines(layoutLines(tokenize(runs, BASE * 0.92), CW), M, BASE * 0.92, BASE * 1.5, ink);
      }
      y -= BASE * 0.6;
      continue;
    }
    if (b.type === 'hr') {
      ensure(BASE * 2); y -= BASE;
      page.drawLine({ start: { x: M + CW * 0.35, y }, end: { x: M + CW * 0.65, y }, thickness: 0.6, color: dim });
      y -= BASE; continue;
    }
    if (b.type === 'img') {
      const e = await toEmbeddable(b.src);
      if (!e) continue;
      let im;
      try { im = e.kind === 'png' ? await pdf.embedPng(e.bytes) : await pdf.embedJpg(e.bytes); } catch { continue; }
      const maxH = PH - M * 2;
      let w = Math.min(CW, e.width * 0.75), h = e.height * (w / e.width);
      if (h > maxH) { h = maxH; w = e.width * (h / e.height); }
      if (y - h < M) newPage();
      y -= h;
      page.drawImage(im, { x: M + (CW - w) / 2, y, width: w, height: h });
      y -= BASE * 0.8;
    }
  }

  // 쪽 번호
  const total = pages.length;
  if (total > 1) pages.forEach((p, i) => {
    const t = String(i + 1);
    p.drawText(t, { x: (PW - width(F.r, 8.5, t)) / 2, y: M * 0.45, size: 8.5, font: F.r, color: dim });
  });
  progress?.(0.97);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
