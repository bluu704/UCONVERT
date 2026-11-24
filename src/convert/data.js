// 표·데이터 변환 (SheetJS + js-yaml + fast-xml-parser)
import { MIME } from '../formats.js';
import { readText } from './doc/readers.js';

const STRUCT = new Set(['json', 'yaml', 'xml']);

export async function convertData(file, ext, target, opts) {
  // JSON·YAML·XML 사이는 구조를 그대로 옮긴다
  if (STRUCT.has(ext) && STRUCT.has(target)) {
    const obj = await readStruct(file, ext);
    return { blob: new Blob([await writeStruct(obj, target)], { type: MIME[target] }) };
  }
  const XLSX = await import('xlsx');
  let wb;
  if (STRUCT.has(ext)) wb = structToBook(XLSX, await readStruct(file, ext));
  else if (ext === 'csv' || ext === 'tsv') wb = XLSX.read(await readText(file), { type: 'string', FS: ext === 'tsv' ? '\t' : undefined, raw: false });
  else wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  if (!wb.SheetNames.length) throw new Error('표를 찾지 못했어요');

  if (target === 'xlsx' || target === 'ods') {
    const out = XLSX.write(wb, { bookType: target, type: 'array', compression: true });
    return { blob: new Blob([out], { type: MIME[target] }) };
  }
  if (target === 'csv' || target === 'tsv') {
    const FS = target === 'tsv' ? '\t' : ({ '탭': '\t', '세미콜론': ';' }[opts.delim] || ',');
    const sheets = wb.SheetNames.filter(n => wb.Sheets[n]['!ref']);
    const csv = (n) => '﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS, blankrows: false });
    if (sheets.length <= 1) return { blob: new Blob([csv(sheets[0] || wb.SheetNames[0])], { type: MIME[target] }) };
    // 시트가 여러 개면 시트마다 파일 하나씩 ZIP으로
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    sheets.forEach(n => zip.file(`${n.replace(/[\\/:*?"<>|]/g, '_')}.${target}`, csv(n)));
    return { blob: await zip.generateAsync({ type: 'blob', mimeType: MIME.zip }), ext: 'zip' };
  }
  // 표 → JSON/YAML/XML
  const data = {};
  for (const n of wb.SheetNames) data[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true });
  const names = Object.keys(data);
  const obj = names.length === 1 ? data[names[0]] : data;
  return { blob: new Blob([await writeStruct(obj, target)], { type: MIME[target] }) };
}

async function readStruct(file, ext) {
  const t = await readText(file);
  try {
    if (ext === 'json') return JSON.parse(t);
    if (ext === 'yaml') return (await import('js-yaml')).load(t);
    const { XMLParser } = await import('fast-xml-parser');
    return new XMLParser({ ignoreDeclaration: true, ignorePiTags: true, ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true, trimValues: true }).parse(t);
  } catch (e) {
    throw new Error(`${ext.toUpperCase()} 문법 오류: ${String(e.message || e).slice(0, 120)}`);
  }
}

async function writeStruct(obj, target) {
  if (target === 'json') return JSON.stringify(obj, (k, v) => v instanceof Date ? v.toISOString() : v, 2) + '\n';
  if (target === 'yaml') return (await import('js-yaml')).dump(obj, { lineWidth: 120, noRefs: true });
  const { XMLBuilder } = await import('fast-xml-parser');
  const b = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true, indentBy: '  ', suppressEmptyNode: true });
  const safe = (o) => {
    if (Array.isArray(o)) return o.map(safe);
    if (o instanceof Date) return o.toISOString();
    if (o && typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k.startsWith('@') ? k : xmlName(k)] = safe(v);
      return r;
    }
    return o;
  };
  let root;
  if (Array.isArray(obj)) root = { rows: { row: safe(obj) } };
  else if (obj && typeof obj === 'object' && Object.keys(obj).length === 1 && !Array.isArray(Object.values(obj)[0])) root = safe(obj);
  else if (obj && typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[xmlName(k)] = Array.isArray(v) ? { row: safe(v) } : safe(v);
    root = { data: r };
  } else root = { value: obj };
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + b.build(root);
}

function xmlName(k) {
  let n = String(k).trim().replace(/[^\p{L}\p{N}_.-]/gu, '_');
  if (!/^[\p{L}_]/u.test(n)) n = '_' + n;
  return n || '_';
}

// JSON 같은 구조 → 통합 문서 (배열 = 표 하나, 배열 값을 가진 객체 = 시트 여러 개)
function structToBook(XLSX, obj) {
  const wb = XLSX.utils.book_new();
  const flat = (o, p = '', r = {}) => {
    if (o && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Date)) { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, r); }
    else r[p || 'value'] = Array.isArray(o) ? JSON.stringify(o) : o;
    return r;
  };
  const add = (name, arr) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(arr.map(x => (x && typeof x === 'object') ? flat(x) : { value: x })), name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'Sheet1');
  const findArray = (o) => {
    if (Array.isArray(o)) return o;
    if (o && typeof o === 'object') { const vs = Object.values(o); if (vs.length === 1) return findArray(vs[0]); }
    return null;
  };
  const arr = findArray(obj);
  if (arr) add('Sheet1', arr);
  else if (obj && typeof obj === 'object') {
    const entries = Object.entries(obj).filter(([, v]) => Array.isArray(v));
    if (entries.length) entries.forEach(([k, v]) => add(k, v));
    else add('Sheet1', [obj]);
  } else add('Sheet1', [{ value: obj }]);
  return wb;
}
