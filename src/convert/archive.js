// 압축 파일 변환 (7-Zip WebAssembly)
// 압축을 모두 푼 뒤 원하는 형식으로 다시 묶는다.
import SevenZip from '7z-wasm';
import wasmUrl from '7z-wasm/7zz.wasm?url';
import { MIME } from '../formats.js';

let wasmBin = null;
async function make7z() {
  if (!wasmBin) wasmBin = fetch(wasmUrl).then(r => r.arrayBuffer());
  const log = [];
  // 실행할 때마다 새 인스턴스 (7-Zip은 한 번 실행하면 상태가 남는다)
  const m = await SevenZip({ wasmBinary: await wasmBin, print: (s) => log.push(s), printErr: (s) => log.push(s) });
  return { m, log };
}

function run(sz, args) {
  try { sz.m.callMain(args); }
  catch (e) { if (!(e && (e.name === 'ExitStatus' || 'status' in e))) throw e; if (e.status) throw fail(sz.log); }
}
function fail(log) {
  const t = log.join('\n');
  if (/Wrong password|encrypted|Can not open encrypted/i.test(t)) return new Error('암호가 걸린 압축 파일은 아직 지원하지 않아요');
  if (/Can not open the file as archive|Unsupported/i.test(t)) return new Error('압축 파일을 열지 못했어요');
  return new Error('압축 처리 중 오류가 났어요');
}

function walk(FS, dir) {
  let n = 0;
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const p = `${dir}/${name}`;
    n += FS.isDir(FS.stat(p).mode) ? walk(FS, p) : 1;
  }
  return n;
}

export async function convertArchive(file, ext, target, progress) {
  progress?.(0.05);
  const sz = await make7z();
  const { FS } = sz.m;
  const inName = '/work/in.' + (ext === 'gz' ? 'gz' : ext);
  FS.mkdir('/work'); FS.mkdir('/work/x');
  FS.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
  progress?.(0.2);

  // 풀기
  run(sz, ['x', inName, '-o/work/x', '-y', '-bso0', '-bsp0']);
  // .tar.gz 처럼 안에 tar 하나만 있으면 한 번 더 푼다
  const inner = FS.readdir('/work/x').filter(n => n !== '.' && n !== '..');
  if (inner.length === 1 && /\.tar$/i.test(inner[0]) && !FS.isDir(FS.stat(`/work/x/${inner[0]}`).mode)) {
    FS.mkdir('/work/y');
    run(sz, ['x', `/work/x/${inner[0]}`, '-o/work/y', '-y', '-bso0', '-bsp0']);
    FS.unlink(`/work/x/${inner[0]}`); FS.rmdir('/work/x');
    FS.rename('/work/y', '/work/x');
  }
  if (!walk(FS, '/work/x')) throw new Error('압축 파일 안이 비어 있어요');
  progress?.(0.55);

  // 묶기
  FS.chdir('/work/x');
  let out;
  if (target === 'zip') { run(sz, ['a', '-tzip', '-mcu=on', '-mx=6', '/work/out.zip', '*', '-bso0', '-bsp0']); out = '/work/out.zip'; }
  else if (target === '7z') { run(sz, ['a', '-t7z', '-mx=6', '/work/out.7z', '*', '-bso0', '-bsp0']); out = '/work/out.7z'; }
  else if (target === 'tar') { run(sz, ['a', '-ttar', '/work/out.tar', '*', '-bso0', '-bsp0']); out = '/work/out.tar'; }
  else if (target === 'gz') {
    run(sz, ['a', '-ttar', '/work/out.tar', '*', '-bso0', '-bsp0']);
    FS.chdir('/work');
    run(sz, ['a', '-tgzip', '/work/out.tar.gz', '/work/out.tar', '-bso0', '-bsp0']);
    out = '/work/out.tar.gz';
  } else throw new Error('이 형식으로는 묶을 수 없어요');
  progress?.(0.95);
  const data = FS.readFile(out);
  return { blob: new Blob([data], { type: MIME[target] }) };
}
