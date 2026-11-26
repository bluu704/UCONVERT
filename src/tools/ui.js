// PDF 도구 화면 (변환 ↔ PDF 도구 전환 포함)
import { thumb, openDoc, pageSizes, dropEntry, findMargins } from './view.js';
import * as more from './more.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 없음 */ } } };
const MM = 72 / 25.4;
const phone = matchMedia('(max-width:699px)');
const finePtr = matchMedia('(pointer:fine)').matches;

const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const IC = {
  merge: sv('<rect x="3" y="3" width="8" height="11" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><path d="M11 8h4l-2-2M13 16H9l2 2"/>'),
  split: sv('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M2 12h3M8 12h3M13 12h3M19 12h3"/>'),
  org: sv('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>'),
  num: sv('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10.5 15.5l1.5-1v4"/>'),
  wm: sv('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 16l8-8M9 9h.01M15 15h.01"/>'),
  pw: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  crop: sv('<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>'),
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  x: sv('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="2.2"'),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  rotL: sv('<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8M3 3v5h5"/>', 'stroke-width="2.2"'),
  rotR: sv('<path d="M21 12a9 9 0 11-9-9 9.7 9.7 0 016.7 2.7L21 8M21 3v5h-5"/>', 'stroke-width="2.2"'),
  trash: sv('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  page: sv('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 9v6M9 12h6"/>'),
  spark: sv('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  lock: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', 'stroke-width="2.2"'),
  open: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>', 'stroke-width="2.2"'),
  eye: sv('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  chev: sv('<path d="M6 15l6-6 6 6"/>', 'stroke-width="2.2"'),
  prev: sv('<path d="M15 6l-6 6 6 6"/>', 'stroke-width="2.2"'),
  next: sv('<path d="M9 6l6 6-6 6"/>', 'stroke-width="2.2"'),
  img: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
};
const TOOLS = [['merge', '합치기'], ['split', '나누기'], ['org', '쪽 정리'], ['num', '쪽 번호'], ['wm', '워터마크'], ['pw', '암호'], ['crop', '자르기·여백']];
const TOOL_NAME = Object.fromEntries(TOOLS);
const MULTI = new Set(['merge', 'pw']);
const CATS = [['pdf', 'PDF', '--c-doc'], ['img', '이미지', '--c-img'], ['media', '영상·오디오', '--c-aud'], ['arc', '압축', '--c-arc']];
const CAT_IC = {
  pdf: sv('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>', 'stroke-width="2.2"'),
  img: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>', 'stroke-width="2.2"'),
  media: sv('<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-3v10l-4-3"/>', 'stroke-width="2.2"'),
  arc: sv('<path d="M21 8v12a1 1 0 01-1 1H4a1 1 0 01-1-1V8"/><path d="M1 3h22v5H1zM10 12h4"/>', 'stroke-width="2.2"'),
};
const GROUP_C = ['var(--accent)', 'var(--c-aud)', 'var(--c-vid)', 'var(--c-img)', 'var(--c-book)', 'var(--c-data)'];

/* ---------- 상태 ---------- */
let tid = 0;
const S = {
  cat: CATS.some(c => c[0] === LS.get('uc-cat')) ? LS.get('uc-cat') : 'pdf', p: 0, note: '',
  tool: TOOL_NAME[LS.get('uc-tool')] ? LS.get('uc-tool') : 'merge',
  files: [], cur: null,
  mergeName: '',
  split: { mode: 'range', range: '', every: 2 },
  org: { id: null, pages: [] },
  num: { pos: 'bc', style: 0, size: 1, start: 1, skipFirst: false },
  wm: { kind: 'text', text: '대외비', opacity: 25, angle: 45, size: 1, color: '빨강', image: null, imageUrl: null },
  pw: { mode: 'lock', pw: '', pw2: '', print: true, copy: false, modify: false, unpw: '' },
  crop: { mode: 'trim', same: true, trim: { all: { t: 10, b: 10, l: 10, r: 10 }, per: {} }, pad: { all: { t: 10, b: 10, l: 10, r: 10 }, per: {} } },
  view: 0,
  busy: false, err: '', finding: false,
};
const usable = (f) => f && f.pages && !f.locked && !f.bad;
function curFile() {
  return S.files.find(f => f.id === S.cur) || S.files.find(usable) || S.files[0] || null;
}
function resetForFile() {
  S.view = 0; S.crop.trim.per = {}; S.crop.pad.per = {}; S.org = { id: null, pages: [] }; S.split.range = '';
}
function ensureOrg(f) {
  if (!usable(f) || S.org.id === f.id) return;
  S.org = { id: f.id, pages: Array.from({ length: f.pages }, (_, i) => ({ src: i, rot: 0, del: false, sel: false, key: 'p' + i })) };
}

/* ---------- 파일 ---------- */
export function addPdfs(list) {
  const all = [...list];
  const pdfs = all.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  S.err = pdfs.length < all.length ? 'PDF만 넣을 수 있어요' : '';
  let first = null;
  for (const file of pdfs) {
    const e = { id: ++tid, file, name: file.name, pages: null, sizes: null, locked: false, bad: '' };
    S.files.push(e); first ||= e;
    openDoc(e).then(async d => { e.pages = d.numPages; e.sizes = await pageSizes(e); })
      .catch(err => { if (err?.name === 'PasswordException') e.locked = true; else e.bad = 'PDF를 읽지 못했어요'; })
      .finally(() => { render(); });
  }
  if (first && !MULTI.has(S.tool)) { S.cur = first.id; resetForFile(); }
  else if (first && S.cur == null) S.cur = first.id;
  render(true);
}
function removeFile(id) {
  const i = S.files.findIndex(f => f.id === id); if (i < 0) return;
  dropEntry(S.files[i]); S.files.splice(i, 1);
  if (S.cur === id) { S.cur = (S.files[i] || S.files[i - 1])?.id ?? null; resetForFile(); }
  render();
}

/* ---------- 그리기 ---------- */
function img(f, idx, w, extra = '') { return `<img class="pimg" data-th="${f.id}:${idx}:${w}" alt="" ${extra}>`; }
let io = null;
function hydrate(root) {
  io ||= new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    const el = en.target; io.unobserve(el);
    const [id, idx, w] = el.dataset.th.split(':').map(Number);
    const f = S.files.find(x => x.id === id); if (!f) return;
    thumb(f, idx, w).then(u => { el.src = u; el.onload = () => el.classList.add('ok'); }).catch(() => el.classList.add('bad'));
  }), { rootMargin: '300px' });
  root.querySelectorAll('img[data-th]:not([src])').forEach(el => io.observe(el));
}

