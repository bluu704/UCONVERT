import './style.css';
import { CATS, catOf, extOf, targetsFor, defaultTarget } from './formats.js';
import { convert, friendlyError } from './convert/index.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IC = {
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};
const DEFAULT_OPTS = { paper: 'A4', margin: '보통', font: '명조', quality: 85, bitrate: '192', res: '원본', delim: '쉼표' };

/* ---------- 상태 ---------- */
let uid = 0;
const files = [];          // {id, file, name, ext, target, opts, status, p, err, result, ctrl}
let sel = null;
const seen = new Set();
let holdRender = false, pendingRender = false;
let sharedPassword = null;   // '모든 압축 파일에 같은 암호' 체크 시 나중에 추가하는 압축 파일에도 쓴다
let pwAll = false;
function releaseRender() { holdRender = false; if (pendingRender) { pendingRender = false; renderRows(); } }

const cvar = (ext) => { const k = catOf(ext); return k ? `var(${CATS[k].c})` : 'var(--c-arc)'; };
const rowEl = (id) => document.querySelector(`.row[data-id="${id}"]`);
const byId = (id) => files.find(f => f.id === id);

/* ---------- 목록 ---------- */
function stateHTML(f) {
  if (f.status === 'wait') return '<span class="pill wait">대기</span>';
  if (f.status === 'queued') return '<span class="pill queue">차례 대기</span>';
  if (f.status === 'run') return `<span class="pill run" data-pct>${Math.round(f.p * 100)}%</span>`;
  if (f.status === 'done') return `<button class="dl" data-dl="${f.id}">${IC.dl}받기</button>`;
  if (f.status === 'fail') return '<span class="pill fail">실패</span>';
  if (f.status === 'locked') return `<span class="pill lock">${IC.lock}암호 필요</span>`;
  return '<span class="pill fail">미지원</span>';
}
function renderRows() {
  if (holdRender) { pendingRender = true; return; }
  pendingRender = false;
  const list = $('#rows');
  $('#count').textContent = files.length || '';
  let n = 0;
  const st = list.scrollTop;
  list.innerHTML = files.map(f => {
    const isNew = !seen.has(f.id); seen.add(f.id);
    const extra = f.status === 'run' ? `<div class="bar ${f.p < 0.02 ? 'indet' : ''}"><i style="width:${f.p * 100}%"></i></div>`
      : (f.status === 'fail' || f.status === 'unknown' || (f.status === 'locked' && f.pwWrong)) ? `<div class="err">${esc(f.err || '')}</div>` : '';
    return `<li class="row ${f.id === sel ? 'sel' : ''} ${isNew ? 'enter' : ''}" data-id="${f.id}" tabindex="0" draggable="${finePtr}" style="${isNew ? `animation-delay:${Math.min(n++, 8) * 45}ms` : ''}">
      <span class="badge" style="--c:${cvar(f.ext)}">${esc(f.ext || '?')}</span>
      <div class="f-meta"><div class="f-name" title="${esc(f.name)}">${esc(f.name)}</div>${extra}</div>
      <div class="target"><span class="arrow">→</span><span class="to">${f.target || '—'}</span></div>
      <div class="state">${stateHTML(f)}<button class="x" data-rm="${f.id}" aria-label="빼기">${IC.x}</button></div>
    </li>`;
  }).join('') || '<li class="empty">파일을 추가하거나 화면에 끌어다 놓으세요</li>';
  list.scrollTop = st;
  $('#runAll').disabled = !files.some(f => f.status === 'wait' || f.status === 'fail');
  $('#clear').disabled = !files.some(f => f.status === 'done');
}
function paintProgress(f) {
  const r = rowEl(f.id); if (!r) return;
  const bar = r.querySelector('.bar'); if (bar) { bar.classList.toggle('indet', f.p < 0.02); bar.querySelector('i').style.width = f.p * 100 + '%'; }
  const pc = r.querySelector('[data-pct]'); if (pc) pc.textContent = Math.round(f.p * 100) + '%';
}

