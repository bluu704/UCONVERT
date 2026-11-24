// HTML을 단순한 "블록" 목록으로 바꾼다. PDF/DOCX/RTF/ODT/TXT 출력이 모두 이것을 쓴다.
// 블록: {type:'h', level, runs} | {type:'p', runs, indent, bullet} | {type:'pre', text}
//       {type:'img', src, alt} | {type:'hr'} | {type:'table', rows:[[runs]]} | {type:'break'}
// run:  {text, b, i, u} | {br:true}

const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'hr', 'dl', 'dt', 'dd', 'body', 'address', 'center']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'svg:style']);

export function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return nodeToBlocks(doc.body);
}

export function nodeToBlocks(root) {
  const out = [];
  let runs = [];
  const ctx = { indent: 0, bullet: null };

  const flush = (extra = {}) => {
    // 앞뒤 공백 정리
    while (runs.length && !runs[0].br && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs[runs.length - 1].br && !runs[runs.length - 1].text.trim()) runs.pop();
    if (runs.length && runs[0].text) runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') };
    if (runs.length) {
      const last = runs[runs.length - 1];
      if (last.text) runs[runs.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
    }
    if (runs.some(r => r.br || r.text)) out.push({ type: 'p', runs, indent: ctx.indent, bullet: ctx.bullet, ...extra });
    runs = [];
    ctx.bullet = null;
  };

  const inline = (node, st) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(/[\t\n\r ]+/g, ' ');
      if (t) runs.push({ text: t, b: st.b, i: st.i, u: st.u });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'br') { runs.push({ br: true }); return; }
    if (tag === 'img' || tag === 'image') { flush(); pushImg(node); return; }
    if (BLOCK.has(tag)) { block(node); return; }
    const s = { ...st };
    if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag)) s.b = true;
    if (tag === 'i' || tag === 'em' || tag === 'cite') s.i = true;
    if (tag === 'u') s.u = true;
    const fw = node.getAttribute?.('style')?.match(/font-weight\s*:\s*(bold|[6-9]00)/);
    if (fw) s.b = true;
    for (const c of node.childNodes) inline(c, s);
  };

  const pushImg = (node) => {
    const src = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href') || node.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
    if (src && /^(data:|blob:)/.test(src)) out.push({ type: 'img', src, alt: node.getAttribute('alt') || '' });
  };

  const textOf = (n) => (n.textContent || '');

  const block = (node) => {
    const tag = node.localName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'hr') { flush(); out.push({ type: 'hr' }); return; }
    if (tag === 'pre') { flush(); out.push({ type: 'pre', text: textOf(node).replace(/\n$/, '') }); return; }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      const save = runs; runs = [];
      for (const c of node.childNodes) inline(c, { b: true });
      const r = runs.filter(x => x.br || x.text); runs = save;
      const txt = r.map(x => x.text || '').join('').trim();
      if (txt) out.push({ type: 'h', level: +tag[1], runs: r.map((x, i) => i === 0 && x.text ? { ...x, text: x.text.replace(/^\s+/, '') } : x) });
      return;
    }
    if (tag === 'table') {
      flush();
      const rows = [];
      for (const tr of node.querySelectorAll('tr')) {
        const cells = [];
        for (const td of tr.children) {
          if (!/^t[dh]$/i.test(td.localName)) continue;
          const t = td.textContent.replace(/\s+/g, ' ').trim();
          cells.push([{ text: t, b: td.localName.toLowerCase() === 'th' }]);
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) out.push({ type: 'table', rows });
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      flush();
      let n = 0;
      ctx.indent++;
      for (const li of node.children) {
        if (li.localName?.toLowerCase() !== 'li') { block(li); continue; }
        n++;
        ctx.bullet = tag === 'ol' ? `${n}.` : '•';
        for (const c of li.childNodes) {
          if (c.nodeType === 1 && (c.localName === 'ul' || c.localName === 'ol')) { flush(); block(c); }
          else inline(c, {});
        }
        flush();
      }
      ctx.indent--;
      return;
    }
    if (tag === 'blockquote') {
      flush(); ctx.indent++;
      for (const c of node.childNodes) inline(c, {});
      flush({ quote: true }); ctx.indent--;
      return;
    }
    flush();
    for (const c of node.childNodes) inline(c, {});
    flush();
  };

  for (const c of root.childNodes) inline(c, {});
  flush();
  return out;
}

export function runsText(runs) {
  return runs.map(r => (r.br ? '\n' : r.text)).join('');
}

// 블록 → 일반 텍스트
export function blocksToText(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.type === 'h') lines.push(runsText(b.runs), '');
    else if (b.type === 'p') {
      // 목록 항목끼리는 빈 줄 없이 붙인다
      if (b.bullet && lines.length && lines[lines.length - 1] === '' && /^\s*(•|\d+\.) /.test(lines[lines.length - 2] || '')) lines.pop();
      lines.push('  '.repeat(Math.max(0, (b.indent || 0) - (b.bullet ? 1 : 0))) + (b.bullet ? b.bullet + ' ' : '') + runsText(b.runs), '');
    }
    else if (b.type === 'pre') lines.push(b.text, '');
    else if (b.type === 'hr') lines.push('----------', '');
    else if (b.type === 'table') { for (const r of b.rows) lines.push(r.map(c => runsText(c)).join('\t')); lines.push(''); }
    else if (b.type === 'break') lines.push('', '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// data: URL → {bytes, mime}
export function dataUrlToBytes(url) {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime };
}

export function bytesToDataUrl(bytes, mime) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}

export function sniffImageMime(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 200));
  if (/<svg/i.test(head)) return 'image/svg+xml';
  return null;
}

// 어떤 이미지든 PNG/JPEG 바이트로 (PDF·DOCX에 넣을 수 있게)
export async function toEmbeddable(src) {
  const d = dataUrlToBytes(src);
  if (!d) return null;
  let mime = sniffImageMime(d.bytes) || d.mime;
  if (mime === 'image/jpeg' || mime === 'image/png') {
    const dim = await imageSize(new Blob([d.bytes], { type: mime }));
    return dim ? { bytes: d.bytes, kind: mime === 'image/png' ? 'png' : 'jpg', ...dim } : null;
  }
  // 그 밖의 형식은 캔버스로 PNG 변환
  try {
    const blob = new Blob([d.bytes], { type: mime });
    const img = await loadImage(blob);
    const c = document.createElement('canvas');
    c.width = img.width || 800; c.height = img.height || 600;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const png = await new Promise(r => c.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await png.arrayBuffer()), kind: 'png', width: c.width, height: c.height };
  } catch { return null; }
}

async function imageSize(blob) {
  try { const b = await createImageBitmap(blob); const r = { width: b.width, height: b.height }; b.close(); return r; }
  catch { try { const i = await loadImage(blob); return { width: i.width, height: i.height }; } catch { return null; } }
}

export function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { const w = img.naturalWidth, h = img.naturalHeight; res(Object.assign(img, { width: w || 800, height: h || 600 })); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했어요')); };
    img.src = url;
  });
}