function renderCats() {
  $('#tcats').innerHTML = CATS.map(([k, l, c]) => `<button class="tc ${k === S.cat ? 'on' : ''}" data-cat="${k}" aria-pressed="${k === S.cat}" style="--c:var(${c})"><span class="ic">${CAT_IC[k]}</span>${l}</button>`).join('');
}
function renderNav() {
  if (S.cat !== 'pdf') { $('#tnav').innerHTML = more.navHTML(); return; }
  $('#tnav').innerHTML = TOOLS.map(([k, label]) => `<button class="tn ${k === S.tool ? 'on' : ''}" data-tool="${k}" aria-pressed="${k === S.tool}">${IC[k]}<span>${label}</span></button>`).join('');
}
function renderBar() {
  const bar = $('#tbar'), f = curFile();
  if (S.cat !== 'pdf') { const h = more.barHTML(); bar.hidden = !h; bar.innerHTML = h || ''; return; }
  if (MULTI.has(S.tool) || !f) { bar.innerHTML = ''; bar.hidden = true; return; }
  bar.hidden = false;
  const many = S.files.length > 1;
  const name = many
    ? `<label class="tsel"><select id="tcur" aria-label="PDF 고르기">${S.files.map(x => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${IC.chev}</label>`
    : `<span class="f-name">${esc(f.name)}</span>`;
  bar.innerHTML = `<span class="badge sm" style="--c:var(--c-doc)">pdf</span>${name}<span class="pc">${f.pages ? f.pages + '쪽' : f.locked ? '암호 있음' : f.bad ? '' : '…'}</span><span class="sp"></span>
    <button class="btn sm" id="tmore">다른 PDF</button>`;
}