/* ---------- 옵션 ---------- */
const PAPER = { A4: [210, 297], A5: [148, 210], B5: [176, 250], Letter: [216, 279] };
function paperIcon(v) {
  if (!PAPER[v]) return `<svg viewBox="0 0 24 30"><rect class="pg" x="4" y="5" width="16" height="22" rx="1.5" stroke-dasharray="3 2.5"/></svg>`;
  const [w, h] = PAPER[v], s = 24 / 297, W = w * s, H = h * s;
  return `<svg viewBox="0 0 24 30"><rect class="pg" x="${(24 - W) / 2}" y="${28 - H}" width="${W}" height="${H}" rx="1.5"/></svg>`;
}
function marginIcon(m) {
  return `<svg viewBox="0 0 24 30"><rect class="pg" x="3" y="2" width="18" height="26" rx="1.5"/>${[0, 1, 2, 3, 4].map(i => `<line class="ln" x1="${3 + m}" x2="${21 - m}" y1="${2 + m + 1 + i * 3.4}" y2="${2 + m + 1 + i * 3.4}"/>`).join('')}</svg>`;
}
function seg(o, id, label, items) {
  return `<div><h3 class="sub">${label}</h3><div class="seg" role="radiogroup" aria-label="${label}" data-opt="${id}"><span class="ind"></span>${items.map(it => {
    const v = typeof it === 'string' ? it : it.v;
    return `<button role="radio" aria-checked="${String(o[id]) === v}" data-v="${v}">${it.icon || ''}<span>${it.label || v}</span>${it.dim ? `<span class="dim">${it.dim}</span>` : ''}</button>`;
  }).join('')}</div></div>`;
}
function optionsFor(f) {
  const t = f.target, src = f.ext, o = f.opts, sc = catOf(src), tc = catOf(t);
  if (t === 'pdf') {
    const imageLike = sc === 'img' || src === 'cbz';
    const papers = imageLike ? ['A4', 'A5', 'B5', 'Letter', '원본'] : ['A4', 'A5', 'B5', 'Letter'];
    if (!imageLike && o.paper === '원본') o.paper = 'A4';
    return seg(o, 'paper', '용지', papers.map(v => ({ v, icon: paperIcon(v), dim: PAPER[v] ? PAPER[v].join('×') : '그대로' })))
      + (imageLike && o.paper === '원본' ? '' : seg(o, 'margin', '여백', [{ v: '좁게', icon: marginIcon(1.5) }, { v: '보통', icon: marginIcon(3) }, { v: '넓게', icon: marginIcon(4.8) }]))
      + (imageLike ? '' : seg(o, 'font', '글꼴', ['명조', '고딕']));
  }
  if (['jpg', 'webp', 'avif'].includes(t) && (sc === 'img' || src === 'pdf'))
    return `<div class="range"><h3 class="sub">품질<span class="val" id="qv">${o.quality}</span></h3><input type="range" id="o-quality" min="30" max="100" value="${o.quality}" data-opt="quality" style="--v:${(o.quality - 30) / 70 * 100}%"><div class="ticks"><span>작은 용량</span><span>고화질</span></div></div>`;
  if (tc === 'aud' && ['mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(t)) return seg(o, 'bitrate', '음질 (kbps)', ['128', '192', '256', '320']);
  if (tc === 'vid') return seg(o, 'res', t === 'gif' ? '크기' : '해상도', t === 'gif' ? [{ v: '원본', label: '480' }, '720p'] : ['원본', '1080p', '720p', '480p']);
  if (t === 'csv') return seg(o, 'delim', '구분자', [{ v: '쉼표', dim: ',' }, { v: '탭', dim: '⇥' }, { v: '세미콜론', dim: ';' }]);
  if (tc === 'arc' && (o.password || f.status === 'locked')) {
    const can = t === 'zip' || t === '7z';
    return `<div class="enc"><label class="check ${can ? '' : 'off'}"><input type="checkbox" id="encOut" ${can && o.encryptOut !== false ? 'checked' : ''} ${can ? '' : 'disabled'}><span>결과물에도 같은 암호 걸기</span></label>
      <p class="pw-msg">${can ? (t === 'zip' ? 'AES-256으로 암호화해요' : '파일 목록까지 암호화해요') : 'TAR·GZ는 암호를 걸 수 없어요. ZIP이나 7Z를 고르세요'}</p></div>`;
  }
  return '';
}
function placeInd(segEl, instant) {
  const ind = segEl.querySelector('.ind'), on = segEl.querySelector('[aria-checked="true"]'); if (!ind || !on) return;
  if (instant) ind.style.transition = 'none';
  ind.style.width = on.offsetWidth + 'px'; ind.style.height = on.offsetHeight + 'px';
  ind.style.transform = `translate(${on.offsetLeft - 4}px,${on.offsetTop - 4}px)`;
  if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
}
const placeAll = () => document.querySelectorAll('.seg').forEach(s => placeInd(s, true));

/* ---------- 패널 ---------- */
function titleHTML(f) {
  const open = $('#panel').classList.contains('open');
  return `<button class="p-title" id="pTitle" aria-expanded="${open}"><span class="grab"></span><span class="t">변환 설정</span><span class="peek">${f ? esc(f.name) + ' → ' + (f.target || '—').toUpperCase() : ''}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>`;
}
function renderPanel(animate) {
  const f = byId(sel);
  const P = $('#panel');
  P.classList.remove('anim'); if (animate) { void P.offsetWidth; P.classList.add('anim'); }
  if (!f) { P.innerHTML = titleHTML(null) + '<div class="swap"><p class="p-note">목록에서 파일을 고르세요</p></div>'; return; }
  const groups = targetsFor(f.ext);
  const locked = f.status === 'run' || f.status === 'queued';
  const o = f.target ? optionsFor(f) : '';
  const canRun = f.target && (f.status === 'wait' || f.status === 'fail' || f.status === 'done' || f.status === 'locked');
  const needPw = f.status === 'locked';
  const others = files.filter(x => x !== f && catOf(x.ext) === 'arc').length;
  P.innerHTML = `${titleHTML(f)}<div class="swap scroll">
    <div class="p-file"><span class="badge" style="--c:${cvar(f.ext)}">${esc(f.ext || '?')}</span>
      <div class="f-meta"><div class="f-name">${esc(f.name)}</div></div></div>
    ${groups.length ? `<div class="groups">${groups.map(g => `
      <div class="grp" style="--c:var(${CATS[g.k].c})"><h3 class="sub">${CATS[g.k].label}</h3>
        <div class="fmts">${g.exts.map(e => `<button class="fmt" data-fmt="${e}" aria-pressed="${f.target === e}" ${locked ? 'disabled' : ''}>${e}</button>`).join('')}</div></div>`).join('')}</div>`
      : '<p class="p-note">이 형식은 아직 지원하지 않아요</p>'}
    ${needPw ? `<div class="pw">
      <h3 class="sub">${IC.lock}암호</h3>
      <div class="pw-field ${f.pwWrong ? 'bad' : ''}">
        <input type="password" id="pwInput" placeholder="압축 파일 암호" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(f.pwWrong ? '' : (f.opts.password || ''))}">
        <button class="pw-eye" id="pwEye" type="button" aria-label="암호 보기" aria-pressed="false">${IC.eye}</button>
      </div>
      <p class="pw-msg" id="pwMsg">${f.pwWrong ? '암호가 틀렸어요. 다시 입력하세요' : '이 압축 파일은 암호가 걸려 있어요'}</p>
      <label class="check"><input type="checkbox" id="pwAll" ${pwAll ? 'checked' : ''}><span>모든 압축 파일에 같은 암호 적용${others ? ` (${others + 1}개)` : ''}</span></label>
    </div>` : ''}
    ${o ? `<div class="opts">${o}</div>` : ''}
  </div>
  <div class="apply">
    <button class="btn" id="applyAll" ${!f.target ? 'disabled' : ''}>같은 형식에 적용</button>
    <button class="btn btn-primary" id="runOne" ${canRun ? '' : 'disabled'}>${needPw ? '암호 넣고 변환' : f.status === 'fail' ? '다시 시도' : f.status === 'done' ? '다시 변환' : '변환'}</button>
  </div>`;
  placeAll();
  if (needPw && finePtr) setTimeout(() => $('#pwInput')?.focus({ preventScroll: true }), animate ? 300 : 0);
}
function select(id) {
  if (sel === id) return;
  rowEl(sel)?.classList.remove('sel');
  sel = id; rowEl(id)?.classList.add('sel');
  renderPanel(true);
}

/* ---------- 지원 형식 시트 ---------- */
function renderCats(q = '') {
  q = q.trim().toLowerCase().replace(/^\./, '');
  const html = Object.entries(CATS).map(([k, c], i) => {
    if (q && !c.exts.some(e => e.includes(q))) return '';
    return `<div class="cat" style="--c:var(${c.c});animation-delay:${120 + i * 35}ms">
      <h3>${c.label}<span>${c.exts.length}</span></h3>
      <div class="chips">${c.exts.map(e => `<span class="chip ${q && e.includes(q) ? 'hit' : ''}">${e}</span>`).join('')}</div></div>`;
  }).join('');
  $('#cats').innerHTML = html || '<div class="nores">찾는 형식이 없어요</div>';
}
function setSheet(open) {
  document.body.classList.toggle('formats-open', open);
  $('#openFormats').setAttribute('aria-expanded', open);
  $('#sheet').setAttribute('aria-hidden', !open);
  if (open) { renderCats($('#search').value); if (finePtr) setTimeout(() => $('#search').focus({ preventScroll: true }), 350); }
}
$('#openFormats').onclick = () => setSheet(!document.body.classList.contains('formats-open'));
$('#closeFormats').onclick = () => setSheet(false);
$('#scrim').onclick = () => setSheet(false);
$('#search').addEventListener('input', e => renderCats(e.target.value));

/* ---------- 알림 ---------- */
let toastT;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- 변환 대기열 ---------- */
const queue = [];
let running = 0;
const MAX_PARALLEL = 1;

function enqueue(f) {
  if (!f.target || f.status === 'run' || f.status === 'queued') return;
  disposeResult(f);
  f.status = 'queued'; f.p = 0; f.err = '';
  queue.push(f);
  pump();
}
function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const f = queue.shift();
    if (!byId(f.id) || f.status !== 'queued') continue;
    running++;
    runJob(f).finally(() => { running--; pump(); });
  }
}
async function runJob(f) {
  f.status = 'run'; f.p = 0;
  f.ctrl = new AbortController();
  renderRows(); if (sel === f.id) renderPanel(false);
  let last = 0;
  const progress = (p) => {
    f.p = Math.max(f.p, Math.min(1, p || 0));
    const now = performance.now();
    if (now - last > 120) { last = now; paintProgress(f); }
  };
  try {
    const r = await convert(f.file, f.ext, f.target, { ...f.opts }, progress, f.ctrl.signal);
    if (!byId(f.id)) { r.cleanup?.(); return; }
    f.result = { ...r, url: URL.createObjectURL(r.blob) };
    f.pwWrong = false;
    f.status = 'done'; f.p = 1;
    toast(`${f.name} → ${r.name.split('.').slice(1).join('.').toUpperCase()} 완료`);
  } catch (e) {
    if (!byId(f.id)) return;
    if (e?.code === 'NEED_PASSWORD' || e?.code === 'WRONG_PASSWORD') {
      f.status = 'locked'; f.pwWrong = e.code === 'WRONG_PASSWORD'; f.err = e.message;
      if (sel !== f.id) toast(`${f.name}: ${f.pwWrong ? '암호가 틀렸어요' : '암호가 필요해요'}`);
    } else {
      console.error(e);
      f.status = 'fail'; f.err = friendlyError(e);
    }
  }
  f.ctrl = null;
  renderRows(); if (sel === f.id) renderPanel(false);
}
function disposeResult(f) {
  if (f.result) { URL.revokeObjectURL(f.result.url); f.result.cleanup?.(); f.result = null; }
}
function download(f) {
  if (!f.result) return;
  const a = document.createElement('a');
  a.href = f.result.url; a.download = f.result.name;
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 이벤트 ---------- */
function removeIds(ids) {
  ids.forEach(id => rowEl(id)?.classList.add('leave'));
  setTimeout(() => {
    for (let i = files.length - 1; i >= 0; i--) {
      const f = files[i];
      if (!ids.includes(f.id)) continue;
      f.ctrl?.abort(); disposeResult(f);
      files.splice(i, 1);
    }
    renderRows();
    if (!files.some(f => f.id === sel)) { sel = files[0]?.id ?? null; renderPanel(true); }
  }, 280);
}
let suppressClick = false;
$('#rows').addEventListener('click', e => {
  if (suppressClick) return;
  const rm = e.target.closest('[data-rm]'); if (rm) { removeIds([+rm.dataset.rm]); return; }
  const dl = e.target.closest('[data-dl]'); if (dl) { download(byId(+dl.dataset.dl)); return; }
  const row = e.target.closest('.row[data-id]'); if (row) { select(+row.dataset.id); if (phone.matches) setPanel(true); }
});
$('#rows').addEventListener('keydown', e => { if (e.key === 'Enter') { const row = e.target.closest('.row[data-id]'); if (row) select(+row.dataset.id); } });

$('#panel').addEventListener('click', e => {
  if (e.target.closest('#pTitle')) { if (phone.matches) setPanel(!$('#panel').classList.contains('open')); return; }
  const f = byId(sel); if (!f) return;
  const b = e.target.closest('[data-fmt]');
  if (b) {
    if (f.target === b.dataset.fmt) return;
    f.target = b.dataset.fmt;
    if (f.status === 'fail' || f.status === 'done') { disposeResult(f); f.status = 'wait'; f.err = ''; renderRows(); }
    const to = rowEl(f.id)?.querySelector('.to'); if (to) to.textContent = f.target;
    const pk = $('#pTitle .peek'); if (pk) pk.textContent = f.name + ' → ' + f.target.toUpperCase();
    document.querySelectorAll('.fmt').forEach(x => x.setAttribute('aria-pressed', x === b));
    const old = $('#panel .opts'), html = optionsFor(f);
    if (old) old.remove();
    if (html) { $('#panel .groups').insertAdjacentHTML('afterend', `<div class="opts fade">${html}</div>`); placeAll(); }
    const run = $('#runOne'); if (run) { run.disabled = false; run.textContent = f.status === 'locked' ? '암호 넣고 변환' : '변환'; }
    return;
  }
  const sb = e.target.closest('.seg button');
  if (sb) {
    const s = sb.closest('.seg'); f.opts[s.dataset.opt] = sb.dataset.v;
    s.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', x === sb)); placeInd(s);
    // 이미지 PDF에서 '원본' 용지는 여백이 필요 없으므로 옵션을 다시 그린다
    if (s.dataset.opt === 'paper' && (sb.dataset.v === '원본') === !!$('#panel [data-opt="margin"]')) {
      $('#panel .opts').innerHTML = optionsFor(f); placeAll();
    }
    return;
  }
  if (e.target.closest('#pwEye')) {
    const inp = $('#pwInput'), eye = $('#pwEye'), show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; eye.setAttribute('aria-pressed', show); inp.focus();
    return;
  }
  if (e.target.id === 'runOne') {
    if (f.status === 'locked') { submitPassword(f); return; }
    enqueue(f); if (phone.matches) setPanel(false);
  }
  if (e.target.id === 'applyAll') {
    let n = 0;
    files.forEach(x => { if (x !== f && x.ext === f.ext && (x.status === 'wait' || x.status === 'fail')) { x.target = f.target; x.opts = { ...f.opts }; n++; } });
    toast(n ? `${n}개에 적용했어요` : '같은 형식 파일이 없어요'); renderRows();
  }
});
$('#panel').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'pwInput') { e.preventDefault(); const f = byId(sel); if (f) submitPassword(f); }
});
$('#panel').addEventListener('change', e => {
  if (e.target.id === 'encOut') { const f = byId(sel); if (f) f.opts.encryptOut = e.target.checked; return; }
  if (e.target.id !== 'pwAll') return;
  pwAll = e.target.checked;
  if (!pwAll) sharedPassword = null;
});
function submitPassword(f) {
  const inp = $('#pwInput'), pw = inp?.value || '';
  if (!pw) {
    $('#pwMsg').textContent = '암호를 입력하세요';
    $('.pw-field')?.classList.remove('shake'); void inp.offsetWidth; $('.pw-field')?.classList.add('shake', 'bad');
    inp.focus(); return;
  }
  f.opts.password = pw; f.pwWrong = false;
  let n = 0;
  if ($('#pwAll')?.checked) {
    pwAll = true; sharedPassword = pw;
    for (const x of files) {
      if (x === f || catOf(x.ext) !== 'arc') continue;
      x.opts.password = pw;
      if (f.opts.encryptOut !== undefined) x.opts.encryptOut = f.opts.encryptOut;
      if (x.status === 'locked') { x.pwWrong = false; enqueue(x); n++; }
    }
  }
  enqueue(f);
  if (n) toast(`압축 파일 ${n + 1}개에 같은 암호를 넣었어요`);
  renderRows(); renderPanel(false);
  if (phone.matches) setPanel(false);
}
$('#panel').addEventListener('input', e => {
  if (e.target.dataset.opt !== 'quality') return;
  const f = byId(sel); if (!f) return;
  f.opts.quality = +e.target.value; $('#qv').textContent = e.target.value;
  e.target.style.setProperty('--v', (f.opts.quality - 30) / 70 * 100 + '%');
});
$('#runAll').addEventListener('click', () => { files.forEach(f => { if (f.status === 'wait' || f.status === 'fail') enqueue(f); }); renderRows(); renderPanel(false); });
$('#clear').addEventListener('click', () => removeIds(files.filter(f => f.status === 'done').map(f => f.id)));

