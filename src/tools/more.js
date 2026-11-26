// 이미지 · 영상/오디오 · 압축 도구 화면 (PDF 도구는 ui.js)
import { extOf, catOf } from '../formats.js';

let K = null;           // ui.js가 넘겨주는 공용 도구 (상태 S, 그리기 함수 등)
export function init(api) { K = api; }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 없음 */ } } };
export const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${Math.round(b / 1024)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
const fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const parseTime = (v) => { const p = String(v).trim().split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, x) => a * 60 + x, 0); };

export const TOOLS = {
  img: [['compress', '압축'], ['resize', '크기 바꾸기'], ['rotate', '자르기·돌리기'], ['exif', '위치정보 지우기']],
  media: [['trim', '구간 자르기'], ['audio', '소리만 빼기'], ['shrink', '용량 줄이기'], ['gif', 'GIF 만들기']],
  arc: [['pick', '골라 받기'], ['pack', '묶기']],
};
const NAMES = Object.fromEntries(Object.values(TOOLS).flat());
// 저장된 값은 실제 있는 도구 이름일 때만 쓴다
const saved = (() => {
  try {
    const o = JSON.parse(LS.get('uc-tools2') || '{}'), out = {};
    for (const c of Object.keys(TOOLS)) if (typeof o?.[c] === 'string' && TOOLS[c].some(t => t[0] === o[c])) out[c] = o[c];
    return out;
  } catch { return {}; }
})();
const MAX_PACK = 1.5 * 1024 ** 3, MAX_EACH = 20;
const M = {
  tool: { img: 'compress', media: 'trim', arc: 'pick', ...saved },
  imgs: [], img: { cmp: 'q', q: 80, target: 1024 * 1024, fmt: 'auto', rs: 'long', pct: 50, long: 1920, pw: '', ph: '', lock: true, noUp: true,
    ratio: '원본', rot: 0, fx: false, fy: false, same: true, per: {}, pos: {}, sel: null, gps: true, cam: true, date: false },
  media: [], med: { cur: null, s: 0, e: 0, fast: true, afmt: 'mp3', abr: '192', goal: 25, goalSel: 'msg', res: '720p', mute: false, gifW: 480, fps: 15, loop: true },
  arc: { file: null, entries: null, need: false, pw: '', off: new Set(), open: new Set(), mode: 'zip', packs: [], name: '', fmt: 'zip', level: 5, lock: false, ppw: '' },
};
let mid = 0;
const tool = () => M.tool[K.S.cat];
export const title = () => NAMES[tool()];
const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const I = {
  compress: sv('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  resize: sv('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  rotate: sv('<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>'),
  exif: sv('<path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z"/><path d="M4 4l16 16"/>'),
  trim: sv('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
  audio: sv('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  shrink: sv('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
  gif: sv('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10H8v4h2v-2M13 10v4M16 14v-4h2"/>'),
  pick: sv('<path d="M21 8v12a1 1 0 01-1 1H4a1 1 0 01-1-1V8"/><path d="M1 3h22v5H1zM12 11v6M9 14l3 3 3-3"/>'),
  pack: sv('<path d="M21 8v12a1 1 0 01-1 1H4a1 1 0 01-1-1V8"/><path d="M1 3h22v5H1zM12 17v-6M9 14l3-3 3 3"/>'),
  fold: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  tick: sv('<path d="M5 12l5 5 9-10"/>', 'stroke-width="3.2"'),
  dash: sv('<path d="M6 12h12"/>', 'stroke-width="3.2"'),
  caret: sv('<path d="M9 6l6 6-6 6"/>', 'stroke-width="2.4"'),
  flipH: sv('<path d="M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5"/>', 'stroke-width="2.2"'),
  flipV: sv('<path d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5"/>', 'stroke-width="2.2"'),
  link: sv('<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>', 'stroke-width="2.2"'),
};
export const icon = (k) => I[k] || '';
export function navHTML() {
  return TOOLS[K.S.cat].map(([k, label]) => `<button class="tn ${k === tool() ? 'on' : ''}" data-tool="${k}" aria-pressed="${k === tool()}">${I[k]}<span>${label}</span></button>`).join('');
}
export function pickTool(k) { M.tool[K.S.cat] = k; LS.set('uc-tools2', JSON.stringify(M.tool)); }
export function accept() {
  if (K.S.cat === 'img') return 'image/*,.heic,.heif,.avif,.tif,.tiff';
  if (K.S.cat === 'media') return 'video/*,audio/*,.mkv,.mov,.m4a,.flac,.opus';
  if (tool() === 'pick') return '.zip,.7z,.rar,.tar,.gz,.tgz,.bz2,.xz';
  return '';
}
const dropHTML = (big, label) => `<label class="tdrop ${big ? 'large' : ''}" for="tpicker"><span class="plus">${K.IC.plus}</span><b>${label}</b></label>`;

/* ---------- 파일 넣기 ---------- */
let imgQueue = Promise.resolve();
export function add(list) {
  const all = [...list], cat = K.S.cat;
  let n = 0;
  if (cat === 'img') {
    for (const file of all) {
      const ext = extOf(file.name); if (catOf(ext) !== 'img' || ext === 'ico') continue; n++;
      const e = { id: ++mid, file, name: file.name, ext, size: file.size, w: 0, h: 0, url: null, meta: null, res: null, bad: '' };
      M.imgs.push(e); M.img.sel ??= e.id;
      imgQueue = imgQueue.then(async () => {
        try { Object.assign(e, await (await import('./imgops.js')).info(file, ext)); }
        catch (err) { e.bad = err?.message === 'too big' ? '너무 큰 이미지예요' : '이미지를 읽지 못했어요'; }
        K.refresh({ stage: true, panel: true });
      });
    }
    K.S.err = n < all.length ? '이미지만 넣을 수 있어요' : '';
  } else if (cat === 'media') {
    for (const file of all) {
      const ext = extOf(file.name); const c = catOf(ext); if (c !== 'aud' && c !== 'vid') continue; n++;
      const e = { id: ++mid, file, name: file.name, ext, size: file.size, dur: 0, video: null, audio: false, frames: null, peaks: null, url: URL.createObjectURL(file), bad: '' };
      M.media.push(e);
      if (M.med.cur == null || !M.media.some(x => x.id === M.med.cur)) M.med.cur = e.id;
      loadMedia(e);
    }
    K.S.err = n < all.length ? '영상이나 오디오만 넣을 수 있어요' : '';
  } else if (tool() === 'pick') {
    const file = all.find(f => catOf(extOf(f.name)) === 'arc' || /\.(bz2|xz)$/i.test(f.name));
    K.S.err = file ? '' : '압축 파일(ZIP·7Z·RAR·TAR·GZ)을 넣어 주세요';
    if (file) { M.arc.file = { file, name: file.name, ext: extOf(file.name), size: file.size }; M.arc.pw = ''; openArchive(); }
  } else {
    let total = M.arc.packs.reduce((n, f) => n + f.size, 0); K.S.err = '';
    for (const file of all) {
      if (!file.size && !file.type && !/\.[^.]+$/.test(file.name)) continue;
      if (total + file.size > MAX_PACK) { K.S.err = '합쳐서 1.5GB까지만 묶을 수 있어요'; break; }
      total += file.size;
      M.arc.packs.push({ id: ++mid, file, name: file.name, ext: extOf(file.name), size: file.size });
    }
  }
  K.refresh({ all: true });
}
async function loadMedia(e) {
  const ops = await import('./mediaops.js');
  try {
    const p = await ops.probe(e.file);
    Object.assign(e, p);
    if (e.id === M.med.cur) { M.med.s = 0; M.med.e = p.dur; }
  } catch (err) { e.bad = err.message; }
  K.refresh({ stage: true, panel: true, bar: true });
  if (e.bad) return;
  try {
    if (e.video) e.frames = await ops.frames(e.file, 10, 160);
    else e.peaks = await ops.peaks(e.file, 90);
  } catch { /* 미리보기 없이 */ }
  if (e.id === M.med.cur) K.refresh({ stage: true });
}
let arcSeq = 0;
async function openArchive() {
  const a = M.arc, seq = ++arcSeq;
  a.entries = null; a.need = false; a.loading = true; a.off = new Set(); a.open = new Set(); a.listErr = '';
  K.refresh({ stage: true, panel: true });
  try {
    const list = await (await import('./arcops.js')).listArchive(a.file.file, a.file.ext, a.pw);
    if (seq !== arcSeq) return;
    a.entries = list; a.need = list.some(x => x.enc);
    if (list.filter(x => !x.dir).length <= 300) for (const e of list) if (e.dir) a.open.add(e.path);
    for (const e of list) { const top = e.path.split('/')[0]; if (e.path.includes('/')) a.open.add(top); }
  } catch (e) {
    if (seq !== arcSeq) return;
    if (e.code === 'NEED_PASSWORD' || e.code === 'WRONG_PASSWORD') { a.need = true; a.listErr = e.code === 'WRONG_PASSWORD' ? '암호가 틀렸어요' : ''; }
    else a.listErr = e.message || '압축 파일을 열지 못했어요';
  }
  a.loading = false;
  K.refresh({ stage: true, panel: true });
}
function removeItem(id) {
  for (const list of [M.imgs, M.media, M.arc.packs]) {
    const i = list.findIndex(x => x.id === id); if (i < 0) continue;
    const [x] = list.splice(i, 1);
    if (x.url) URL.revokeObjectURL(x.url);
    x.frames?.forEach(u => u && URL.revokeObjectURL(u));
    if (M.img.sel === id) M.img.sel = M.imgs[0]?.id ?? null;
    if (M.med.cur === id) { M.med.cur = M.media[0]?.id ?? null; const c = curMedia(); if (c) { M.med.s = 0; M.med.e = c.dur; } }
  }
  K.refresh({ all: true });
}

/* ---------- 이미지 화면 ---------- */
const curImg = () => M.imgs.find(x => x.id === M.img.sel) || M.imgs[0] || null;
const imgSet = (id) => M.img.same ? M.img : (M.img.per[id] ||= { ratio: M.img.ratio, rot: M.img.rot, fx: M.img.fx, fy: M.img.fy });
let newSizeFn = null;
import('./imgops.js').then(m => { newSizeFn = m.newSize; });
function cardLine(e) {
  const o = M.img;
  if (e.bad) return `<span class="ln bad">${esc(e.bad)}</span>`;
  if (!e.w) return '<span class="ln">읽는 중…</span>';
  if (tool() === 'compress') {
    if (!e.res) return `<span class="ln">${fmtSize(e.size)}</span>`;
    if (e.res.same) return `<span class="ln">${fmtSize(e.size)} · <b>이미 작아요</b></span>`;
    return `<span class="ln">${fmtSize(e.size)} → <b>${fmtSize(e.res.size)}</b><span class="good">−${Math.max(0, Math.round((1 - e.res.size / e.size) * 100))}%</span></span>`;
  }
  if (tool() === 'resize') {
    const [W, H] = newSizeFn ? newSizeFn(e.w, e.h, o) : [e.w, e.h];
    return `<span class="ln">${e.w}×${e.h} → <b>${W}×${H}</b></span>`;
  }
  // 위치정보
  if (!e.meta) return `<span class="ln">${['jpg', 'png', 'webp'].includes(e.ext) ? '<span class="mtag none">정보 없음</span>' : '<span class="mtag none">다시 저장해서 모두 지워요</span>'}</span>`;
  const tags = [['gps', '위치'], ['cam', '카메라'], ['date', '날짜']].filter(([k]) => e.meta[k]);
  if (!tags.length) return '<span class="ln"><span class="mtag none">정보 없음</span></span>';
  return `<span class="ln">${tags.map(([k, l]) => `<span class="mtag ${e.cleaned || !o[k] ? (e.cleaned && o[k] ? 'gone' : 'found') : 'will'}">${l}</span>`).join('')}</span>`;
}
function stageImgGrid() {
  return `<div class="cards">${M.imgs.map(e => `
    <div class="mcard">
      <div class="mthumb">${e.url ? `<img src="${e.url}" alt="">` : '<span class="spin"></span>'}</div>
      <div class="mmeta"><span class="nm" title="${esc(e.name)}">${esc(e.name)}</span>${cardLine(e)}</div>
      <button class="x mx" data-rm="${e.id}" aria-label="빼기">${K.IC.x}</button>
    </div>`).join('')}</div>${dropHTML(false, '이미지 추가')}`;
}
function stageRotate() {
  const e = curImg();
  const set = e ? imgSet(e.id) : M.img;
  return `<div class="cropv">
      <div class="cropwrap" id="cropWrap">${e?.url ? `<canvas id="cropCv"></canvas><span class="cropbox2" id="cropBox"><i></i><i></i><i></i><i></i><b class="g1"></b><b class="g2"></b><b class="g3"></b><b class="g4"></b></span>` : '<span class="spin"></span>'}</div>
      <div class="cap" id="cropCap"></div>
    </div>
    <div class="istrip">${M.imgs.map(x => `<button class="${x.id === e?.id ? 'on' : ''}" data-sel="${x.id}" aria-label="${esc(x.name)}">${x.url ? `<img src="${x.url}" alt="">` : ''}</button>`).join('')}
      <label class="iadd" for="tpicker" aria-label="이미지 추가">${K.IC.plus}</label></div>
`;
}
let cropImg = null;
function drawCrop() {
  const e = curImg(), cv = document.getElementById('cropCv'), box = document.getElementById('cropBox'); if (!e || !cv || !box) return;
  const set = imgSet(e.id), pos = M.img.pos[e.id] || { cx: 0.5, cy: 0.5 };
  const go = async () => {
    if (!cropImg || cropImg.src !== e.url) { cropImg = new Image(); cropImg.src = e.url; await cropImg.decode().catch(() => {}); }
    const { transformed, cropRect } = await import('./imgops.js');
    const src = document.createElement('canvas'); src.width = cropImg.naturalWidth; src.height = cropImg.naturalHeight; src.getContext('2d').drawImage(cropImg, 0, 0);
    const t = transformed(src, set.rot, set.fx, set.fy);
    cv.width = t.width; cv.height = t.height; cv.getContext('2d').drawImage(t, 0, 0);
    cv.style.aspectRatio = `${t.width}/${t.height}`;
    const r = cropRect(t.width, t.height, set.ratio, pos.cx, pos.cy);
    Object.assign(box.style, { left: r.x / t.width * 100 + '%', top: r.y / t.height * 100 + '%', width: r.w / t.width * 100 + '%', height: r.h / t.height * 100 + '%' });
    box.classList.toggle('free', set.ratio === '원본');
    const side = ((set.rot % 360) + 360) % 180 !== 0, W = side ? e.h : e.w, H = side ? e.w : e.h;
    const R = cropRect(W, H, set.ratio, pos.cx, pos.cy);
    const cap = document.getElementById('cropCap'); if (cap) cap.textContent = `${Math.round(R.w)} × ${Math.round(R.h)}${M.img.same && M.imgs.length > 1 ? ' · 모든 사진' : ''}`;
  };
  go();
}
function bindCropDrag(root) {
  const box = root.querySelector('#cropBox'), wrap = root.querySelector('#cropWrap'); if (!box || !wrap) return;
  let st = null;
  box.addEventListener('pointerdown', ev => {
    const e = curImg(); if (!e || imgSet(e.id).ratio === '원본') return;
    ev.preventDefault();
    st = { x: ev.clientX, y: ev.clientY, pos: { ...(M.img.pos[e.id] || { cx: 0.5, cy: 0.5 }) }, id: e.id };
    box.setPointerCapture(ev.pointerId); box.classList.add('drag');
  });
  box.addEventListener('pointermove', ev => {
    if (!st) return;
    const r = wrap.querySelector('canvas').getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, st.pos.cx + (ev.clientX - st.x) / r.width));
    const cy = Math.min(1, Math.max(0, st.pos.cy + (ev.clientY - st.y) / r.height));
    M.img.pos[st.id] = { cx, cy }; drawCrop();
  });
  const end = () => { st = null; box.classList.remove('drag'); };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}

/* ---------- 영상 화면 ---------- */
const curMedia = () => M.media.find(x => x.id === M.med.cur) || M.media[0] || null;
export function barHTML() {
  if (K.S.cat !== 'media' || tool() === 'audio') return null;
  const f = curMedia(); if (!f) return null;
  const many = M.media.length > 1;
  const name = many ? `<label class="tsel"><select id="mcur" aria-label="파일 고르기">${M.media.map(x => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${K.IC.chev}</label>`
    : `<span class="f-name">${esc(f.name)}</span>`;
  return `<span class="badge sm" style="--c:var(${f.video ? '--c-vid' : '--c-aud'})">${esc(f.ext)}</span>${name}<span class="pc">${f.dur ? fmtTime(f.dur).replace(/\.\d$/, '') : ''} · ${fmtSize(f.size)}</span><span class="sp"></span><button class="btn sm" id="mmore">다른 파일</button>`;
}
function stageTimeline(f) {
  const o = M.med, D = f.dur || 1;
  const L = o.s / D * 100, W = (o.e - o.s) / D * 100;
  const strip = f.video
    ? `<div class="frames">${(f.frames || Array(10).fill(null)).map(u => u ? `<img src="${u}" alt="" draggable="false">` : '<i></i>').join('')}</div>`
    : `<div class="wavebar">${(f.peaks || Array(90).fill(0.15)).map((p, i) => `<i data-i="${i}" style="height:${Math.max(6, p * 100)}%"></i>`).join('')}</div>`;
  return `${f.video ? `<video class="mvid" id="mvid" src="${f.url}" controls playsinline preload="metadata"></video>` : `<audio class="maud" id="mvid" src="${f.url}" controls preload="metadata"></audio>`}
    <div class="tline" id="tline">${strip}
      <span class="tdim l" style="width:${L}%"></span><span class="tdim r" style="width:${100 - L - W}%"></span>
      <span class="trng" id="trng" style="left:${L}%;width:${W}%"><b class="hs" data-h="s"></b><b class="he" data-h="e"></b></span>
    </div>
    <div class="ttimes"><span>0:00</span><span class="acc" id="trange">${fmtTime(o.s)} – ${fmtTime(o.e)}</span><span>${fmtTime(D).replace(/\.\d$/, '')}</span></div>`;
}
function paintTimeline() {
  const f = curMedia(), o = M.med; if (!f) return;
  const D = f.dur || 1, L = o.s / D * 100, W = (o.e - o.s) / D * 100;
  const q = (s) => document.querySelector(s);
  if (q('#trng')) { q('#trng').style.left = L + '%'; q('#trng').style.width = W + '%'; q('.tdim.l').style.width = L + '%'; q('.tdim.r').style.width = (100 - L - W) + '%'; }
  if (q('#trange')) q('#trange').textContent = `${fmtTime(o.s)} – ${fmtTime(o.e)}`;
  const si = q('[data-t="s"]'), ei = q('[data-t="e"]');
  if (si && document.activeElement !== si) si.value = fmtTime(o.s);
  if (ei && document.activeElement !== ei) ei.value = fmtTime(o.e);
  const st = q('#mstats'); if (st) st.innerHTML = mediaStats();
  document.querySelectorAll('.wavebar i').forEach((b, i, all) => { const t = (i + 0.5) / all.length * D; b.classList.toggle('in', t >= o.s && t <= o.e); });
  K.refresh({ apply: true });
}
function bindTimeline(root) {
  const tl = root.querySelector('#tline'); if (!tl) return;
  const vid = root.querySelector('#mvid');
  let st = null;
  const tAt = (x) => { const r = tl.getBoundingClientRect(); const f = curMedia(); return Math.min(1, Math.max(0, (x - r.left) / r.width)) * (f?.dur || 0); };
  tl.addEventListener('pointerdown', ev => {
    const f = curMedia(); if (!f?.dur) return;
    ev.preventDefault(); // 그림을 끌어가는 기본 동작이 끼어들지 않게
    const h = ev.target.closest('[data-h]')?.dataset.h;
    const t = tAt(ev.clientX), o = M.med;
    if (h) st = { mode: h };
    else if (ev.target.closest('#trng')) st = { mode: 'move', t0: t, s: o.s, e: o.e };
    else { st = { mode: Math.abs(t - o.s) < Math.abs(t - o.e) ? 's' : 'e' }; move(ev); }
    tl.setPointerCapture(ev.pointerId); tl.classList.add('drag');
  });
  const move = (ev) => {
    if (!st) return;
    const f = curMedia(), D = f.dur, o = M.med, t = tAt(ev.clientX), minLen = Math.min(0.5, D);
    if (st.mode === 's') o.s = Math.min(t, o.e - minLen);
    else if (st.mode === 'e') o.e = Math.max(t, o.s + minLen);
    else { const len = st.e - st.s; o.s = Math.min(D - len, Math.max(0, st.s + t - st.t0)); o.e = o.s + len; }
    o.s = Math.max(0, Math.round(o.s * 10) / 10); o.e = Math.min(D, Math.round(o.e * 10) / 10);
    if (vid && st.mode !== 'e') { try { vid.currentTime = o.s; } catch { /* 없음 */ } }
    else if (vid) { try { vid.currentTime = o.e; } catch { /* 없음 */ } }
    paintTimeline();
  };
  tl.addEventListener('pointermove', move);
  const end = () => { if (!st) return; st = null; tl.classList.remove('drag'); if (vid) try { vid.currentTime = M.med.s; } catch { /* 없음 */ } };
  tl.addEventListener('pointerup', end); tl.addEventListener('pointercancel', end);
  // 재생은 고른 구간 안에서만
  vid?.addEventListener('timeupdate', () => { if (!vid.paused && vid.currentTime >= M.med.e) { vid.pause(); vid.currentTime = M.med.s; } });
  vid?.addEventListener('play', () => { if (vid.currentTime < M.med.s - 0.1 || vid.currentTime >= M.med.e) vid.currentTime = M.med.s; });
}
function stageShrink(f) {
  const goal = M.med.goal * 1024 * 1024;
  const pct = Math.min(100, goal / f.size * 100);
  const ok = f.size > goal;
  return `${f.video ? `<video class="mvid sm" src="${f.url}" controls playsinline preload="metadata"></video>` : ''}
    <div class="shr">${ok ? `<span class="was">${fmtSize(f.size)}</span><span class="arr">→</span><span class="to">${M.med.goal} MB 이하</span>` : `<span class="to">이미 ${M.med.goal} MB보다 작아요</span>`}</div>
    <div class="meter"><i style="width:${pct}%"></i></div>`;
}
function stageAudioList() {
  return `<ul class="trows">${M.media.map(f => `
    <li class="trow static">
      <span class="badge sm" style="--c:var(${f.video ? '--c-vid' : '--c-aud'})">${esc(f.ext)}</span>
      <div class="f-meta"><div class="f-name">${esc(f.name)}</div></div>
      ${f.bad ? `<span class="pill fail">${esc(f.bad)}</span>` : `<span class="pc">${f.dur ? fmtTime(f.dur).replace(/\.\d$/, '') : '…'}</span><span class="pc acc">→ ${M.med.afmt.toUpperCase()}</span>`}
      <button class="x" data-rm="${f.id}" aria-label="빼기">${K.IC.x}</button>
    </li>`).join('')}</ul>${dropHTML(false, '파일 추가')}`;
}

/* ---------- 압축 화면 ---------- */
function buildTree() {
  const a = M.arc, root = { kids: new Map(), files: 0, size: 0 };
  for (const e of a.entries || []) {
    const parts = e.path.split('/').filter(Boolean); let node = root, path = '';
    parts.forEach((p, i) => {
      path = path ? `${path}/${p}` : p;
      const last = i === parts.length - 1;
      if (!node.kids.has(p)) node.kids.set(p, { name: p, path, dir: !last || e.dir, kids: new Map(), size: 0, files: 0 });
      node = node.kids.get(p);
      if (last && !e.dir) node.size = e.size;
    });
  }
  const sum = (n) => { if (!n.dir) { n.files = 1; return; } n.size = 0; n.files = 0; for (const k of n.kids.values()) { sum(k); n.size += k.size; n.files += k.files; } };
  root.dir = true; sum(root);
  return root;
}
let treeCache = null;
function filesUnder(n, out = []) { if (!n.dir) out.push(n.path); else for (const k of n.kids.values()) filesUnder(k, out); return out; }
function selCount(n) { if (!n.dir) return M.arc.off.has(n.path) ? 0 : 1; let c = 0; for (const k of n.kids.values()) c += selCount(k); return c; }
function stagePick() {
  const a = M.arc;
  if (!a.file) return dropHTML(true, '압축 파일 추가');
  const head = `<div class="ahead"><span class="badge sm" style="--c:var(--c-arc)">${esc(a.file.ext)}</span><span class="f-name">${esc(a.file.name)}</span><span class="pc">${a.entries ? `파일 ${a.entries.filter(e => !e.dir).length.toLocaleString()}개 · ` : ''}${fmtSize(a.file.size)}</span><span class="sp"></span><label class="btn sm" for="tpicker">다른 파일</label></div>`;
  if (a.loading) return head + '<div class="tmsg"><span class="spin"></span></div>';
  if (a.need && !a.entries) return head + `<div class="tmsg">${K.IC.lock}<b>암호가 걸린 압축 파일이에요</b></div>`;
  if (a.listErr) return head + `<div class="tmsg"><b>${esc(a.listErr)}</b></div>`;
  treeCache = buildTree();
  const rows = []; let shown = 0;
  const walkN = (n, depth) => {
    const kids = [...n.kids.values()].sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name, 'ko'));
    for (const k of kids) {
      if (shown++ > 3000) return;
      const c = selCount(k), state = c === 0 ? '' : c === k.files ? 'on' : 'part';
      const open = a.open.has(k.path);
      rows.push(`<div class="trn" style="--d:${depth}">
        ${k.dir ? `<button class="fchev ${open ? 'open' : ''}" data-fold="${esc(k.path)}" aria-label="${open ? '접기' : '펼치기'}" aria-expanded="${open}">${I.caret}</button>` : '<span class="fchev sp"></span>'}
        <button class="tpick" data-pick="${esc(k.path)}" role="checkbox" aria-checked="${state === 'on' ? 'true' : state === 'part' ? 'mixed' : 'false'}">
          <span class="cbox ${state}">${state === 'on' ? I.tick : state === 'part' ? I.dash : ''}</span>
          ${k.dir ? `<span class="ficon d">${I.fold}</span>` : `<span class="ficon" style="--c:var(${catOf(extOf(k.name)) ? `--c-${catOf(extOf(k.name))}` : '--c-arc'})"></span>`}
          <span class="nm">${esc(k.name)}</span><span class="pc">${k.dir ? `${k.files}개 · ` : ''}${fmtSize(k.size)}</span>
        </button></div>`);
      if (k.dir && open) walkN(k, depth + 1);
    }
  };
  walkN(treeCache, 0);
  return head + `<div class="atree">${rows.join('')}${shown > 3000 ? '<p class="p-note">목록이 너무 길어서 일부만 보여요</p>' : ''}</div>`;
}
function stagePack() {
  const a = M.arc;
  if (!a.packs.length) return dropHTML(true, '파일 추가');
  return `<ul class="trows">${a.packs.map(f => { const c = catOf(f.ext); return `
    <li class="trow static">
      <span class="badge sm" style="--c:var(${c ? `--c-${c}` : '--c-arc'})">${esc(f.ext || '?')}</span>
      <div class="f-meta"><div class="f-name">${esc(f.name)}</div></div>
      <span class="pc">${fmtSize(f.size)}</span>
      <button class="x" data-rm="${f.id}" aria-label="빼기">${K.IC.x}</button>
    </li>`; }).join('')}</ul>${dropHTML(false, '파일 추가')}`;
}