const dropHTML = (big) => `<label class="tdrop ${big ? 'big' : ''}" for="tpicker"><span class="plus">${IC.plus}</span><b>PDF 추가</b></label>`;
function fileState(f) {
  if (f.bad) return `<span class="pill fail">${esc(f.bad)}</span>`;
  if (f.locked) return `<span class="pill lock">${IC.lock}암호 있음</span>`;
  if (!f.pages) return '<span class="pill wait">읽는 중</span>';
  return '';
}
function stageMerge() {
  const total = S.files.reduce((n, f) => n + (f.pages || 0), 0);
  if (!S.files.length) return dropHTML(true);
  return `<ul class="trows" id="trows">${S.files.map((f, i) => `
    <li class="trow" data-key="${f.id}">
      <span class="grip">${IC.grip}</span><span class="tno">${i + 1}</span>
      <span class="tmini">${f.pages ? img(f, 0, 64) : ''}</span>
      <div class="f-meta"><div class="f-name">${esc(f.name)}</div></div>
      ${fileState(f) || `<span class="pc">${f.pages}쪽</span>`}
      <button class="x" data-rm="${f.id}" aria-label="빼기" data-nodrag>${IC.x}</button>
    </li>`).join('')}</ul>${dropHTML(false)}<span hidden data-total="${total}"></span>`;
}
function stagePw() {
  if (!S.files.length) return dropHTML(true);
  return `<ul class="trows">${S.files.map(f => `
    <li class="trow static">
      <span class="badge sm" style="--c:var(--c-doc)">pdf</span>
      <div class="f-meta"><div class="f-name">${esc(f.name)}</div></div>
      ${f.bad ? `<span class="pill fail">${esc(f.bad)}</span>` : f.locked ? `<span class="pill lock">${IC.lock}암호 있음</span>` : f.pages ? `<span class="pill wait">${IC.open}암호 없음</span>` : '<span class="pill wait">읽는 중</span>'}
      <button class="x" data-rm="${f.id}" aria-label="빼기">${IC.x}</button>
    </li>`).join('')}</ul>${dropHTML(false)}`;
}
function splitGroupsSafe(f) {
  try {
    if (S.split.mode === 'range' && !S.split.range.trim()) return { g: null };
    return { g: splitGroupsLocal(S.split.mode, f.pages, S.split.range, S.split.every) };
  } catch (e) { return { g: null, err: e.message }; }
}
// ops.js를 아직 안 불러왔을 때도 미리보기를 그리려고 같은 규칙을 여기 둔다
function splitGroupsLocal(mode, total, range, every) {
  if (mode === 'one') return Array.from({ length: total }, (_, i) => [i + 1, i + 1]);
  if (mode === 'every') { const n = Math.max(1, Math.floor(+every || 1)); const g = []; for (let a = 1; a <= total; a += n) g.push([a, Math.min(total, a + n - 1)]); return g; }
  const groups = [];
  for (const part of String(range).split(/[,，\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*[-~]\s*(\d+)?$|^(\d+)$/);
    if (!m) throw new Error(`"${part}"은(는) 쪽 범위로 읽을 수 없어요`);
    let a, b; if (m[3]) a = b = +m[3]; else { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`${total}쪽까지만 있어요`);
    if (a > b) [a, b] = [b, a];
    groups.push([a, b]);
  }
  return groups;
}
function stageSplit(f) {
  const { g } = splitGroupsSafe(f);
  const gi = (n) => g ? g.findIndex(([a, b]) => n >= a && n <= b) : -1;
  return `<div class="thumbs">${Array.from({ length: f.pages }, (_, i) => {
    const k = gi(i + 1), c = k < 0 ? '' : `--g:${GROUP_C[k % GROUP_C.length]}`;
    return `<div class="th ${k < 0 ? 'out' : 'grp'}" style="${c}"><span class="frame">${img(f, i, 160)}</span><span class="no">${i + 1}</span></div>`;
  }).join('')}</div>`;
}
function stageOrg(f) {
  ensureOrg(f);
  return `<div class="thumbs" id="othumbs">${S.org.pages.map((p, i) => `
    <button class="th ${p.sel ? 'sel' : ''} ${p.del ? 'del' : ''}" data-key="${p.key}" aria-pressed="${p.sel}" aria-label="${i + 1}쪽">
      <span class="frame">${p.src < 0 ? `<span class="blank" style="transform:rotate(${p.rot}deg)"></span>` : img(f, p.src, 160, `style="transform:rotate(${p.rot}deg)"`)}</span>
      <span class="no">${i + 1}${p.src < 0 ? ' · 빈 쪽' : ''}</span>${p.del ? '<span class="tag">지움</span>' : ''}
    </button>`).join('')}</div>`;
}
const pageAt = (f) => Math.min(S.view, f.pages - 1);
function pager(f) {
  if (f.pages < 2) return '';
  const v = pageAt(f);
  return `<div class="pager"><button class="x" data-view="-1" aria-label="이전 쪽" ${v <= 0 ? 'disabled' : ''}>${IC.prev}</button><span>${v + 1} / ${f.pages}</span><button class="x" data-view="1" aria-label="다음 쪽" ${v >= f.pages - 1 ? 'disabled' : ''}>${IC.next}</button></div>`;
}
function numText(n, t) { return [`${n}`, `${n} / ${t}`, `- ${n} -`, `${n}쪽`][S.num.style]; }
function stageNum(f) {
  const v = pageAt(f), sz = f.sizes?.[v] || { w: 595, h: 842 }, o = S.num;
  const skip = o.skipFirst ? 1 : 0;
  const m = Math.min(sz.w, sz.h) * 0.045 + 6, size = [9, 11, 14][o.size];
  const pos = `${o.pos[0] === 't' ? 'top' : 'bottom'}:${(m / sz.h * 100).toFixed(2)}%;` + (o.pos[1] === 'c' ? 'left:0;right:0;text-align:center' : `${o.pos[1] === 'l' ? 'left' : 'right'}:${(m / sz.w * 100).toFixed(2)}%`);
  const label = v < skip ? '' : numText(v - skip + o.start, f.pages - skip + o.start - 1);
  return `<div class="big"><div class="pgv" style="aspect-ratio:${sz.w}/${sz.h};--ar:${sz.w / sz.h}">${img(f, v, 640)}
    ${label ? `<span class="ov-num" style="${pos};font-size:${(size / sz.w * 100).toFixed(3)}cqw">${esc(label)}</span>` : ''}</div></div>${pager(f)}`;
}
const WM_CSS = { '빨강': '210,59,48', '회색': '115,120,128', '파랑': '62,92,245' };
function stageWm(f) {
  const v = pageAt(f), sz = f.sizes?.[v] || { w: 595, h: 842 }, o = S.wm;
  const scale = [0.35, 0.55, 0.8][o.size];
  const span = o.angle === 45 ? Math.hypot(sz.w, sz.h) * 0.9 : (o.angle ? sz.h : sz.w);
  let mark = '';
  if (o.kind === 'image') {
    if (o.imageUrl) mark = `<img class="ov-wm-img" src="${o.imageUrl}" alt="" style="width:${(span * scale / sz.w * 100).toFixed(2)}cqw;opacity:${o.opacity / 100};transform:rotate(${-o.angle}deg)">`;
  } else if (o.text.trim()) {
    const em = [...o.text.trim()].reduce((n, c) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 1 : 0.6), 0);
    const fs = Math.min(200, span * scale / Math.max(1, em));
    mark = `<span class="ov-wm" style="font-size:${(fs / sz.w * 100).toFixed(3)}cqw;color:rgba(${WM_CSS[o.color]},${o.opacity / 100});transform:rotate(${-o.angle}deg)">${esc(o.text.trim())}</span>`;
  }
  return `<div class="big"><div class="pgv" style="aspect-ratio:${sz.w}/${sz.h};--ar:${sz.w / sz.h}">${img(f, v, 640)}<div class="ov-c">${mark}</div></div></div>${pager(f)}`;
}
const CS = () => S.crop[S.crop.mode];
function cropVals(i) { const c = CS(); return S.crop.same ? c.all : (c.per[i] || c.all); }
function stageCrop(f) {
  const v = pageAt(f), sz = f.sizes?.[v] || { w: 595, h: 842 }, c = cropVals(v);
  const T = c.t * MM, B = c.b * MM, L = c.l * MM, R = c.r * MM;
  let html, w, h;
  if (S.crop.mode === 'trim') {
    w = sz.w - L - R; h = sz.h - T - B;
    html = `<div class="pgv" style="aspect-ratio:${sz.w}/${sz.h};--ar:${sz.w / sz.h}">${img(f, v, 640)}
      <span class="cropbox" style="top:${T / sz.h * 100}%;bottom:${B / sz.h * 100}%;left:${L / sz.w * 100}%;right:${R / sz.w * 100}%"><i></i><i></i><i></i><i></i></span></div>`;
  } else {
    w = sz.w + L + R; h = sz.h + T + B;
    html = `<div class="padf" style="aspect-ratio:${w}/${h};--ar:${w / h}"><div class="pgv in" style="top:${T / h * 100}%;bottom:${B / h * 100}%;left:${L / w * 100}%;right:${R / w * 100}%">${img(f, v, 640)}</div></div>`;
  }
  const bad = w < 36 || h < 36;
  const cap = `${Math.round(w / MM)} × ${Math.round(h / MM)} mm · ${S.crop.same ? '모든 장' : `${v + 1}쪽`}`;
  return `<div class="big ${S.crop.mode}">${html}</div><div class="cap ${bad ? 'bad' : ''}">${bad ? '너무 많이 잘랐어요' : cap}</div>${pager(f)}`;
}
function renderStage(anim) {
  const st = $('#tstage'), f = curFile(), keep = st.scrollTop;
  if (S.cat !== 'pdf') {
    st.innerHTML = `<div class="tview ${anim ? 'anim' : ''}" data-tool="${S.cat}">${more.stageHTML()}</div>`;
    st.scrollTop = keep; more.afterStage(st); return;
  }
  let html;
  if (S.tool === 'merge') html = stageMerge();
  else if (S.tool === 'pw') html = stagePw();
  else if (!f) html = dropHTML(true);
  else if (f.locked) html = `<div class="tmsg">${IC.lock}<b>암호가 걸린 PDF예요</b><button class="btn" data-go="pw">암호 풀러 가기</button></div>`;
  else if (f.bad) html = `<div class="tmsg"><b>${esc(f.bad)}</b></div>`;
  else if (!f.pages || !f.sizes) html = '<div class="tmsg"><span class="spin"></span></div>';
  else html = ({ split: stageSplit, org: stageOrg, num: stageNum, wm: stageWm, crop: stageCrop })[S.tool](f);
  st.innerHTML = `<div class="tview ${anim ? 'anim' : ''}" data-tool="${S.tool}">${html}</div>`;
  st.scrollTop = keep;
  hydrate(st);
}

