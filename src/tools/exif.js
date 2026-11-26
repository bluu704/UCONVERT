// 사진 속 정보(EXIF·XMP) 찾기와 지우기 — 화질을 건드리지 않고 그 자리의 바이트만 비운다
// JPEG·PNG·WebP는 그대로 고치고, 그 밖의 형식(HEIC 등)은 다시 저장해서 모든 정보를 뺀다.

const GPS_IFD = 0x8825, EXIF_IFD = 0x8769;
const CAM = new Set([0x010f, 0x0110, 0xa430, 0xa431, 0xa432, 0xa433, 0xa434, 0xa435, 0x927c]);
const DATE = new Set([0x0132, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292]);
const GPS_DATE = new Set([0x0007, 0x001d]);
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

// TIFF 블록(base~end) 안의 IFD를 읽는다
function tiff(b, base, end) {
  if (end - base < 8) return null;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;
  if (!le && !(b[base] === 0x4d && b[base + 1] === 0x4d)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o) => v.getUint16(base + o, le), u32 = (o) => v.getUint32(base + o, le);
  const inside = (o, n = 1) => o >= 0 && base + o + n <= end;
  const ifd = (off) => {
    if (!off || !inside(off, 2)) return null;
    const n = u16(off); if (!inside(off + 2, n * 12)) return null;
    const entries = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, type = u16(e + 2), count = u32(e + 4), size = (TYPE_SIZE[type] || 1) * count;
      const at = size > 4 ? u32(e + 8) : e + 8;
      entries.push({ tag: u16(e), type, count, size, at, entry: e, ok: inside(at, Math.min(size, 1 << 20)) });
    }
    return { off, n, entries };
  };
  const ifd0 = ifd(u32(4));
  if (!ifd0) return null;
  const sub = (tag) => { const e = ifd0.entries.find(x => x.tag === tag); return e ? ifd(u32(e.entry + 8)) : null; };
  return { b, base, ifd0, exif: sub(EXIF_IFD), gps: sub(GPS_IFD), zero(at, n) { b.fill(0, base + at, Math.min(end, base + at + n)); } };
}
const hasText = (t, e) => e.ok && e.size > 0 && t.b.subarray(t.base + e.at, t.base + e.at + e.size).some(x => x !== 0 && x !== 0x20);

function inspectTiff(t) {
  if (!t) return { gps: false, cam: false, date: false };
  const all = [...t.ifd0.entries, ...(t.exif?.entries || [])];
  return {
    gps: !!t.gps && t.gps.entries.some(e => (e.tag === 2 || e.tag === 4) && hasText(t, e)),
    cam: all.some(e => CAM.has(e.tag) && hasText(t, e)),
    date: all.some(e => DATE.has(e.tag) && hasText(t, e)),
  };
}
function cleanTiff(t, o) {
  if (!t) return;
  const wipe = (e) => { if (e.ok) t.zero(e.at, e.size); };
  const all = [...t.ifd0.entries, ...(t.exif?.entries || [])];
  if (o.cam) all.filter(e => CAM.has(e.tag)).forEach(wipe);
  if (o.date) { all.filter(e => DATE.has(e.tag)).forEach(wipe); t.gps?.entries.filter(e => GPS_DATE.has(e.tag)).forEach(wipe); }
  if (o.gps && t.gps) {
    // 위치 항목의 값과 목록을 모두 0으로 (빈 GPS 목록만 남는다)
    t.gps.entries.forEach(e => { wipe(e); t.zero(e.entry, 12); });
    t.zero(t.gps.off, 2);
  }
}

/* ---------- 형식별 위치 찾기 ---------- */
const ascii = (b, o, s) => s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));
function jpegSegments(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const segs = []; let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const m = b[o + 1];
    if (m === 0xda || m === 0xd9) break;               // 이미지 데이터 시작
    if (m >= 0xd0 && m <= 0xd7 || m === 0x01) { o += 2; continue; }
    const len = (b[o + 2] << 8) | b[o + 3];
    segs.push({ m, start: o, data: o + 4, end: o + 2 + len });
    o += 2 + len;
  }
  return segs;
}
function pngChunks(b) {
  if (!ascii(b, 1, 'PNG')) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = []; let o = 8;
  while (o + 12 <= b.length) {
    const len = v.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    out.push({ type, start: o, data: o + 8, len, end: o + 12 + len });
    o += 12 + len; if (type === 'IEND') break;
  }
  return out;
}
function webpChunks(b) {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = []; let o = 12;
  while (o + 8 <= b.length) {
    const type = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), len = v.getUint32(o + 4, true);
    out.push({ type, start: o, data: o + 8, len, end: o + 8 + len + (len & 1) });
    o += 8 + len + (len & 1);
  }
  return out;
}
function exifStart(b, o) { return ascii(b, o, 'Exif\0\0') ? o + 6 : o; }

