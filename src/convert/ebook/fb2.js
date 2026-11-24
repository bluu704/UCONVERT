// FictionBook 2 읽기 → DocModel
import { escapeHtml } from '../doc/blocks.js';
import { readText } from '../doc/readers.js';

export async function readFb2(file, fallbackTitle) {
  let src = await readText(file);
  const enc = src.match(/encoding="([^"]+)"/i)?.[1];
  if (enc && !/utf-?8/i.test(enc)) {
    try { src = new TextDecoder(enc).decode(new Uint8Array(await file.arrayBuffer())); } catch { /* 그대로 */ }
  }
  const d = new DOMParser().parseFromString(src, 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('FB2 파일을 읽지 못했어요');
  const title = d.getElementsByTagNameNS('*', 'book-title')[0]?.textContent.trim() || fallbackTitle;
  const bins = {};
  for (const b of d.getElementsByTagNameNS('*', 'binary')) bins[b.getAttribute('id')] = `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`;

  const conv = (n, depth) => {
    let s = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { s += escapeHtml(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      switch (c.localName) {
        case 'title': s += `<h${Math.min(6, depth + 1)}>${[...c.children].map(p => conv(p, depth)).join(' ')}</h${Math.min(6, depth + 1)}>`; break;
        case 'subtitle': s += `<h${Math.min(6, depth + 2)}>${conv(c, depth)}</h${Math.min(6, depth + 2)}>`; break;
        case 'p': case 'v': case 'text-author': s += `<p>${conv(c, depth)}</p>`; break;
        case 'emphasis': s += `<em>${conv(c, depth)}</em>`; break;
        case 'strong': s += `<strong>${conv(c, depth)}</strong>`; break;
        case 'empty-line': s += '<br>'; break;
        case 'epigraph': case 'cite': s += `<blockquote>${conv(c, depth)}</blockquote>`; break;
        case 'image': {
          const id = (c.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || c.getAttribute('l:href') || c.getAttribute('xlink:href') || '').replace(/^#/, '');
          if (bins[id]) s += `<img src="${bins[id]}" alt="">`;
          break;
        }
        case 'section': s += conv(c, depth + 1); break;
        default: s += conv(c, depth);
      }
    }
    return s;
  };

  const body = d.getElementsByTagNameNS('*', 'body')[0];
  if (!body) throw new Error('책 내용을 찾지 못했어요');
  const secs = [...body.children].filter(c => c.localName === 'section');
  const chapters = secs.length
    ? secs.map((s, i) => ({ title: s.getElementsByTagNameNS('*', 'title')[0]?.textContent.trim().slice(0, 80) || `${i + 1}`, html: conv(s, 1) }))
    : [{ title, html: conv(body, 1) }];
  return { title, chapters };
}