/* ---------- 설정 패널 ---------- */
function segHTML(path, items, cur) {
  return `<div class="seg" role="radiogroup" data-seg="${path}"><span class="ind"></span>${items.map(([v, label]) => `<button role="radio" aria-checked="${String(cur) === String(v)}" data-v="${v}"><span>${label}</span></button>`).join('')}</div>`;
}
const sub = (t, extra = '') => `<h3 class="sub">${t}${extra}</h3>`;
function check(path, on, label) { return `<label class="check"><input type="checkbox" data-chk="${path}" ${on ? 'checked' : ''}><span>${label}</span></label>`; }
function pwField(path, val, ph) {
  return `<div class="pw-field"><input type="password" data-in="${path}" value="${esc(val)}" placeholder="${ph}" autocomplete="new-password" autocapitalize="off" spellcheck="false"><button class="pw-eye" type="button" data-eye aria-label="암호 보기" aria-pressed="false">${IC.eye}</button></div>`;
}
function panelBody() {
  const f = curFile();
  const o = S;
  switch (S.tool) {
    case 'merge': {
      const total = S.files.reduce((n, x) => n + (x.pages || 0), 0);
      const ph = S.files[0] ? S.files[0].name.replace(/\.pdf$/i, '') + '_합본' : '합친문서';
      return `<div>${sub('결과 파일 이름')}<input class="field" data-in="mergeName" value="${esc(o.mergeName)}" placeholder="${esc(ph)}" aria-label="결과 파일 이름"></div>
        <div class="stats"><div><span>파일</span><b>${S.files.length}</b></div><div><span>총 쪽수</span><b>${total}</b></div></div>`;
    }
    case 'split': {
      const r = f && usable(f) ? splitGroupsSafe(f) : { g: null };
      return `<div>${sub('나누는 방식')}${segHTML('split.mode', [['range', '범위로'], ['one', '한 쪽씩'], ['every', 'N쪽마다']], o.split.mode)}</div>
        ${o.split.mode === 'range' ? `<div>${sub('쪽 범위')}<input class="field mono" data-in="split.range" value="${esc(o.split.range)}" placeholder="${f?.pages ? `1-3, 4-${f.pages}` : '1-3, 5'}" inputmode="text" aria-label="쪽 범위"></div>` : ''}
        ${o.split.mode === 'every' ? `<div>${sub('몇 쪽마다')}<input class="field mono" type="number" min="1" data-in="split.every" data-num value="${o.split.every}" aria-label="몇 쪽마다"></div>` : ''}
        <div id="splitRes">${splitRes(r)}</div>`;
    }
    case 'org': {
      const n = S.org.pages.filter(p => p.sel).length;
      return `<div>${sub('고르기')}<div class="links"><button data-orgsel="all">모두</button><button data-orgsel="odd">홀수 쪽</button><button data-orgsel="even">짝수 쪽</button><button data-orgsel="none">해제</button></div></div>
        <div>${sub(`고른 쪽 · ${n ? n + '쪽' : '없음'}`)}
        <div class="grid2">
          <button class="btn ic" data-org="rotL" ${n ? '' : 'disabled'}>${IC.rotL}왼쪽으로</button>
          <button class="btn ic" data-org="rotR" ${n ? '' : 'disabled'}>${IC.rotR}오른쪽으로</button>
          <button class="btn ic danger" data-org="del" ${n ? '' : 'disabled'}>${IC.trash}지우기</button>
          <button class="btn ic" data-org="blank">${IC.page}빈 쪽 넣기</button>
        </div></div>
        <button class="btn ghosty" data-org="reset">처음 상태로</button>`;
    }
    case 'num': {
      const POS = [['tl', '위 왼쪽'], ['tc', '위 가운데'], ['tr', '위 오른쪽'], ['bl', '아래 왼쪽'], ['bc', '아래 가운데'], ['br', '아래 오른쪽']];
      return `<div>${sub('위치')}<div class="posg" role="radiogroup" aria-label="위치">${POS.map(([v, l]) => `<button role="radio" aria-checked="${o.num.pos === v}" data-pos="${v}" aria-label="${l}" class="p-${v}"><i></i></button>`).join('')}</div></div>
        <div>${sub('모양')}${segHTML('num.style', [[0, '1'], [1, '1 / 12'], [2, '- 1 -'], [3, '1쪽']], o.num.style)}</div>
        <div>${sub('글자 크기')}${segHTML('num.size', [[0, '작게'], [1, '보통'], [2, '크게']], o.num.size)}</div>
        <div class="row2"><div>${sub('시작 번호')}<input class="field mono" type="number" min="0" data-in="num.start" data-num value="${o.num.start}" aria-label="시작 번호"></div></div>
        ${check('num.skipFirst', o.num.skipFirst, '첫 쪽(표지)에는 넣지 않기')}`;
    }
    case 'wm':
      return `<div>${sub('종류')}${segHTML('wm.kind', [['text', '글자'], ['image', '이미지']], o.wm.kind)}</div>
        ${o.wm.kind === 'text'
          ? `<div>${sub('글자')}<input class="field" data-in="wm.text" value="${esc(o.wm.text)}" maxlength="60" aria-label="워터마크 글자"></div>
             <div>${sub('색')}${segHTML('wm.color', [['빨강', '빨강'], ['회색', '회색'], ['파랑', '파랑']], o.wm.color)}</div>`
          : `<div>${sub('이미지')}<button class="btn ic wide" id="wmPick">${IC.img}<span class="ell">${o.wm.image ? esc(o.wm.image.name) : 'PNG·JPG 고르기'}</span></button></div>`}
        <div class="range">${sub('투명도', `<span class="val" id="wmOpv">${o.wm.opacity}%</span>`)}<input type="range" min="5" max="90" value="${o.wm.opacity}" data-in="wm.opacity" data-num style="--v:${(o.wm.opacity - 5) / 85 * 100}%" aria-label="투명도"></div>
        <div>${sub('각도')}${segHTML('wm.angle', [[0, '가로'], [45, '대각선'], [90, '세로']], o.wm.angle)}</div>
        <div>${sub('크기')}${segHTML('wm.size', [[0, '작게'], [1, '보통'], [2, '크게']], o.wm.size)}</div>`;
    case 'pw': {
      const locked = S.files.filter(x => x.locked).length, open = S.files.filter(usable).length;
      return `${segHTML('pw.mode', [['lock', '암호 걸기'], ['unlock', '암호 풀기']], o.pw.mode)}
        ${o.pw.mode === 'lock'
          ? `<div>${sub('새 암호')}${pwField('pw.pw', o.pw.pw, '암호')}</div>
             <div>${sub('암호 확인')}${pwField('pw.pw2', o.pw.pw2, '한 번 더')}</div>
             <div class="checks">${sub('열어 본 사람에게 허용')}${check('pw.print', o.pw.print, '인쇄')}${check('pw.copy', o.pw.copy, '글자 복사')}${check('pw.modify', o.pw.modify, '내용 고치기')}</div>
             <p class="p-note">${open ? `PDF ${open}개에 AES-256 암호를 걸어요` : '암호가 없는 PDF를 넣어 주세요'}</p>`
          : `<div>${sub('지금 암호')}${pwField('pw.unpw', o.pw.unpw, '암호')}</div>
             <p class="p-note">${locked ? `암호가 있는 PDF ${locked}개를 풀어요` : '암호가 있는 PDF를 넣어 주세요'}</p>`}`;
    }
    case 'crop': {
      const v = f && usable(f) ? pageAt(f) : 0, c = cropVals(v);
      const box = (k, l) => `<label>${l}<span class="box"><input type="number" min="0" max="200" step="0.5" inputmode="decimal" data-crop="${k}" value="${c[k]}"><span class="u">mm</span></span></label>`;
      return `${segHTML('crop.mode', [['trim', '자르기'], ['pad', '여백 넣기']], o.crop.mode)}
        <div>${sub(o.crop.mode === 'trim' ? '잘라낼 양' : '넣을 여백', o.crop.same ? '' : `<span class="val">${v + 1}쪽</span>`)}<div class="num4">${box('t', '위')}${box('b', '아래')}${box('l', '왼쪽')}${box('r', '오른쪽')}</div></div>
        ${o.crop.mode === 'trim' ? `<button class="btn ic wide" id="autoTrim" ${S.finding ? 'disabled' : ''}>${IC.spark}${S.finding ? '찾는 중…' : '흰 여백 자동으로 찾기'}</button>` : ''}
        ${check('crop.same', o.crop.same, '모든 장에 같게')}
        ${!o.crop.same && f && usable(f) ? `<div class="fadeIn">${sub('설정할 쪽')}<div class="strip scroll-x">${Array.from({ length: f.pages }, (_, i) => `<button class="${i === v ? 'on' : ''} ${CS().per[i] ? 'set' : ''}" data-viewto="${i}" aria-label="${i + 1}쪽">${img(f, i, 72)}<span>${i + 1}</span></button>`).join('')}</div></div>` : ''}`;
    }
  }
  return '';
}
function splitRes(r) {
  if (r.err) return `<p class="p-note bad">${esc(r.err)}</p>`;
  if (!r.g) return '';
  const chips = r.g.slice(0, 40).map(([a, b], i) => `<span class="gchip" style="--g:${GROUP_C[i % GROUP_C.length]}">${a === b ? a : `${a}-${b}`}</span>`).join('') + (r.g.length > 40 ? '<span class="gchip">…</span>' : '');
  return `${sub('결과')}<div class="gchips">${chips}</div><p class="p-note">${r.g.length === 1 ? 'PDF 1개' : `PDF ${r.g.length}개 → ZIP`}</p>`;
}
function actionLabel() {
  return { merge: '합치기', split: '나누기', org: '저장', num: '번호 넣기', wm: '워터마크 넣기', pw: S.pw.mode === 'lock' ? '암호 걸기' : '암호 풀기', crop: S.crop.mode === 'trim' ? '자르기' : '여백 넣기' }[S.tool];
}
function canRun() {
  const f = curFile();
  if (S.busy) return false;
  if (S.cat !== 'pdf') return more.canRun();
  if (S.tool === 'merge') return S.files.filter(usable).length >= 2;
  if (S.tool === 'pw') return S.pw.mode === 'lock' ? S.files.some(usable) : S.files.some(x => x.locked);
  return usable(f);
}
function renderApply() {
  const a = $('#tapply'); if (!a) return;
  const lab = S.cat === 'pdf' ? actionLabel() : more.label();
  a.innerHTML = `${S.err ? `<p class="t-err">${esc(S.err)}</p>` : S.note ? `<p class="t-note">${esc(S.note)}</p>` : ''}<button class="btn btn-primary" id="tRun" ${canRun() ? '' : 'disabled'}>${S.busy ? `<span class="spin sm"></span>처리 중${S.p > 0.01 ? ` ${Math.round(S.p * 100)}%` : ''}` : lab}</button>`;
}
function placeInd(segEl) {
  const ind = segEl.querySelector('.ind'), on = segEl.querySelector('[aria-checked="true"]'); if (!ind || !on) return;
  ind.style.width = on.offsetWidth + 'px'; ind.style.height = on.offsetHeight + 'px';
  ind.style.transform = `translate(${on.offsetLeft - 4}px,${on.offsetTop - 4}px)`;
}
function placeAll(instant) {
  document.querySelectorAll('#tpanel .seg').forEach(s => {
    const ind = s.querySelector('.ind'); if (instant && ind) ind.style.transition = 'none';
    placeInd(s);
    if (instant && ind) { void ind.offsetWidth; ind.style.transition = ''; }
  });
}
function renderPanel(animate) {
  const P = $('#tpanel'); const open = P.classList.contains('open');
  const keep = P.querySelector('.swap')?.scrollTop || 0;
  P.classList.remove('anim'); if (animate) { void P.offsetWidth; P.classList.add('anim'); }
  P.innerHTML = `<button class="p-title" id="tpTitle" aria-expanded="${open}"><span class="grab"></span><span class="t">${S.cat === 'pdf' ? TOOL_NAME[S.tool] : more.title()}</span><span class="peek">${S.cat === 'pdf' ? esc(curFile()?.name || '') : ''}</span>${IC.chev.replace('<svg', '<svg class="chev"')}</button>
    <div class="swap scroll">${S.cat === 'pdf' ? panelBody() : more.panelHTML()}</div><div class="apply col" id="tapply"></div>`;
  if (!animate) P.querySelector('.swap').scrollTop = keep;
  renderApply(); placeAll(true); hydrate(P);
}
// 패널만 다시 그리면 이미 그려 둔 썸네일도 다시 그려지지 않게 하이드레이트만 한다
function render(animate) {
  if (!$('#tapp') || $('#tapp').hidden) return;
  const tp = $('#tpicker');
  tp.accept = S.cat === 'pdf' ? 'application/pdf,.pdf' : more.accept();
  tp.multiple = !(S.cat === 'arc' && more.title() === '골라 받기');
  renderCats(); renderNav(); renderBar(); renderStage(animate); renderPanel(animate);
}
// more.js가 부르는 다시 그리기
function refresh(o) {
  if (!$('#tapp') || $('#tapp').hidden) return;
  if (o.all) return render();
  if (o.bar) renderBar();
  if (o.stage) renderStage();
  if (o.panel) renderPanel(false); else if (o.apply) renderApply();
}
export function addToolFiles(list) { if (S.cat === 'pdf') addPdfs(list); else more.add(list); }
function pickCat(k) {
  if (k === S.cat) return;
  S.cat = k; S.err = ''; S.note = ''; LS.set('uc-cat', k);
  render(true);
}

