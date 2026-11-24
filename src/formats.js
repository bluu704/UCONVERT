// 형식 목록과 "무엇을 무엇으로 바꿀 수 있는지"를 한 곳에 정리한다.
// 여기 있는 조합은 모두 src/convert/ 안에 실제 변환 코드가 있다.

export const CATS = {
  doc:  { label: '문서',        c: '--c-doc',  exts: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'html'] },
  book: { label: '전자책',      c: '--c-book', exts: ['epub', 'mobi', 'azw3', 'fb2', 'cbz'] },
  ppt:  { label: '프레젠테이션', c: '--c-ppt',  exts: ['pptx', 'odp'] },
  img:  { label: '이미지',      c: '--c-img',  exts: ['jpg', 'png', 'webp', 'avif', 'heic', 'gif', 'bmp', 'tiff', 'svg', 'ico'] },
  aud:  { label: '오디오',      c: '--c-aud',  exts: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'] },
  vid:  { label: '영상',        c: '--c-vid',  exts: ['mp4', 'webm', 'mov', 'mkv', 'avi'] },
  data: { label: '데이터',      c: '--c-data', exts: ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml'] },
  arc:  { label: '압축',        c: '--c-arc',  exts: ['zip', '7z', 'tar', 'gz', 'rar'] },
};

// 확장자 별칭
const ALIAS = { jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', yml: 'yaml', heif: 'heic', tgz: 'gz', azw: 'azw3', kf8: 'azw3', prc: 'mobi', m4b: 'm4a', oga: 'ogg', mpg4: 'mp4', m4v: 'mp4', qt: 'mov', xhtml: 'html', text: 'txt' };

export function extOf(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.tar.gz')) return 'gz';
  const m = n.match(/\.([a-z0-9]+)$/);
  if (!m) return '';
  return ALIAS[m[1]] || m[1];
}

export function catOf(ext) {
  for (const k in CATS) if (CATS[k].exts.includes(ext)) return k;
  return null;
}

const DOC_OUT = ['pdf', 'docx', 'epub', 'html', 'md', 'txt', 'rtf', 'odt'];
const IMG_OUT = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico', 'svg', 'pdf'];
const AUD_OUT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
const VID_OUT = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif'];
const DATA_OUT = ['xlsx', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml'];
const ARC_OUT = ['zip', '7z', 'tar', 'gz'];

// 확장자 → 바꿀 수 있는 형식 (분류별 묶음)
export function targetsFor(ext) {
  return rawTargets(ext).filter(g => g.exts.length);
}

function rawTargets(ext) {
  const cat = catOf(ext);
  const g = (k, list) => ({ k, exts: list.filter(e => e !== ext) });
  switch (cat) {
    case 'doc':
      return [g('doc', DOC_OUT.filter(e => e !== 'epub')), g('book', ['epub'])]
        .concat(ext === 'pdf' ? [g('img', ['png', 'jpg'])] : []);
    case 'book':
      if (ext === 'cbz') return [g('doc', ['pdf']), g('book', ['epub']), g('arc', ['zip'])];
      return [g('doc', DOC_OUT.filter(e => e !== 'epub')), g('book', ['epub'])];
    case 'ppt':
      return [g('doc', ['pdf', 'docx', 'html', 'md', 'txt'])];
    case 'img':
      return [g('img', IMG_OUT.filter(e => e !== 'pdf')), g('doc', ['pdf'])]
        .concat(ext === 'gif' ? [g('vid', ['mp4', 'webm'])] : []);
    case 'aud':
      return [g('aud', AUD_OUT)];
    case 'vid':
      return [g('vid', VID_OUT), g('aud', ['mp3', 'm4a', 'wav', 'ogg', 'flac'])];
    case 'data':
      return [g('data', DATA_OUT)];
    case 'arc':
      return [g('arc', ARC_OUT)];
  }
  return [];
}

export function defaultTarget(ext) {
  const pref = { docx: 'pdf', odt: 'pdf', rtf: 'pdf', txt: 'pdf', md: 'html', html: 'pdf', pdf: 'docx',
    epub: 'pdf', mobi: 'epub', azw3: 'epub', fb2: 'epub', cbz: 'pdf', pptx: 'pdf', odp: 'pdf',
    heic: 'jpg', png: 'jpg', jpg: 'png', webp: 'png', avif: 'png', gif: 'mp4', bmp: 'png', tiff: 'png', svg: 'png', ico: 'png',
    wav: 'mp3', flac: 'mp3', m4a: 'mp3', aac: 'mp3', ogg: 'mp3', opus: 'mp3', mp3: 'wav', wma: 'mp3',
    mov: 'mp4', mkv: 'mp4', avi: 'mp4', webm: 'mp4', mp4: 'webm',
    xlsx: 'csv', xls: 'xlsx', ods: 'xlsx', csv: 'xlsx', tsv: 'xlsx', json: 'csv', xml: 'json', yaml: 'json',
    rar: 'zip', '7z': 'zip', tar: 'zip', gz: 'zip', zip: '7z' };
  const all = targetsFor(ext).flatMap(g => g.exts);
  return all.includes(pref[ext]) ? pref[ext] : all[0] || null;
}

export const MIME = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8', html: 'text/html;charset=utf-8', epub: 'application/epub+zip',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp',
  tiff: 'image/tiff', ico: 'image/x-icon', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8', json: 'application/json', xml: 'application/xml', yaml: 'text/yaml;charset=utf-8',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
};
