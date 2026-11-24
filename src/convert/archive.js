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

// 암호를 모를 때 넣는 값. 7-Zip이 입력을 기다리며 멈추지 않게 하고, 틀린 암호로 처리되게 한다.
const NO_PASSWORD = '\u0001uc-no-password';

function run(sz, args, ctx = {}) {
  sz.log.length = 0;
  try { sz.m.callMain(args); }
  catch (e) {
    // 헤더까지 암호화된 7z는 틀린 암호에서 C++ 예외(숫자)로 끝나고 로그가 남지 않는다
    if (typeof e === 'number') throw ctx.headerEncrypted ? pwError(ctx) : new Error('압축 파일을 열지 못했어요');
    if (!(e && (e.name === 'ExitStatus' || 'status' in e))) throw e;
    if (e.status) throw fail(sz.log, ctx);
  }
  if (/Wrong password|Data Error in encrypted|CRC Failed in encrypted/i.test(sz.log.join('\n'))) throw pwError(ctx);
}
function pwError(ctx) {
  return ctx.password
    ? Object.assign(new Error('암호가 틀렸어요'), { code: 'WRONG_PASSWORD' })
    : Object.assign(new Error('암호가 걸린 압축 파일이에요'), { code: 'NEED_PASSWORD' });
}
function fail(log, ctx) {
  const t = log.join('\n');
  if (/Wrong password|encrypted|Can not open encrypted/i.test(t)) return pwError(ctx);
  if (/Can not open the file as archive|Unsupported/i.test(t)) return new Error('압축 파일을 열지 못했어요');
  return new Error('압축 처리 중 오류가 났어요');
}

// 7z 파일의 끝 헤더에 AES 코덱(06 F1 07 01)이 있으면 파일 목록까지 암호화된 것
function is7zHeaderEncrypted(bytes) {
  if (bytes.length < 32 || bytes[0] !== 0x37 || bytes[1] !== 0x7a) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const off = Number(v.getBigUint64(12, true)), size = Number(v.getBigUint64(20, true));
  const start = 32 + off, end = Math.min(bytes.length, start + size);
  for (let i = start; i + 3 < end; i++) if (bytes[i] === 0x06 && bytes[i + 1] === 0xf1 && bytes[i + 2] === 0x07 && bytes[i + 3] === 0x01) return true;
  return false;
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

export async function convertArchive(file, ext, target, progress, opts = {}) {
  progress?.(0.05);
  const sz = await make7z();
  const { FS } = sz.m;
  const inName = '/work/in.' + (ext === 'gz' ? 'gz' : ext);
  FS.mkdir('/work'); FS.mkdir('/work/x');
  const bytes = new Uint8Array(await file.arrayBuffer());
  FS.writeFile(inName, bytes);
  progress?.(0.2);

  // 풀기
  const password = opts.password || '';
  const pw = ['-p' + (password || NO_PASSWORD)];
  const ctx = { password, headerEncrypted: is7zHeaderEncrypted(bytes) };
  run(sz, ['x', inName, '-o/work/x', '-y', '-bso0', '-bsp0', ...pw], ctx);
  // .tar.gz 처럼 안에 tar 하나만 있으면 한 번 더 푼다
  const inner = FS.readdir('/work/x').filter(n => n !== '.' && n !== '..');
  if (inner.length === 1 && /\.tar$/i.test(inner[0]) && !FS.isDir(FS.stat(`/work/x/${inner[0]}`).mode)) {
    FS.mkdir('/work/y');
    run(sz, ['x', `/work/x/${inner[0]}`, '-o/work/y', '-y', '-bso0', '-bsp0', ...pw], ctx);
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