/* ---------- 동작 ---------- */
function setPath(path, v) { const ks = path.split('.'); let o = S; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = v; }
function getPath(path) { return path.split('.').reduce((o, k) => o?.[k], S); }
function setTPanel(open) {
  const P = $('#tpanel'); P.classList.toggle('open', open); document.body.classList.toggle('panel-open', open);
  $('#tpTitle')?.setAttribute('aria-expanded', open); if (open) requestAnimationFrame(() => placeAll(true));
}
function pickTool(k) {
  if (S.cat !== 'pdf') { more.pickTool(k); S.err = ''; S.note = ''; render(true); return; }
  if (k === S.tool) return;
  S.tool = k; S.err = ''; LS.set('uc-tool', k);
  if (!MULTI.has(k) && !usable(curFile())) { const u = S.files.find(usable); if (u) { S.cur = u.id; resetForFile(); } }
  renderNav(); renderBar(); renderStage(true); renderPanel(true);
  const btn = document.querySelector(`#tnav [data-tool="${k}"]`); btn?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
function saveAs(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function run() {
  if (!canRun()) return;
  S.busy = true; S.err = ''; S.note = ''; S.p = 0; renderApply();
  const prog = (p) => { S.p = p; const b = $('#tRun'); if (b && S.busy) b.innerHTML = `<span class="spin sm"></span>처리 중 ${Math.round(p * 100)}%`; };
  try {
    if (S.cat !== 'pdf') {
      const r = await more.exec(prog);
      if (r.each) { for (const [i, x] of r.each.entries()) { setTimeout(() => saveAs(x.blob, x.name), i * 350); } }
      else { saveAs(r.blob, r.name); if (r.cleanup) setTimeout(r.cleanup, 60000); }
      S.busy = false; renderApply();
      const b = $('#tRun'); if (b) { b.classList.add('done'); b.textContent = '받았어요'; setTimeout(() => { if (b.isConnected) { b.classList.remove('done'); b.textContent = more.label(); } }, 2200); }
      return;
    }
    const ops = await import('./ops.js');
    const f = curFile();
    let r;
    switch (S.tool) {
      case 'merge': {
        const list = S.files.filter(usable);
        if (S.files.some(x => x.locked)) throw new Error('암호가 걸린 PDF는 먼저 풀어 주세요');
        r = await ops.merge(list.map(x => x.file), S.mergeName.trim() || (list[0].name.replace(/\.pdf$/i, '') + '_합본'));
        break;
      }
      case 'split': {
        if (S.split.mode === 'range' && !S.split.range.trim()) throw new Error('쪽 범위를 적어 주세요');
        r = await ops.split(f.file, ops.splitGroups(S.split.mode, f.pages, S.split.range, S.split.every));
        break;
      }
      case 'org': ensureOrg(f); r = await ops.organize(f.file, S.org.pages); break;
      case 'num': r = await ops.pageNumbers(f.file, { ...S.num, start: Math.max(0, Math.floor(+S.num.start || 1)) }); break;
      case 'wm': r = await ops.watermark(f.file, S.wm); break;
      case 'crop': {
        const c = CS(); const per = S.crop.same ? () => c.all : (i) => c.per[i] || c.all;
        r = await ops.cropPad(f.file, S.crop.mode, per);
        break;
      }
      case 'pw': {
        const res = [];
        if (S.pw.mode === 'lock') {
          if (!S.pw.pw) throw new Error('암호를 적어 주세요');
          if (S.pw.pw !== S.pw.pw2) throw new Error('두 암호가 서로 달라요');
          for (const x of S.files.filter(usable)) res.push(await ops.lockPdf(x.file, S.pw.pw, S.pw))
        } else {
          if (!S.pw.unpw) throw new Error('지금 암호를 적어 주세요');
          for (const x of S.files.filter(y => y.locked)) {
            try { res.push(await ops.unlockPdf(x.file, S.pw.unpw)); }
            catch (e) { throw new Error(e.code === 'WRONG_PASSWORD' ? `${x.name}: 암호가 틀렸어요` : `${x.name}: ${e.message}`); }
          }
        }
        r = await ops.bundle(res, S.pw.mode === 'lock' ? 'PDF_암호.zip' : 'PDF_암호해제.zip');
        break;
      }
    }
    saveAs(r.blob, r.name);
    S.busy = false; renderApply();
    const b = $('#tRun'); if (b) { b.classList.add('done'); b.textContent = '받았어요'; setTimeout(() => { if (b.isConnected) { b.classList.remove('done'); b.textContent = actionLabel(); } }, 2200); }
  } catch (e) {
    console.error(e);
    S.busy = false; S.err = e?.message || '처리하지 못했어요';
    if (/memory|allocation/i.test(S.err)) S.err = '파일이 너무 커서 브라우저 메모리가 부족해요';
    renderApply();
  }
}
function orgAction(kind) {
  const P = S.org.pages, sel = P.filter(p => p.sel);
  if (kind === 'rotL' || kind === 'rotR') sel.forEach(p => { p.rot = (p.rot + (kind === 'rotL' ? 270 : 90)) % 360; });
  else if (kind === 'del') { const allDel = sel.every(p => p.del); sel.forEach(p => { p.del = !allDel; p.sel = false; }); }
  else if (kind === 'blank') {
    const last = P.map(p => p.sel).lastIndexOf(true);
    const at = last < 0 ? P.length : last + 1;
    P.splice(at, 0, { src: -1, rot: 0, del: false, sel: false, key: 'b' + (++tid) });
  } else if (kind === 'reset') { S.org.id = null; ensureOrg(curFile()); }
  renderStage(); renderPanel(false);
}

/* ---------- 끌어서 순서 바꾸기 (마우스 + 터치 길게 누르기) ---------- */
function sortable(root, sel, grid, onDrop) {
  let st = null, suppress = false;
  const clear = () => root.querySelectorAll('.before,.after').forEach(x => x.classList.remove('before', 'after'));
  const mark = (x, y) => {
    clear();
    const t = document.elementFromPoint(x, y)?.closest?.(sel);
    if (!t || t === st.it || !root.contains(t)) return;
    const b = t.getBoundingClientRect();
    t.classList.add((grid(t) ? x < b.left + b.width / 2 : y < b.top + b.height / 2) ? 'before' : 'after');
  };
  const begin = () => { st.active = true; st.it.classList.add('lifted'); root.classList.add('sorting'); try { navigator.vibrate?.(10); } catch { /* 없음 */ } };
  const move = (x, y) => { st.it.style.transform = `translate(${x - st.x}px,${y - st.y}px) scale(1.03)`; mark(x, y); };
  const finish = () => {
    if (!st) return; clearTimeout(st.timer);
    if (st.active) {
      suppress = true; setTimeout(() => { suppress = false; }, 350);
      const t = root.querySelector('.before,.after'); const after = t?.classList.contains('after');
      clear(); st.it.classList.remove('lifted'); st.it.style.transform = ''; root.classList.remove('sorting');
      if (t) onDrop(st.it.dataset.key, t.dataset.key, after);
    }
    st = null;
  };
  root.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('[data-nodrag]')) return;
    const it = e.target.closest(sel); if (!it) return;
    st = { it, x: e.clientX, y: e.clientY, active: false };
  });
  window.addEventListener('mousemove', e => {
    if (!st || st.touch) return;
    if (!st.active) { if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return; begin(); }
    e.preventDefault(); move(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => { if (st && !st.touch) finish(); });
  root.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest('[data-nodrag]')) return;
    const it = e.target.closest(sel); if (!it) return;
    const t = e.touches[0];
    st = { it, x: t.clientX, y: t.clientY, active: false, touch: true };
    st.timer = setTimeout(() => { if (st) begin(); }, 380);
  }, { passive: true });
  root.addEventListener('touchmove', e => {
    if (!st) return; const t = e.touches[0];
    if (!st.active) { if (Math.hypot(t.clientX - st.x, t.clientY - st.y) > 8) { clearTimeout(st.timer); st = null; } return; }
    e.preventDefault(); move(t.clientX, t.clientY);
  }, { passive: false });
  root.addEventListener('touchend', finish);
  root.addEventListener('touchcancel', finish);
  root.addEventListener('contextmenu', e => { if (st) e.preventDefault(); });
  root.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
  root.addEventListener('dragstart', e => { if (e.target.closest(sel)) e.preventDefault(); });
}
function moveKey(list, from, to, after, key) {
  const i = list.findIndex(x => key(x) === from); if (i < 0) return;
  const [m] = list.splice(i, 1);
  let j = list.findIndex(x => key(x) === to); if (j < 0) { list.splice(i, 0, m); return; }
  if (after) j++; list.splice(j, 0, m);
}