function addFiles(list) {
  let last = null;
  for (const file of list) {
    if (!file.size && !file.type && !/\.[a-z0-9]+$/i.test(file.name)) continue; // 폴더
    const ext = extOf(file.name);
    const target = defaultTarget(ext);
    const opts = { ...DEFAULT_OPTS };
    if (sharedPassword && catOf(ext) === 'arc') opts.password = sharedPassword;
    files.push({ id: ++uid, file, name: file.name, ext, target, opts, status: target ? 'wait' : 'unknown', p: 0, err: target ? '' : '지원하지 않는 형식이에요' });
    last = uid;
  }
  if (last) {
    sel = last; renderRows(); renderPanel(true);
    const r = $('#rows'); requestAnimationFrame(() => r.scrollTo({ top: r.scrollHeight, behavior: 'smooth' }));
    toast(`${list.length}개 추가했어요`);
  }
}
$('#picker').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

/* 창 어디에나 파일 끌어다 놓기 */
const overlay = $('#overlay'), drop = $('#drop'); let dc = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); if (++dc === 1) { overlay.classList.add('show'); drop.classList.add('over'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dc <= 0) { dc = 0; overlay.classList.remove('show'); drop.classList.remove('over'); } });
window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dc = 0; overlay.classList.remove('show'); drop.classList.remove('over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

/* 목록 순서 바꾸기 (마우스) */
const finePtr = matchMedia('(pointer:fine)').matches;
function moveFile(fromId, toId, after) {
  holdRender = false;
  const from = files.findIndex(f => f.id === fromId); const [m] = files.splice(from, 1);
  let to = files.findIndex(f => f.id === toId); if (after) to++; files.splice(to, 0, m); renderRows();
}
let dragId = null;
const rowsEl = $('#rows');
const clearMarks = () => rowsEl.querySelectorAll('.before,.after').forEach(r => r.classList.remove('before', 'after'));
rowsEl.addEventListener('dragstart', e => { const r = e.target.closest('.row[data-id]'); if (!r) return; dragId = +r.dataset.id; holdRender = true; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'uc-row'); requestAnimationFrame(() => r.classList.add('dragging')); });
rowsEl.addEventListener('dragover', e => {
  if (dragId == null) return; e.preventDefault(); const r = e.target.closest('.row[data-id]'); clearMarks(); if (!r || +r.dataset.id === dragId) return;
  const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'before' : 'after');
});
rowsEl.addEventListener('drop', e => { if (dragId == null) return; e.preventDefault(); const r = rowsEl.querySelector('.before,.after'); clearMarks(); if (r) moveFile(dragId, +r.dataset.id, r.classList.contains('after')); });
rowsEl.addEventListener('dragend', () => { dragId = null; releaseRender(); clearMarks(); rowsEl.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging')); });

/* 목록 순서 바꾸기 (터치: 길게 눌러 들어올린 뒤 끌기) */
let tp = null, asRAF = null;
rowsEl.addEventListener('touchstart', e => {
  if (e.touches.length > 1 || e.target.closest('button')) return;
  const r = e.target.closest('.row[data-id]'); if (!r) return;
  const t = e.touches[0];
  tp = { id: +r.dataset.id, row: r, x: t.clientX, y: t.clientY, cx: t.clientX, cy: t.clientY, st: rowsEl.scrollTop, active: false };
  holdRender = true;
  tp.timer = setTimeout(() => {
    if (!tp) return; tp.active = true; r.classList.add('lifted'); r.style.transform = 'scale(1.02)';
    try { navigator.vibrate?.(12); } catch { /* 없음 */ }
    autoScroll();
  }, 380);
}, { passive: true });
rowsEl.addEventListener('touchmove', e => {
  if (!tp) return; const t = e.touches[0];
  if (!tp.active) { if (Math.hypot(t.clientX - tp.x, t.clientY - tp.y) > 8) { clearTimeout(tp.timer); tp = null; releaseRender(); } return; }
  e.preventDefault(); tp.cx = t.clientX; tp.cy = t.clientY; moveLift();
}, { passive: false });
function moveLift() {
  const dy = tp.cy - tp.y + (rowsEl.scrollTop - tp.st);
  tp.row.style.transform = `translateY(${dy}px) scale(1.02)`;
  clearMarks();
  const r = document.elementFromPoint(tp.cx, tp.cy)?.closest?.('.row[data-id]');
  if (!r || r === tp.row || !rowsEl.contains(r)) return;
  const b = r.getBoundingClientRect(); r.classList.add(tp.cy < b.top + b.height / 2 ? 'before' : 'after');
}
function autoScroll() {
  if (!tp || !tp.active) return;
  const b = rowsEl.getBoundingClientRect(), edge = 64; let v = 0;
  if (tp.cy < b.top + edge) v = -Math.ceil((b.top + edge - tp.cy) / 5); else if (tp.cy > b.bottom - edge) v = Math.ceil((tp.cy - (b.bottom - edge)) / 5);
  if (v) { rowsEl.scrollBy({ top: v, behavior: 'instant' }); moveLift(); }
  asRAF = requestAnimationFrame(autoScroll);
}
function endTouch() {
  if (!tp) return; clearTimeout(tp.timer); cancelAnimationFrame(asRAF);
  if (tp.active) {
    suppressClick = true; setTimeout(() => suppressClick = false, 400);
    const r = rowsEl.querySelector('.before,.after'); const after = r?.classList.contains('after');
    clearMarks(); tp.row.classList.remove('lifted'); tp.row.style.transform = '';
    if (r) moveFile(tp.id, +r.dataset.id, after);
  }
  tp = null; releaseRender();
}
rowsEl.addEventListener('animationend', e => e.target.classList?.remove('enter'));
rowsEl.addEventListener('touchend', endTouch);
rowsEl.addEventListener('touchcancel', endTouch);
rowsEl.addEventListener('contextmenu', e => { if (tp) e.preventDefault(); });

window.addEventListener('resize', placeAll);

/* 폰: 설정 시트 */
const phone = matchMedia('(max-width:699px)');
function setPanel(open) {
  const P = $('#panel'); P.classList.toggle('open', open); document.body.classList.toggle('panel-open', open);
  $('#pTitle')?.setAttribute('aria-expanded', open); if (open) requestAnimationFrame(placeAll);
}
$('#pscrim').onclick = () => setPanel(false);
phone.addEventListener?.('change', () => { if (!phone.matches) setPanel(false); placeAll(); });
let ty = null;
$('#panel').addEventListener('touchstart', e => { if (e.target.closest('#pTitle')) ty = e.touches[0].clientY; }, { passive: true });
$('#panel').addEventListener('touchend', e => {
  if (ty == null) return; const dy = e.changedTouches[0].clientY - ty; ty = null;
  if (dy > 40) setPanel(false); else if (dy < -40) setPanel(true);
}, { passive: true });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setSheet(false); setPanel(false); } });

/* 테마 */
function currentDark() { const a = document.documentElement.dataset.theme; return a ? a === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function paintToggle() { const d = currentDark(); $('#t-light').setAttribute('aria-pressed', !d); $('#t-dark').setAttribute('aria-pressed', d); $('#knob').style.transform = d ? 'translateX(36px)' : 'none'; }
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('uc-theme', t); } catch { /* 없음 */ } paintToggle(); }
$('#t-light').onclick = () => setTheme('light'); $('#t-dark').onclick = () => setTheme('dark');
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintToggle);

// 변환 중에 창을 닫으려 하면 확인
window.addEventListener('beforeunload', e => { if (files.some(f => f.status === 'run' || f.status === 'queued')) { e.preventDefault(); e.returnValue = ''; } });

// 지난번 큰 파일 임시본 정리
import('./convert/media.js').then(m => m.cleanupOpfs()).catch(() => {});

renderRows(); renderPanel(false); renderCats(); paintToggle();
document.fonts?.ready.then(placeAll);