// 사진 안에 무엇이 들어 있는지 (형식이 안 맞으면 null)
export function inspect(bytes) {
  const b = bytes;
  const j = jpegSegments(b);
  if (j) {
    const ex = j.find(s => s.m === 0xe1 && ascii(b, s.data, 'Exif\0\0'));
    const r = inspectTiff(ex ? tiff(b, ex.data + 6, ex.end) : null);
    r.xmp = j.some(s => s.m === 0xe1 && ascii(b, s.data, 'http://ns.adobe.com/xap'));
    return r;
  }
  const p = pngChunks(b);
  if (p) { const ex = p.find(c => c.type === 'eXIf'); return inspectTiff(ex ? tiff(b, ex.data, ex.data + ex.len) : null); }
  const w = webpChunks(b);
  if (w) { const ex = w.find(c => c.type === 'EXIF'); return inspectTiff(ex ? tiff(b, exifStart(b, ex.data), ex.data + ex.len) : null); }
  return null;
}

let crcTable = null;
function crc32(b, s, e) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = s; i < e; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 고른 정보를 지운 새 바이트 (형식이 안 맞으면 null → 다시 저장해야 함)
export function strip(bytes, o) {
  const b = new Uint8Array(bytes); // 복사본을 고친다
  const any = o.gps || o.cam || o.date;
  const j = jpegSegments(b);
  if (j) {
    const ex = j.find(s => s.m === 0xe1 && ascii(b, s.data, 'Exif\0\0'));
    if (ex) cleanTiff(tiff(b, ex.data + 6, ex.end), o);
    // XMP(APP1)와 IPTC(APP13)에는 위치·날짜·카메라가 글로 다시 들어 있을 수 있어 통째로 뺀다
    const drop = any ? j.filter(s => (s.m === 0xe1 && ascii(b, s.data, 'http://ns.adobe.com/xap')) || s.m === 0xed) : [];
    if (!drop.length) return b;
    const parts = []; let at = 0;
    for (const s of drop) { parts.push(b.subarray(at, s.start)); at = s.end; }
    parts.push(b.subarray(at));
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let k = 0;
    for (const x of parts) { out.set(x, k); k += x.length; }
    return out;
  }
  const p = pngChunks(b);
  if (p) {
    const ex = p.find(c => c.type === 'eXIf');
    if (ex) {
      cleanTiff(tiff(b, ex.data, ex.data + ex.len), o);
      new DataView(b.buffer).setUint32(ex.data + ex.len, crc32(b, ex.start + 4, ex.data + ex.len));
    }
    const drop = p.filter(c => (any && ['tEXt', 'iTXt', 'zTXt'].includes(c.type)) || (o.date && c.type === 'tIME'));
    if (!drop.length) return b;
    const keep = p.filter(c => !drop.includes(c));
    const out = new Uint8Array(8 + keep.reduce((n, c) => n + (c.end - c.start), 0)); out.set(b.subarray(0, 8));
    let k = 8; for (const c of keep) { out.set(b.subarray(c.start, c.end), k); k += c.end - c.start; }
    return out;
  }
  const w = webpChunks(b);
  if (w) {
    const ex = w.find(c => c.type === 'EXIF');
    if (ex) cleanTiff(tiff(b, exifStart(b, ex.data), ex.data + ex.len), o);
    // XMP 글은 공백으로 채운다 (크기를 바꾸지 않아도 되도록)
    const xmp = w.find(c => c.type === 'XMP ');
    if (xmp && any) b.fill(0x20, xmp.data, xmp.data + xmp.len);
    return b;
  }
  return null;
}