/* ---------- 변환 ↔ PDF 도구 ---------- */
let spin = 0;
function placeBar(instant) {
  const on = document.querySelector('#modes [aria-pressed="true"]'), bar = $('#modeBar'); if (!on || !bar) return;
  if (instant) bar.style.transition = 'none';
  bar.style.width = on.offsetWidth + 'px'; bar.style.transform = `translateX(${on.offsetLeft}px)`;
  if (instant) { void bar.offsetWidth; bar.style.transition = ''; }
}
export function setMode(m, animate) {
  if (m !== 'tool') m = 'conv';
  const changed = document.body.dataset.mode !== m;
  document.body.dataset.mode = m; LS.set('uc-mode', m);
  document.querySelectorAll('#modes [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  $('#capp').hidden = m !== 'conv'; $('#tapp').hidden = m !== 'tool';
  document.body.classList.remove('panel-open');
  $('#panel')?.classList.remove('open'); $('#tpanel')?.classList.remove('open');
  placeBar(!animate);
  if (animate && changed) {
    spin++;
    const o = document.querySelector('.logo .o svg'); if (o) o.style.transform = `rotate(${spin * 180}deg)`;
    const mk = document.querySelector('.logo .mark');
    if (mk) { mk.classList.remove('popA', 'popB'); void mk.getBoundingClientRect(); mk.classList.add(spin % 2 ? 'popA' : 'popB'); }
    const app = m === 'tool' ? $('#tapp') : $('#capp');
    app.classList.remove('swapin'); void app.offsetWidth; app.classList.add('swapin');
    app.addEventListener('animationend', (ev) => { if (ev.target === app) app.classList.remove('swapin'); });
  }
  if (m === 'tool') render(animate);
  window.dispatchEvent(new Event('resize'));
}
export const isToolMode = () => document.body.dataset.mode === 'tool';

export function initTools() {
  $('#modeToggle').addEventListener('click', () => setMode(isToolMode() ? 'conv' : 'tool', true));
  $('#modes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode, true); });
  window.addEventListener('resize', () => { placeBar(true); if (isToolMode()) placeAll(true); });
  document.fonts?.ready.then(() => placeBar(true));

  more.init({ S, IC, esc, segHTML, sub, check, pwField, refresh });
  $('#tpicker').addEventListener('change', e => { addToolFiles(e.target.files); e.target.value = ''; });
  $('#tcats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) pickCat(b.dataset.cat); });
  $('#wmPicker').addEventListener('change', e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { S.err = '워터마크 이미지는 PNG나 JPG만 돼요'; renderApply(); return; }
    if (S.wm.imageUrl) URL.revokeObjectURL(S.wm.imageUrl);
    S.wm.image = file; S.wm.imageUrl = URL.createObjectURL(file); S.err = '';
    renderStage(); renderPanel(false);
  });
  $('#tnav').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) pickTool(b.dataset.tool); });
  $('#tbar').addEventListener('click', e => { if (S.cat !== 'pdf') return more.onBar(e.target, 'click'); if (e.target.closest('#tmore')) $('#tpicker').click(); });
  $('#tbar').addEventListener('change', e => { if (S.cat !== 'pdf') return more.onBar(e.target, 'change'); if (e.target.id === 'tcur') { S.cur = +e.target.value; resetForFile(); S.err = ''; render(); } });

  const stage = $('#tstage');
  stage.addEventListener('click', e => {
    if (S.cat !== 'pdf') { more.onStageClick(e.target); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { removeFile(+rm.dataset.rm); return; }
    const go = e.target.closest('[data-go]'); if (go) { pickTool(go.dataset.go); return; }
    const pv = e.target.closest('[data-view]');
    if (pv) { const f = curFile(); S.view = Math.max(0, Math.min(f.pages - 1, pageAt(f) + +pv.dataset.view)); renderStage(); if (S.tool === 'crop') renderPanel(false); return; }
    const th = e.target.closest('#othumbs .th');
    if (th) { const p = S.org.pages.find(x => x.key === th.dataset.key); if (p) { p.sel = !p.sel; th.classList.toggle('sel', p.sel); th.setAttribute('aria-pressed', p.sel); renderPanel(false); } }
  });
  // 합치기 목록·쪽 정리 썸네일 끌어서 순서 바꾸기 (목록은 위아래, 썸네일은 좌우로 자리를 가린다)
  sortable(stage, '.trow:not(.static), #othumbs .th', (t) => t.classList.contains('th'), (from, to, after) => {
    if (S.tool === 'merge') { moveKey(S.files, +from, +to, after, x => x.id); renderStage(); renderPanel(false); }
    else if (S.tool === 'org') { moveKey(S.org.pages, from, to, after, x => x.key); renderStage(); }
  });

  const P = $('#tpanel');
  P.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#tpTitle')) { if (phone.matches) setTPanel(!P.classList.contains('open')); return; }
    if (t.closest('#tRun')) { run(); return; }
    const eye0 = t.closest('[data-eye]');
    if (eye0) { const inp = eye0.parentElement.querySelector('input'); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye0.setAttribute('aria-pressed', show); return; }
    const sg = t.closest('.seg [data-v]');
    if (sg && sg.closest('.seg').dataset.seg.startsWith('m:')) { S.err = ''; S.note = ''; more.onSeg(sg.closest('.seg').dataset.seg.slice(2), sg.dataset.v); return; }
    if (S.cat !== 'pdf') { S.note = ''; more.onPanelClick(t); return; }
    if (sg) {
      const path = sg.closest('.seg').dataset.seg; const old = getPath(path);
      const v = typeof old === 'number' ? +sg.dataset.v : sg.dataset.v;
      if (v === old) return;
      setPath(path, v); S.err = '';
      if (path === 'crop.mode' || path === 'wm.kind' || path === 'pw.mode' || path === 'split.mode') { renderStage(); renderPanel(false); }
      else { sg.closest('.seg').querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-checked', b === sg)); placeInd(sg.closest('.seg')); renderStage(); renderApply(); }
      return;
    }
    const pos = t.closest('[data-pos]');
    if (pos) { S.num.pos = pos.dataset.pos; P.querySelectorAll('[data-pos]').forEach(b => b.setAttribute('aria-checked', b === pos)); renderStage(); return; }
    const os = t.closest('[data-orgsel]');
    if (os) { const k = os.dataset.orgsel; S.org.pages.forEach((p, i) => { p.sel = k === 'all' || (k === 'odd' && i % 2 === 0) || (k === 'even' && i % 2 === 1); }); renderStage(); renderPanel(false); return; }
    const oa = t.closest('[data-org]'); if (oa) { orgAction(oa.dataset.org); return; }
    const vt = t.closest('[data-viewto]'); if (vt) { S.view = +vt.dataset.viewto; renderStage(); renderPanel(false); return; }
    const eye = t.closest('[data-eye]');
    if (eye) { const inp = eye.parentElement.querySelector('input'); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye.setAttribute('aria-pressed', show); return; }
    if (t.closest('#wmPick')) { $('#wmPicker').click(); return; }
    if (t.closest('#autoTrim')) { autoTrim(); return; }
    if (t.closest('#tRun')) run();
  });
  P.addEventListener('input', e => {
    const t = e.target;
    if (S.cat !== 'pdf') { S.err = ''; more.onInput(t); return; }
    if (t.dataset.in) {
      const v = 'num' in t.dataset ? (t.value === '' ? '' : +t.value) : t.value;
      setPath(t.dataset.in, v); S.err = '';
      if (t.dataset.in === 'wm.opacity') { t.style.setProperty('--v', `${(v - 5) / 85 * 100}%`); $('#wmOpv').textContent = v + '%'; }
      if (t.dataset.in === 'split.range' || t.dataset.in === 'split.every') { const f = curFile(); if (usable(f)) $('#splitRes').innerHTML = splitRes(splitGroupsSafe(f)); }
      if (/^(split|num|wm)\./.test(t.dataset.in)) renderStage();
      renderApply();
      return;
    }
    if (t.dataset.crop) {
      const f = curFile(); const v = pageAt(f);
      const val = Math.max(0, Math.min(200, parseFloat(t.value) || 0));
      const cs = CS();
      if (S.crop.same) cs.all = { ...cs.all, [t.dataset.crop]: val };
      else { cs.per[v] = { ...cropVals(v), [t.dataset.crop]: val }; P.querySelector(`[data-viewto="${v}"]`)?.classList.add('set'); }
      renderStage(); S.err = ''; renderApply();
    }
  });
  P.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.chk?.startsWith('m:')) { S.err = ''; more.onCheck(t.dataset.chk.slice(2), t.checked); return; }
    if (t.dataset.chk) {
      setPath(t.dataset.chk, t.checked);
      if (t.dataset.chk === 'crop.same' && !t.checked) { S.crop.trim.per = {}; S.crop.pad.per = {}; }
      renderStage(); renderPanel(false);
    }
  });
  P.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])')) run(); });
  let ty = null;
  P.addEventListener('touchstart', e => { if (e.target.closest('#tpTitle')) ty = e.touches[0].clientY; }, { passive: true });
  P.addEventListener('touchend', e => {
    if (ty == null) return; const dy = e.changedTouches[0].clientY - ty; ty = null;
    if (dy > 40) setTPanel(false); else if (dy < -40) setTPanel(true);
  }, { passive: true });
  $('#pscrim').addEventListener('click', () => setTPanel(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setTPanel(false); });
  phone.addEventListener?.('change', () => { if (!phone.matches) setTPanel(false); });

  setMode(LS.get('uc-mode') === 'tool' ? 'tool' : 'conv', false);
}

async function autoTrim() {
  const f = curFile(); if (!usable(f) || S.finding) return;
  S.finding = true; renderPanel(false);
  try {
    const pages = S.crop.same ? Array.from({ length: f.pages }, (_, i) => i) : [pageAt(f)];
    const m = await findMargins(f, pages);
    if (S.crop.same) S.crop.trim.all = m; else S.crop.trim.per[pageAt(f)] = m;
  } catch { S.err = '여백을 찾지 못했어요'; }
  S.finding = false; renderStage(); renderPanel(false);
}
