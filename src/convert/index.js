// 변환 진입점: (파일, 원본 확장자, 목표 형식, 옵션) → { blob, name }
import { catOf } from '../formats.js';

export async function convert(file, ext, target, opts = {}, progress = () => {}, signal) {
  const cat = catOf(ext);
  const base = file.name.replace(/\.tar\.gz$/i, '').replace(/\.[^.]+$/, '') || 'converted';
  let r;

  if (cat === 'aud' || cat === 'vid' || (ext === 'gif' && (target === 'mp4' || target === 'webm'))) {
    const { convertMedia } = await import('./media.js');
    r = await convertMedia(file, ext, target, opts, progress, signal);
  } else if (cat === 'img') {
    const { decodeImage, encodeImage } = await import('./image.js');
    progress(0.1);
    const c = await decodeImage(file, ext);
    progress(0.5);
    r = { blob: await encodeImage(c, target, opts) };
  } else if (ext === 'pdf' && (target === 'png' || target === 'jpg')) {
    const { pdfToImages } = await import('./image.js');
    r = await pdfToImages(file, target, opts, progress);
  } else if (ext === 'cbz' && target === 'zip') {
    r = { blob: new Blob([file], { type: 'application/zip' }) };
  } else if (cat === 'doc' || cat === 'book' || cat === 'ppt') {
    const { readDoc } = await import('./doc/readers.js');
    const { writeDoc } = await import('./doc/writers.js');
    progress(0.05);
    const doc = await readDoc(file, ext, progress);
    progress(0.6);
    r = { blob: await writeDoc(doc, target, opts, progress) };
  } else if (cat === 'data') {
    const { convertData } = await import('./data.js');
    progress(0.2);
    r = await convertData(file, ext, target, opts);
  } else if (cat === 'arc') {
    const { convertArchive } = await import('./archive.js');
    r = await convertArchive(file, ext, target, progress);
  } else {
    throw new Error('지원하지 않는 형식이에요');
  }
  const outExt = r.ext || (target === 'gz' ? 'tar.gz' : target);
  return { ...r, name: `${base}.${outExt}` };
}

// 사용자에게 보여줄 오류 문구
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  if (/[가-힣]/.test(m)) return m;
  if (/memory|allocation|RangeError: Array buffer/i.test(m)) return '파일이 너무 커서 브라우저 메모리가 부족해요';
  if (/decode|corrupt|invalid|Unsupported/i.test(m)) return '파일을 읽지 못했어요. 손상됐거나 지원하지 않는 형식일 수 있어요';
  if (/abort|cancel/i.test(m)) return '취소했어요';
  return '변환에 실패했어요';
}
