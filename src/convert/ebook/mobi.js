// MOBI / AZW3(KF8) 읽기 → DocModel
// DRM이 없는 파일만 읽을 수 있다. 아마존에서 산 책은 대부분 DRM이 걸려 있다.
import { bytesToDataUrl, sniffImageMime } from '../doc/blocks.js';

export async function readMobi(file, fallbackTitle) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = new TextDecoder('latin1').decode(buf.subarray(60, 68));
  if (!/BOOKMOBI|TEXtREAd/.test(type)) throw new Error('MOBI 파일 형식이 아니에요');

  const n = dv.getUint16(76);
  const offs = [];
  for (let i = 0; i < n; i++) offs.push(dv.getUint32(78 + i * 8));
  offs.push(buf.length);
  const rec = (i) => buf.subarray(offs[i], offs[i + 1]);

  const parseHeader = (r0i) => {
    const r = rec(r0i);
    const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    const h = {
      compression: v.getUint16(0), textLength: v.getUint32(4), textRecords: v.getUint16(8), encryption: v.getUint16(12),
      base: r0i, encoding: 1252, firstImage: 0xffffffff, extraFlags: 0, version: 0, exth: {},
    };
    if (r.length > 20 && new TextDecoder('latin1').decode(r.subarray(16, 20)) === 'MOBI') {
      const hl = v.getUint32(20);
      h.encoding = v.getUint32(28);
      h.version = v.getUint32(36);
      h.firstImage = v.getUint32(108);
      const nameOff = v.getUint32(84), nameLen = v.getUint32(88);
      if (nameOff && nameLen && nameOff + nameLen <= r.length) h.name = new TextDecoder(h.encoding === 65001 ? 'utf-8' : 'windows-1252').decode(r.subarray(nameOff, nameOff + nameLen));
      if (hl >= 0xe4 && 16 + 0xf4 <= r.length) h.extraFlags = v.getUint16(16 + 0xf2);
      const exthFlag = v.getUint32(128);
      if (exthFlag & 0x40) {
        const e = 16 + hl;
        if (new TextDecoder('latin1').decode(r.subarray(e, e + 4)) === 'EXTH') {
          const cnt = v.getUint32(e + 8);
          let p = e + 12;
          for (let i = 0; i < cnt && p + 8 <= r.length; i++) {
            const t = v.getUint32(p), l = v.getUint32(p + 4);
            h.exth[t] = r.subarray(p + 8, p + l);
            p += l;
          }
        }
      }
    }
    return h;
  };

  let h = parseHeader(0);
  // 합본 파일이면 KF8(새 형식) 부분을 우선 읽는다
  const boundary = h.exth[121] ? new DataView(h.exth[121].buffer, h.exth[121].byteOffset).getUint32(0) : null;
  let kf8 = h.version >= 8;
  if (boundary && boundary !== 0xffffffff && boundary < n) { h = parseHeader(boundary); kf8 = true; }
  if (h.encryption) throw new Error('DRM 보호 파일이라 변환할 수 없어요');
  if (h.compression === 17480) throw new Error('이 MOBI 압축 방식(HUFF/CDIC)은 아직 지원하지 않아요');

  const title = (h.exth[503] ? new TextDecoder('utf-8').decode(h.exth[503]) : h.name) || fallbackTitle;

  // 본문 레코드 풀기
  const parts = [];
  for (let i = 1; i <= h.textRecords; i++) {
    let r = rec(h.base + i);
    r = r.subarray(0, r.length - trailingSize(r, h.extraFlags));
    parts.push(h.compression === 2 ? palmdoc(r) : r);
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const text = new TextDecoder(h.encoding === 65001 ? 'utf-8' : 'windows-1252').decode(all.subarray(0, h.textLength || all.length));

  // 이미지
  const firstImg = h.firstImage === 0xffffffff ? null : (kf8 && boundary ? h.firstImage + boundary : h.firstImage);
  const imgCache = new Map();
  const image = (idx) => {
    if (firstImg == null) return null;
    const ri = firstImg + idx;
    if (imgCache.has(ri)) return imgCache.get(ri);
    let url = null;
    if (ri < n) { const b = rec(ri); const m = sniffImageMime(b); if (m) url = bytesToDataUrl(b, m); }
    imgCache.set(ri, url);
    return url;
  };

  const fixImages = (d) => {
    for (const img of [...d.querySelectorAll('img')]) {
      const ri = img.getAttribute('recindex');
      const src = img.getAttribute('src') || '';
      let url = null;
      if (ri) url = image(parseInt(ri, 10) - 1);
      else { const m = src.match(/kindle:embed:([0-9A-V]+)/i); if (m) url = image(parseInt(m[1], 32) - 1); }
      if (url) img.setAttribute('src', url); else img.remove();
    }
    d.querySelectorAll('script,style,link').forEach(e => e.remove());
  };

  const chapters = [];
  const segs = kf8 ? text.split(/(?=<html[\s>])/i) : text.split(/<mbp:pagebreak\s*\/?>/i);
  for (const s of segs) {
    if (!s.trim()) continue;
    const d = new DOMParser().parseFromString(s, 'text/html');
    fixImages(d);
    const t = d.body.textContent.trim();
    if (!t && !d.body.querySelector('img')) continue;
    const head = d.body.querySelector('h1,h2,h3')?.textContent.trim();
    chapters.push({ title: (head || `${chapters.length + 1}`).slice(0, 80), html: d.body.innerHTML });
  }
  if (!chapters.length) throw new Error('책 내용을 찾지 못했어요');
  return { title, chapters };
}

function trailingSize(data, flags) {
  let num = 0;
  const size = data.length;
  let f = flags >> 1;
  while (f) {
    if (f & 1) {
      let bitpos = 0, result = 0, p = size - num;
      while (p > 0) {
        const v = data[p - 1];
        result |= (v & 0x7f) << bitpos;
        bitpos += 7; p--;
        if ((v & 0x80) || bitpos >= 28) break;
      }
      num += result;
    }
    f >>= 1;
  }
  if (flags & 1) num += (data[size - num - 1] & 0x3) + 1;
  return Math.min(num, size);
}

function palmdoc(src) {
  const out = new Uint8Array(src.length * 8 + 16);
  let o = 0, i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c === 0 || (c >= 9 && c <= 0x7f)) out[o++] = c;
    else if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++]; }
    else if (c >= 0xc0) { out[o++] = 0x20; out[o++] = c ^ 0x80; }
    else {
      const v = (c << 8) | src[i++];
      const dist = (v >> 3) & 0x7ff, len = (v & 7) + 3;
      for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
    }
  }
  return out.subarray(0, o);
}
