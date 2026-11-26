// 압축 도구: 안의 파일 보기 · 골라 받기 · 여러 파일 묶기 (7-Zip WebAssembly)
import { make7z, run, NO_PASSWORD, is7zHeaderEncrypted, checkSize, walk } from '../convert/archive.js';

const base = (n) => n.replace(/(\.tar)?\.[^.]+$/i, '');

// 7-Zip 인스턴스에 압축 파일을 넣는다 (.tar.gz는 안의 tar를 꺼내 그것을 연다)
async function openArc(file, ext, password) {
  const sz = await make7z();
  const { FS } = sz.m;
  FS.mkdir('/w');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let inName = '/w/in.' + ext;
  FS.writeFile(inName, bytes);
  const pw = ['-p' + (password || NO_PASSWORD)];
  const ctx = { password, headerEncrypted: is7zHeaderEncrypted(bytes) };
  checkSize(sz, inName, pw, ctx, bytes.length);
  if (ext === 'gz' || ext === 'bz2' || ext === 'xz') {
    FS.mkdir('/w/g');
    run(sz, ['x', inName, '-o/w/g', '-y', '-bso0', '-bsp0', ...pw], ctx);
    const inner = FS.readdir('/w/g').filter(n => n !== '.' && n !== '..');
    if (inner.length === 1 && /\.tar$/i.test(inner[0])) { inName = `/w/g/${inner[0]}`; FS.unlink('/w/in.' + ext); }
    else return { sz, FS, inName: null, single: inner.map(n => `/w/g/${n}`), pw, ctx };
  }
  return { sz, FS, inName, pw, ctx };
}

// 안에 든 파일 목록 [{path, size, dir}]
export async function listArchive(file, ext, password) {
  const a = await openArc(file, ext, password);
  if (a.single) return a.single.map(p => ({ path: p.split('/').pop(), size: a.FS.stat(p).size, dir: false }));
  run(a.sz, ['l', '-slt', '-ba', '-bsp0', a.inName, ...a.pw], a.ctx);
  const out = []; let cur = null;
  for (const line of a.sz.log) {
    const m = /(?:^|\s)(Path|Size|Folder|Attributes|Encrypted) = (.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'Path') { cur = { path: m[2].replace(/\\/g, '/').replace(/^\/+/, ''), size: 0, dir: false }; out.push(cur); }
    else if (!cur) continue;
    else if (m[1] === 'Size') cur.size = +m[2] || 0;
    else if (m[1] === 'Folder' && m[2] === '+') cur.dir = true;
    else if (m[1] === 'Attributes' && /^D/.test(m[2])) cur.dir = true;
    else if (m[1] === 'Encrypted' && m[2] === '+') cur.enc = true;
  }
  return out.filter(e => e.path && !e.path.split('/').includes('..'));
}

// 고른 파일만 꺼내기 → [{path, bytes}]
export async function extract(file, ext, password, paths, progress) {
  const a = await openArc(file, ext, password);
  progress?.(0.3);
  const read = (dir) => {
    const files = [];
    const go = (d, rel) => {
      for (const n of a.FS.readdir(d)) {
        if (n === '.' || n === '..') continue;
        const p = `${d}/${n}`, r = rel ? `${rel}/${n}` : n;
        if (a.FS.isDir(a.FS.stat(p).mode)) go(p, r); else files.push({ path: r, bytes: a.FS.readFile(p) });
      }
    };
    go(dir, '');
    return files;
  };
  if (a.single) return read('/w/g');
  a.FS.mkdir('/w/x');
  // 경로가 많으면 목록 파일(@list)로 넘긴다
  const args = ['x', a.inName, '-o/w/x', '-y', '-bso0', '-bsp0', ...a.pw];
  if (paths) { a.FS.writeFile('/w/list.txt', paths.join('\n')); args.push('-i@/w/list.txt', '-scsUTF-8'); }
  run(a.sz, args, a.ctx);
  progress?.(0.8);
  if (!walk(a.FS, '/w/x')) throw new Error('꺼낸 파일이 없어요');
  return read('/w/x');
}

// 여러 파일 묶기
export async function pack(files, name, fmt, level, password, progress) {
  const sz = await make7z();
  const { FS } = sz.m;
  FS.mkdir('/in');
  const used = new Set();
  for (let i = 0; i < files.length; i++) {
    let n = files[i].name.replace(/[\\/:*?"<>|]/g, '_'), k = 2;
    while (used.has(n.toLowerCase())) n = files[i].name.replace(/(\.[^.]+)?$/, ` (${k++})$1`);
    used.add(n.toLowerCase());
    FS.writeFile(`/in/${n}`, new Uint8Array(await files[i].arrayBuffer()));
    progress?.((i + 1) / files.length * 0.5);
  }
  FS.chdir('/in');
  const out = `/out.${fmt}`;
  const lock = password ? (fmt === 'zip' ? ['-p' + password, '-mem=AES256'] : ['-p' + password, '-mhe=on']) : [];
  run(sz, ['a', fmt === 'zip' ? '-tzip' : '-t7z', `-mx=${level}`, ...(fmt === 'zip' ? ['-mcu=on'] : []), ...lock, out, '*', '-bso0', '-bsp0']);
  progress?.(0.95);
  const safe = (name || '묶음').replace(/[\\/:*?"<>|]/g, '_').trim() || '묶음';
  return { blob: new Blob([FS.readFile(out)], { type: fmt === 'zip' ? 'application/zip' : 'application/x-7z-compressed' }), name: `${base(safe + '.x')}.${fmt}` };
}
