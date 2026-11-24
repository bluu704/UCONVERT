// EPUB 읽기 → DocModel
import { bytesToDataUrl, sniffImageMime } from '../doc/blocks.js';

export async function readEpub(file, fallbackTitle) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  // 글꼴 난독화(idpf/adobe)는 괜찮고, 그 밖의 암호화는 DRM
  const encXml = await zip.file('META-INF/encryption.xml')?.async('string');
  if (encXml) {
    const algos = [...encXml.matchAll(/Algorithm="([^"]+)"/g)].map(m => m[1]);
    const fontOnly = algos.every(a => /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a));
    if (algos.length && !fontOnly) throw new Error('DRM 보호 파일이라 변환할 수 없어요');
  }
  if (zip.file('META-INF/rights.xml')) throw new Error('DRM 보호 파일이라 변환할 수 없어요');
  const container = await zip.file('META-INF/container.xml')?.async('string');
  if (!container) throw new Error('EPUB 구조가 올바르지 않아요');
  const opfPath = new DOMParser().parseFromString(container, 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
  const opfText = await zip.file(opfPath)?.async('string');
  if (!opfText) throw new Error('EPUB 목차 파일(OPF)을 찾지 못했어요');
  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || fallbackTitle;

  const items = {};
  for (const it of opf.getElementsByTagNameNS('*', 'item')) items[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') };
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')].map(r => items[r.getAttribute('idref')]).filter(Boolean);

  const resolve = (from, href) => {
    const parts = (from.slice(0, from.lastIndexOf('/') + 1) + href).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return decodeURIComponent(out.join('/').split('#')[0]);
  };
  const imgCache = new Map();
  const loadImg = async (path) => {
    if (imgCache.has(path)) return imgCache.get(path);
    const f = zip.file(path);
    let url = null;
    if (f) { const b = await f.async('uint8array'); const m = sniffImageMime(b); if (m) url = bytesToDataUrl(b, m); }
    imgCache.set(path, url);
    return url;
  };

  const chapters = [];
  for (const it of spine) {
    if (!/x?html/.test(it.type || 'xhtml')) continue;
    const path = resolve(base, it.href);
    const src = await zip.file(path)?.async('string');
    if (!src) continue;
    let d = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(src, 'text/html');
    const body = d.body || d.getElementsByTagName('body')[0];
    if (!body) continue;
    for (const img of [...body.querySelectorAll('img, image')]) {
      const href = img.getAttribute('src') || img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const url = href ? await loadImg(resolve(path, href)) : null;
      if (!url) { img.remove(); continue; }
      if (img.localName === 'image') {
        const n = d.createElementNS('http://www.w3.org/1999/xhtml', 'img');
        n.setAttribute('src', url);
        (img.closest('svg') || img).replaceWith(n);
      } else img.setAttribute('src', url);
    }
    body.querySelectorAll('script,style,link').forEach(e => e.remove());
    const html = new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>/, '').replace(/<\/body>\s*$/, '');
    const text = body.textContent.trim();
    if (!text && !body.querySelector('img')) continue;
    const t = body.querySelector('h1,h2,h3')?.textContent.trim() || d.title || `${chapters.length + 1}`;
    chapters.push({ title: t.slice(0, 80), html });
  }
  if (!chapters.length) throw new Error('책 내용을 찾지 못했어요');
  return { title, chapters };
}