export function stageHTML() {
  const t = tool();
  if (K.S.cat === 'img') {
    if (!M.imgs.length) return dropHTML(true, '이미지 추가');
    return t === 'rotate' ? stageRotate() : stageImgGrid();
  }
  if (K.S.cat === 'media') {
    if (!M.media.length) return dropHTML(true, '영상이나 오디오 추가');
    if (t === 'audio') return stageAudioList();
    const f = curMedia();
    if (f.bad) return `<div class="tmsg"><b>${esc(f.bad)}</b></div>`;
    if (!f.dur) return '<div class="tmsg"><span class="spin"></span></div>';
    if ((t === 'gif' || t === 'shrink') && !f.video) return '<div class="tmsg"><b>영상 파일을 넣어 주세요</b></div>';
    return t === 'shrink' ? stageShrink(f) : stageTimeline(f);
  }
  return t === 'pick' ? stagePick() : stagePack();
}
export function afterStage(root) {
  if (K.S.cat === 'img' && tool() === 'rotate') { drawCrop(); bindCropDrag(root); }
  if (K.S.cat === 'media') { bindTimeline(root); document.querySelectorAll('.wavebar i').length && paintTimeline(); }
}

/* ---------- 설정 패널 ---------- */
function chips(path, items, cur) {
  return `<div class="chipsel" role="radiogroup" data-chips="${path}">${items.map(([v, l]) => `<button role="radio" aria-checked="${String(cur) === String(v)}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
function mediaStats() {
  const f = curMedia(), o = M.med, t = tool(); if (!f?.dur) return '';
  const len = o.e - o.s;
  let est;
  if (t === 'gif') {
    const w = Math.min(o.gifW, f.video?.w || o.gifW), h = f.video ? w * f.video.h / f.video.w : w * 9 / 16;
    est = len * o.fps * w * h * 0.1;
  } else est = f.size * len / f.dur;
  return `<div><span>길이</span><b>${len.toFixed(1)}초</b></div><div><span>예상 크기</span><b>약 ${fmtSize(est)}</b></div>`;
}
export function panelHTML() {
  const { segHTML, sub, check, pwField } = K;
  const o = M.img, t = tool();
  switch (t) {
    case 'compress': {
      const done = M.imgs.filter(e => e.res);
      const before = M.imgs.reduce((n, e) => n + e.size, 0), after = done.length === M.imgs.length && done.length ? done.reduce((n, e) => n + e.res.size, 0) : 0;
      return `<div>${sub('줄이는 방식')}${segHTML('m:img.cmp', [['q', '화질로'], ['size', '용량으로']], o.cmp)}</div>
        ${o.cmp === 'q'
          ? `<div class="range">${sub('화질', `<span class="val" id="qv">${o.q}</span>`)}<input type="range" min="30" max="100" value="${o.q}" data-min="m:img.q" style="--v:${(o.q - 30) / 70 * 100}%" aria-label="화질"><div class="ticks"><span>작은 용량</span><span>고화질</span></div></div>`
          : `<div>${sub('한 장에 최대')}${chips('img.target', [[200 * 1024, '200 KB'], [500 * 1024, '500 KB'], [1024 * 1024, '1 MB'], [2 * 1024 * 1024, '2 MB']], o.target)}</div>`}
        <div>${sub('형식')}${segHTML('m:img.fmt', [['auto', '자동'], ['jpg', 'JPG'], ['webp', 'WebP'], ['avif', 'AVIF']], o.fmt)}</div>
        <div class="stats"><div><span>사진</span><b>${M.imgs.length}장</b></div><div><span>${after ? '줄인 합계' : '지금 합계'}</span><b class="${after ? 'good' : ''}">${fmtSize(after || before)}</b></div></div>`;
    }
    case 'resize':
      return `<div>${sub('기준')}${segHTML('m:img.rs', [['long', '긴 쪽'], ['pct', '비율'], ['px', '픽셀']], o.rs)}</div>
        ${o.rs === 'long' ? `<div>${sub('긴 쪽 (px)')}${chips('img.long', [[1080, '1080'], [1280, '1280'], [1920, '1920'], [2560, '2560'], [3840, '3840']], o.long)}</div>` : ''}
        ${o.rs === 'pct' ? `<div>${sub('비율')}${chips('img.pct', [[25, '25%'], [50, '50%'], [75, '75%']], o.pct)}</div>` : ''}
        ${o.rs === 'px' ? `<div>${sub('크기 (px)')}<div class="pxrow"><input class="field mono" type="number" min="1" data-min="m:img.pw" value="${o.pw}" placeholder="가로" aria-label="가로">
            <button class="btn ic lockr ${o.lock ? 'on' : ''}" data-act="lock" aria-pressed="${o.lock}" aria-label="비율 고정">${I.link}</button>
            <input class="field mono" type="number" min="1" data-min="m:img.ph" value="${o.ph}" placeholder="세로" aria-label="세로" ${o.lock ? 'disabled' : ''}></div></div>` : ''}
        ${check('m:img.noUp', o.noUp, '원본보다 크게 키우지 않기')}`;
    case 'rotate': {
      const e = curImg(), set = e ? imgSet(e.id) : o;
      return `<div>${sub('비율')}${chips('rot.ratio', Object.keys({ '원본': 0, '1:1': 1, '4:5': 1, '3:4': 1, '16:9': 1, '3:2': 1, '9:16': 1 }).map(k => [k, k]), set.ratio)}</div>
        <div>${sub('돌리기 · 뒤집기')}<div class="grid2">
          <button class="btn ic" data-act="rotL">${K.IC.rotL}왼쪽으로</button><button class="btn ic" data-act="rotR">${K.IC.rotR}오른쪽으로</button>
          <button class="btn ic ${set.fx ? 'pressed' : ''}" data-act="fx">${I.flipH}좌우 뒤집기</button><button class="btn ic ${set.fy ? 'pressed' : ''}" data-act="fy">${I.flipV}상하 뒤집기</button>
        </div></div>
        ${M.imgs.length > 1 ? check('m:img.same', o.same, '모든 사진에 같게') : ''}`;
    }
    case 'exif': {
      const with_ = M.imgs.filter(e => e.meta?.gps).length;
      return `<div class="checks">${sub('지울 정보')}${check('m:img.gps', o.gps, '위치 (GPS)')}${check('m:img.cam', o.cam, '카메라 · 렌즈')}${check('m:img.date', o.date, '찍은 날짜')}</div>
        <div class="stats"><div><span>위치가 든 사진</span><b class="${with_ ? 'warn' : ''}">${with_}장</b></div><div><span>화질</span><b>그대로</b></div></div>`;
    }
    case 'trim': case 'gif': {
      const m = M.med, f = curMedia();
      if (!f?.dur) return '';
      return `<div class="row2"><div>${sub('시작')}<input class="field mono" data-t="s" value="${fmtTime(m.s)}" inputmode="decimal" aria-label="시작"></div><div>${sub('끝')}<input class="field mono" data-t="e" value="${fmtTime(m.e)}" inputmode="decimal" aria-label="끝"></div></div>
        <div>${sub('빠른 고르기')}<div class="links"><button data-pre="first">처음 10초</button><button data-pre="last">마지막 10초</button><button data-pre="mid">가운데 30초</button><button data-pre="all">전체</button></div></div>
        ${t === 'trim' ? check('m:med.fast', m.fast, '빠르게 자르기 (화질 그대로)') : `
          <div>${sub('크기 (가로 px)')}${segHTML('m:med.gifW', [[320, '320'], [480, '480'], [720, '720']], m.gifW)}</div>
          <div>${sub('초당 장면')}${segHTML('m:med.fps', [[10, '10'], [15, '15'], [24, '24']], m.fps)}</div>
          ${check('m:med.loop', m.loop, '계속 반복')}`}
        <div class="stats" id="mstats">${mediaStats()}</div>`;
    }
    case 'audio': {
      const m = M.med, lossy = m.afmt === 'mp3' || m.afmt === 'm4a';
      return `<div>${sub('형식')}${segHTML('m:med.afmt', [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV'], ['flac', 'FLAC']], m.afmt)}</div>
        ${lossy ? `<div>${sub('음질 (kbps)')}${segHTML('m:med.abr', [['128', '128'], ['192', '192'], ['256', '256'], ['320', '320']], m.abr)}</div>` : ''}`;
    }
    case 'shrink': {
      const m = M.med;
      return `<div>${sub('목표')}${segHTML('m:med.goalSel', [['msg', '메신저 25MB'], ['mail', '메일 10MB'], ['custom', '직접']], m.goalSel)}</div>
        ${m.goalSel === 'custom' ? `<div>${sub('최대 크기 (MB)')}<input class="field mono" type="number" min="1" data-min="m:med.goal" value="${m.goal}" aria-label="최대 크기"></div>` : ''}
        <div>${sub('해상도')}${segHTML('m:med.res', [['원본', '원본'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p']], m.res)}</div>
        ${check('m:med.mute', m.mute, '소리 빼기')}`;
    }
    case 'pick': {
      const a = M.arc;
      if (a.need && !a.entries) return `<div>${sub('암호')}${pwField('m:arc.pw', a.pw, '압축 파일 암호')}${a.listErr ? `<p class="p-note bad">${esc(a.listErr)}</p>` : ''}</div><button class="btn ic wide" data-act="unlock">${K.IC.lock}열기</button>`;
      if (!a.entries) return '';
      const pwBox = a.need ? `<div class="pw">${sub(`${K.IC.lock}암호`)}${pwField('m:arc.pw', a.pw, '압축 파일 암호')}</div>` : '';
      const all = (a.entries || []).filter(e => !e.dir), on = all.filter(e => !a.off.has(e.path));
      return `${pwBox}<div class="stats"><div><span>고른 파일</span><b>${on.length.toLocaleString()}개</b></div><div><span>크기</span><b>${fmtSize(on.reduce((n, e) => n + e.size, 0))}</b></div></div>
        <div>${sub('받는 방식')}${segHTML('m:arc.mode', [['zip', 'ZIP 하나로'], ['each', '하나씩']], a.mode)}</div>
        <div class="links"><button data-act="all">모두</button><button data-act="none">해제</button></div>`;
    }
    case 'pack': {
      const a = M.arc;
      return `<div>${sub('파일 이름')}<input class="field" data-min="m:arc.name" value="${esc(a.name)}" placeholder="묶음_${new Date().toISOString().slice(0, 10)}" aria-label="파일 이름"></div>
        <div>${sub('형식')}${segHTML('m:arc.fmt', [['zip', 'ZIP'], ['7z', '7Z']], a.fmt)}</div>
        <div>${sub('압축')}${segHTML('m:arc.level', [[1, '빠르게'], [5, '보통'], [9, '작게']], a.level)}</div>
        ${check('m:arc.lock', a.lock, '암호 걸기')}
        ${a.lock ? `<div class="fadeIn">${pwField('m:arc.ppw', a.ppw, '암호')}</div>` : ''}
        <div class="stats"><div><span>파일</span><b>${a.packs.length}개</b></div><div><span>합계</span><b>${fmtSize(a.packs.reduce((n, f) => n + f.size, 0))}</b></div></div>`;
    }
  }
  return '';
}
export function label() {
  return { compress: '줄이기', resize: '크기 바꾸기', rotate: '적용', exif: '정보 지우기', trim: '자르기', audio: '소리 빼기', shrink: '줄이기', gif: 'GIF 만들기', pick: '받기', pack: '묶기' }[tool()];
}
export function canRun() {
  const t = tool();
  if (K.S.cat === 'img') return M.imgs.some(e => e.w && !e.bad);
  if (K.S.cat === 'media') {
    if (t === 'audio') return M.media.some(f => f.dur && !f.bad);
    const f = curMedia(); return !!(f?.dur && !f.bad && (t === 'trim' || f.video) && (t === 'shrink' || M.med.e - M.med.s >= 0.2));
  }
  if (t === 'pick') return !!(M.arc.entries && (!M.arc.need || M.arc.pw) && M.arc.entries.some(e => !e.dir && !M.arc.off.has(e.path)));
  return M.arc.packs.length > 0 && (!M.arc.lock || !!M.arc.ppw);
}

/* ---------- 실행 ---------- */
async function zipOf(items, name) {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip(); const used = new Set();
  for (const it of items) {
    let n = it.name, k = 2; while (used.has(n.toLowerCase())) n = it.name.replace(/(\.[^.]+)?$/, ` (${k++})$1`); used.add(n.toLowerCase());
    z.file(n, it.blob || it.bytes, { binary: true });
  }
  return { blob: await z.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'STORE' }), name };
}
export async function exec(progress) {
  const t = tool();
  if (K.S.cat === 'img') {
    const ops = await import('./imgops.js');
    const list = M.imgs.filter(e => e.w && !e.bad), out = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]; let r;
      try {
        if (t === 'compress') { r = await ops.compress(e.file, e.ext, { mode: M.img.cmp, q: M.img.q, target: M.img.target, fmt: M.img.fmt }); e.res = { size: r.blob.size, same: r.same }; }
        else if (t === 'resize') {
          if (M.img.rs === 'px' && !(+M.img.pw || (+M.img.ph && !M.img.lock))) throw new Error('가로 크기를 적어 주세요');
          r = await ops.resize(e.file, e.ext, M.img);
        } else if (t === 'rotate') { const s = imgSet(e.id), p = M.img.pos[e.id] || { cx: 0.5, cy: 0.5 }; r = await ops.cropRotate(e.file, e.ext, { ...s, ...p }); }
        else { r = await ops.cleanMeta(e.file, e.ext, M.img); e.cleaned = true; }
      } catch (err) { throw new Error(`${e.name}: ${err.message}`); }
      out.push(r); progress((i + 1) / list.length);
      if (t === 'compress') K.refresh({ stage: true });
    }
    K.refresh({ stage: true, panel: true });
    if (out.length === 1) return out[0];
    return zipOf(out, `이미지_${{ compress: '압축', resize: '크기', rotate: '편집', exif: '정보삭제' }[t]}.zip`);
  }
  if (K.S.cat === 'media') {
    const ops = await import('./mediaops.js'), m = M.med, f = curMedia();
    if (t === 'trim') return ops.trim(f.file, f.ext, m.s, m.e, m.fast, progress);
    if (t === 'gif') return ops.makeGif(f.file, m.s, m.e, m.gifW, m.fps, m.loop, progress);
    if (t === 'shrink') {
      if (f.size <= m.goal * 1024 * 1024) throw new Error(`이미 ${m.goal}MB보다 작아요`);
      const r = await ops.shrink(f.file, m.goal, m.res, m.mute, progress);
      if (r.over) K.S.note = `${m.goal}MB에 딱 맞추지 못해 ${fmtSize(r.blob.size)}가 됐어요`;
      return r;
    }
    const list = M.media.filter(x => x.dur && !x.bad), out = [];
    for (let i = 0; i < list.length; i++) {
      out.push(await ops.extractAudio(list[i].file, list[i].ext, m.afmt, m.abr, (p) => progress((i + p) / list.length)));
    }
    return out.length === 1 ? out[0] : zipOf(out, `소리_${m.afmt.toUpperCase()}.zip`);
  }
  const ops = await import('./arcops.js'), a = M.arc;
  if (t === 'pick') {
    const files = a.entries.filter(e => !e.dir);
    const want = files.filter(e => !a.off.has(e.path)).map(e => e.path);
    const got = await ops.extract(a.file.file, a.file.ext, a.pw, want.length === files.length ? null : want, progress);
    const baseName = a.file.name.replace(/(\.tar)?\.[^.]+$/i, '');
    if (a.mode === 'each' && got.length > MAX_EACH) throw new Error(`하나씩은 ${MAX_EACH}개까지 받을 수 있어요. ZIP 하나로 받아 주세요`);
    if (a.mode === 'each' || got.length === 1) return { each: got.map(g => ({ blob: new Blob([g.bytes]), name: g.path.split('/').pop() })) };
    return zipOf(got.map(g => ({ name: g.path, bytes: g.bytes })), `${baseName}_골라냄.zip`);
  }
  return ops.pack(a.packs.map(p => p.file), a.name || `묶음_${new Date().toISOString().slice(0, 10)}`, a.fmt, a.level, a.lock ? a.ppw : '', progress);
}

/* ---------- 입력 ---------- */
function setPath(path, v) { const ks = path.split('.'); let o = M; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = v; }
function getPath(path) { return path.split('.').reduce((o, k) => o?.[k], M); }
export function onSeg(path, v) {
  // path는 'm:' 뒤
  const old = getPath(path);
  setPath(path, typeof old === 'number' ? +v : v);
  if (path === 'med.goalSel') M.med.goal = { msg: 25, mail: 10, custom: M.med.goal }[v];
  if (path.startsWith('img.')) M.imgs.forEach(e => { e.res = null; e.cleaned = false; });
  K.refresh({ stage: true, panel: true });
}
export function onCheck(path, on) {
  setPath(path, on);
  if (path === 'img.same' && on) M.img.per = {};
  if (path.startsWith('img.')) M.imgs.forEach(e => { e.cleaned = false; });
  K.refresh({ stage: path !== 'med.fast' && path !== 'med.loop', panel: true });
}
export function onInput(t) {
  if (t.dataset.in?.startsWith('m:')) { setPath(t.dataset.in.slice(2), t.value); K.refresh({ apply: true }); return true; }
  if (t.dataset.min) {
    const path = t.dataset.min.slice(2);
    const v = t.type === 'number' || t.type === 'range' ? (t.value === '' ? '' : +t.value) : t.value;
    setPath(path, v);
    if (path === 'img.q') { t.style.setProperty('--v', `${(v - 30) / 70 * 100}%`); document.getElementById('qv').textContent = v; M.imgs.forEach(e => { e.res = null; }); K.refresh({ stage: true }); }
    if (path === 'img.pw' || path === 'img.ph') K.refresh({ stage: true });
    if (path === 'med.goal') K.refresh({ stage: true });
    K.refresh({ apply: true });
    return true;
  }
  if (t.dataset.t) {
    const v = parseTime(t.value), f = curMedia(); if (isNaN(v) || !f) return true;
    if (t.dataset.t === 's') M.med.s = Math.max(0, Math.min(v, M.med.e - 0.2)); else M.med.e = Math.min(f.dur, Math.max(v, M.med.s + 0.2));
    paintTimeline();
    return true;
  }
  return false;
}
export function onPanelClick(t) {
  const ch = t.closest('[data-chips] [data-v]');
  if (ch) {
    const path = ch.closest('[data-chips]').dataset.chips;
    if (path === 'rot.ratio') { const e = curImg(); if (e) imgSet(e.id).ratio = ch.dataset.v; if (M.img.same) M.img.ratio = ch.dataset.v; }
    else { const old = getPath(path); setPath(path, typeof old === 'number' ? +ch.dataset.v : ch.dataset.v); M.imgs.forEach(e => { e.res = null; }); }
    K.refresh({ stage: true, panel: true });
    return true;
  }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act) {
    const e = curImg(), set = e ? imgSet(e.id) : M.img;
    if (act === 'rotL') set.rot -= 90; else if (act === 'rotR') set.rot += 90;
    else if (act === 'fx') set.fx = !set.fx; else if (act === 'fy') set.fy = !set.fy;
    else if (act === 'lock') M.img.lock = !M.img.lock;
    else if (act === 'unlock') { openArchive(); return true; }
    else if (act === 'all') M.arc.off = new Set();
    else if (act === 'none') M.arc.off = new Set((M.arc.entries || []).filter(x => !x.dir).map(x => x.path));
    K.refresh({ stage: true, panel: true });
    return true;
  }
  const pre = t.closest('[data-pre]')?.dataset.pre;
  if (pre) {
    const f = curMedia(); if (!f) return true; const D = f.dur, m = M.med;
    if (pre === 'first') { m.s = 0; m.e = Math.min(D, 10); } else if (pre === 'last') { m.s = Math.max(0, D - 10); m.e = D; }
    else if (pre === 'mid') { m.s = Math.max(0, D / 2 - 15); m.e = Math.min(D, D / 2 + 15); } else { m.s = 0; m.e = D; }
    paintTimeline(); const v = document.getElementById('mvid'); if (v) try { v.currentTime = m.s; } catch { /* 없음 */ }
    return true;
  }
  return false;
}
export function onStageClick(t) {
  const rm = t.closest('[data-rm]'); if (rm) { removeItem(+rm.dataset.rm); return true; }
  const sel = t.closest('[data-sel]'); if (sel) { M.img.sel = +sel.dataset.sel; K.refresh({ stage: true, panel: true }); return true; }
  const fold = t.closest('[data-fold]'); if (fold) { const p = fold.dataset.fold; M.arc.open.has(p) ? M.arc.open.delete(p) : M.arc.open.add(p); K.refresh({ stage: true }); return true; }
  const pk = t.closest('[data-pick]');
  if (pk) {
    const path = pk.dataset.pick;
    const find = (n, parts) => parts.reduce((x, p) => x?.kids.get(p), n);
    const node = find(treeCache, path.split('/'));
    if (node) { const files = filesUnder(node), allOn = files.every(p => !M.arc.off.has(p)); files.forEach(p => allOn ? M.arc.off.add(p) : M.arc.off.delete(p)); }
    K.refresh({ stage: true, panel: true });
    return true;
  }
  return false;
}
export function onBar(t, type) {
  if (type === 'click' && t.closest('#mmore')) { document.getElementById('tpicker').click(); return true; }
  if (type === 'change' && t.id === 'mcur') { M.med.cur = +t.value; const f = curMedia(); M.med.s = 0; M.med.e = f?.dur || 0; K.refresh({ all: true }); return true; }
  return false;
}
export function hasFilesFor() { return K.S.cat === 'img' ? M.imgs.length : K.S.cat === 'media' ? M.media.length : tool() === 'pick' ? !!M.arc.file : M.arc.packs.length; }
