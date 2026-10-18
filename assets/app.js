// 퀴즈세상 — 사용자 선택(게임월드 사용자) → 섹션 → 단계 → 한 판(10문제) → 결과.
// 문제는 data/ 의 JSON 에만 있다(앱 코드에 문제를 넣지 않는다).
// 기록은 아이별로 이 기기 + 퀴즈세상 서버에 저장하고, 서버는 덮어쓰지 않고 병합한다(merge.js).

const API        = 'https://quiz-world-api.junyoung-cha83.workers.dev';
const GW_API     = 'https://game-world-api.junyoung-cha83.workers.dev';
// 같은 주소(github.io)라 게임월드의 저장값을 그대로 읽는다 — 아이 선택·동기화 비밀번호를 다시 묻지 않으려고
const GW_CURUSER = 'game-world-current-user';
const GW_TOKEN   = 'game-world-edit-token';
const USERS_KEY  = 'quiz-world-users';          // 게임월드 사용자 목록 캐시(오프라인용)
const CUR_KEY    = 'quiz-world-current-user';
const REPORTS_KEY = 'quiz-world-reports';       // 서버 신고 목록 캐시 + 아직 못 보낸 내 신고
const progKey = id => 'quiz-world-progress:' + id;
const ROUND = 10;
const WRONG_CLEAR = 2;                          // 오답 노트: 다시 풀어 이만큼 연속으로 맞히면 빠진다
const LEVELS = {
  1: ['유치원', '그림책·일상 경험'],
  2: ['초등 저학년', '1~2학년'],
  3: ['초등 고학년', '3~6학년'],
  4: ['중학교', '중학 교과'],
};
// 목차에 아직 없는 섹션도 '준비 중'으로 보여 준다
const ALL_SECTIONS = [
  { id: 'history',  name: '역사',     emoji: '🏯' },
  { id: 'general',  name: '일반상식', emoji: '💡' },
  { id: 'news',     name: '시사',     emoji: '📰' },
  { id: 'nonsense', name: '넌센스',   emoji: '🤪' },
  { id: 'english',  name: '영어단어', emoji: '🔤' },
];

const app = document.getElementById('app');
let users = [], user = null, index = null, prog = null;
let reports = {};    // 서버 신고 { qid: {state} } — state:'hidden' 이면 숨김
let pendingReports = [];   // 비밀번호가 없거나 오프라인일 때 못 보낸 신고
const qCache = {};   // 파일 경로 → 문제 배열
let custom = {};     // 직접 만든 문제 { id: 문제 }
const CUSTOM_KEY = 'quiz-world-custom';
const ADMIN_KEY  = 'quiz-world-admin-token';   // 관리자 비밀번호 — 입력한 기기에만 저장

// ── 유틸 ──────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function nowIso() { return new Date().toISOString(); }
function today() { return nowIso().slice(0, 10); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function token() { return localStorage.getItem(GW_TOKEN) || ''; }
function avatar(u, cls = '') {
  const inner = u && u.photo ? `<img src="${esc(u.photo)}" alt="" />` : esc((u && u.name || '?').trim().charAt(0) || '?');
  return `<span class="av ${cls}">${inner}</span>`;
}
function setSync(t) { const el = document.getElementById('syncStatus'); if (el) el.textContent = t || ''; }

// ── 사용자 (게임월드 서버에서 읽기만) ─────────────────────
async function loadUsers() {
  users = readJSON(USERS_KEY, []);
  try {
    const r = await fetch(`${GW_API}/api/data`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && Array.isArray(j.users)) {
        users = j.users.map(u => ({ id: u.id, name: u.name, photo: u.photo || '' }));
        writeJSON(USERS_KEY, users);
      }
    }
  } catch {}
}
function pickInitialUser() {
  const id = localStorage.getItem(CUR_KEY) || localStorage.getItem(GW_CURUSER);
  return users.find(u => u.id === id) || null;
}
function emptyProg(id) { return { userId: id, q: {}, wrong: {}, fav: {}, best: {} }; }
function setUser(u) {
  user = u; localStorage.setItem(CUR_KEY, u.id);
  prog = readJSON(progKey(u.id), null) || emptyProg(u.id);
  const chip = document.getElementById('userChip');
  chip.innerHTML = `${avatar(u)}${esc(u.name)}`; chip.classList.remove('hidden');
  pullProgress();
}

// ── 기록 동기화 — 서버는 병합해서 돌려준다 ─────────────────
function saveProg() { prog.updated = nowIso(); writeJSON(progKey(user.id), prog); schedulePush(); }
let _pushTimer = null;
function schedulePush() { clearTimeout(_pushTimer); _pushTimer = setTimeout(pushProgress, 800); }
async function pushProgress() {
  _pushTimer = null;
  if (!user) return;
  if (!token()) { setSync('이 기기에만 저장'); return; }
  const uid = user.id, sent = prog;
  setSync('저장 중…');
  try {
    const r = await fetch(`${API}/api/progress/${encodeURIComponent(uid)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': token() }, body: JSON.stringify(sent),
    });
    if (!r.ok) { setSync(r.status === 401 ? '비밀번호 오류' : '저장 실패'); return; }
    const merged = await r.json();
    // 보내는 사이 사용자가 바뀌었거나 새 기록이 생겼어도 잃지 않게 다시 병합
    if (user && user.id === uid) { prog = mergeProgress(merged, prog); writeJSON(progKey(uid), prog); }
    setSync('✓ 저장됨');
  } catch { setSync('오프라인(이 기기에 저장)'); }
}
async function pullProgress() {
  if (!user) return;
  const uid = user.id;
  try {
    const r = await fetch(`${API}/api/progress/${encodeURIComponent(uid)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const remote = await r.json();
    if (!user || user.id !== uid) return;
    prog = mergeProgress(remote, prog);
    writeJSON(progKey(uid), prog);
    if (onHome) renderHome();
  } catch {}
}

// ── 신고 ─────────────────────────────────────────────
async function loadReports() {
  const cached = readJSON(REPORTS_KEY, { server: {}, pending: [] });
  reports = cached.server || {}; pendingReports = cached.pending || [];
  try {
    const r = await fetch(`${API}/api/reports`, { cache: 'no-store' });
    if (r.ok) reports = await r.json();
  } catch {}
  writeJSON(REPORTS_KEY, { server: reports, pending: pendingReports });
  flushReports();
}
function isHidden(id) { return (reports[id] && reports[id].state === 'hidden') || pendingReports.some(p => p.id === id); }
async function flushReports() {
  if (!token() || !pendingReports.length) return;
  const left = [];
  for (const p of pendingReports) {
    try {
      const r = await fetch(`${API}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': token() }, body: JSON.stringify(p) });
      if (r.ok) reports[p.id] = { state: 'hidden', at: p.at }; else left.push(p);
    } catch { left.push(p); }
  }
  pendingReports = left;
  writeJSON(REPORTS_KEY, { server: reports, pending: pendingReports });
}
function report(q) {
  pendingReports.push({ id: q.id, by: user.id, at: nowIso() });
  writeJSON(REPORTS_KEY, { server: reports, pending: pendingReports });
  flushReports();
}

// ── 문제 데이터 ───────────────────────────────────────
async function loadIndex() {
  try { const r = await fetch('data/index.json', { cache: 'no-cache' }); if (r.ok) index = await r.json(); } catch {}
  if (!index) index = readJSON('quiz-world-index', { sections: [] });
  else writeJSON('quiz-world-index', index);
}
async function loadQuestions(file) {
  if (qCache[file]) return qCache[file];
  const r = await fetch('data/' + file, { cache: 'no-cache' });
  const j = await r.json();
  return (qCache[file] = j.questions || []);
}
// 직접 만든 문제(관리자 모드) — 서버에서 읽어 기본 문제와 합친다. 오프라인이면 마지막으로 받은 것.
async function loadCustom() {
  custom = readJSON(CUSTOM_KEY, {});
  try { const r = await fetch(`${API}/api/custom`, { cache: 'no-store' }); if (r.ok) { custom = await r.json(); writeJSON(CUSTOM_KEY, custom); } } catch {}
}
function customFor(sec, lv) { return Object.values(custom).filter(q => q.section === sec && q.level === lv); }
// 기본 문제(목차)와 직접 만든 문제를 합친 분야·단계 목록 — 문제가 있는 단계만 levels 에 들어간다
function catalog() {
  return ALL_SECTIONS.map(s => {
    const st = (index.sections || []).find(x => x.id === s.id);
    const levels = {};
    for (const lv of [1, 2, 3, 4]) {
      const base = st && st.levels[lv];
      const count = (base ? base.count : 0) + customFor(s.id, lv).length;
      if (count) levels[lv] = { file: base ? base.file : null, count };
    }
    return { ...s, type: s.id === 'nonsense' ? 'reveal' : 'mcq', levels };
  });
}
async function questionsFor(secId, lv) {
  const l = catalog().find(s => s.id === secId).levels[lv];
  const base = l && l.file ? await loadQuestions(l.file) : [];
  return base.concat(customFor(secId, lv));
}
// 문제 id(history-2-0007, 직접 만든 문제는 history-2-u…) → 문제 객체로
async function loadByIds(ids) {
  const files = new Set();
  for (const id of ids) {
    const [sec, lv] = id.split('-');
    const s = (index.sections || []).find(x => x.id === sec), l = s && s.levels[lv];
    if (l) files.add(l.file);
  }
  const all = (await Promise.all([...files].map(f => loadQuestions(f).catch(() => [])))).flat().concat(Object.values(custom));
  const want = new Set(ids);
  return all.filter(q => want.has(q.id));
}
// 유효기한이 지난 시사 문제·신고된 문제는 빼고 보여 준다
function usable(q) { return !(q.expires && q.expires < today()) && !isHidden(q.id); }

// 배분 가중치(docs/DATA.md 5절): 안 푼 문제 우선, 최근에 본 문제는 덜 나오게
function weight(q) {
  const s = prog.q[q.id];
  if (!s) return 1;
  let w = s.lastOk === false ? 0.6 : 0.3 / Math.max(1, s.ok || 1);
  if (s.last && Date.now() - Date.parse(s.last) < 24 * 3600 * 1000) w *= 0.1;
  return w;
}
function pickRound(qs, n) {
  const pool = qs.filter(usable).map(q => ({ q, w: weight(q) }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((t, p) => t + p.w, 0);
    let r = Math.random() * total, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0].q);
  }
  return out;
}

// ── 오답 노트·즐겨찾기 ────────────────────────────────
// 오답 노트 항목은 지우지 않고 cleared(빠진 시각)를 남긴다 — 다른 기기 기록과 병합할 때 되살아나지 않게
function inWrong(id) { const w = prog.wrong[id]; return !!w && !(w.cleared && w.cleared >= w.added); }
// 신고로 숨겨진 문제는 개수에서도 뺀다(눌러도 풀 문제가 없는 일이 없게)
function wrongIds() { return Object.keys(prog.wrong).filter(id => inWrong(id) && !isHidden(id)); }
function isFav(id) { return !!(prog.fav[id] && prog.fav[id].on); }
function favIds() { return Object.keys(prog.fav).filter(id => isFav(id) && !isHidden(id)); }
function toggleFav(id) { prog.fav[id] = { on: !isFav(id), at: nowIso() }; saveProg(); return isFav(id); }

function record(q, ok) {
  const s = prog.q[q.id] || (prog.q[q.id] = { seen: 0, ok: 0, ng: 0 });
  s.seen++; s.last = nowIso();
  if (q.type === 'mcq') {
    if (ok) s.ok++; else s.ng++;
    s.lastOk = ok;
    if (!ok) prog.wrong[q.id] = { okStreak: 0, added: nowIso() };   // 틀리면 들어가고, 이미 있으면 연속 정답이 처음부터
    else if (inWrong(q.id)) {
      const w = prog.wrong[q.id];
      w.okStreak = (w.okStreak || 0) + 1;
      if (w.okStreak >= WRONG_CLEAR) w.cleared = nowIso();
      else w.added = nowIso();     // 진행 상황도 '변경'이라 시각을 갱신(병합 시 최신 유지)
    }
  }
  saveProg();
}

// ── 화면 ─────────────────────────────────────────────
let onHome = false;
function renderUsers() {
  onHome = false;
  document.getElementById('userChip').classList.add('hidden');
  if (!users.length) {
    app.innerHTML = `<h2>누가 풀까요?</h2><p class="muted">게임월드 사용자 목록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.</p>`;
    return;
  }
  app.innerHTML = `<h2>누가 풀까요?</h2>
    <div class="users">${users.map(u => `<button class="user-btn" data-uid="${esc(u.id)}">${avatar(u, 'lg')}${esc(u.name)}</button>`).join('')}</div>`;
  app.querySelectorAll('.user-btn').forEach(b => b.onclick = () => { setUser(users.find(u => u.id === b.dataset.uid)); renderHome(); });
}

function renderHome() {
  onHome = true;
  const have = Object.fromEntries(catalog().filter(s => Object.keys(s.levels).length).map(s => [s.id, s]));
  const nw = wrongIds().length, nf = favIds().length;
  app.innerHTML = `<h2>${esc(user.name)}, 어떤 퀴즈를 풀까요?</h2>
    <div class="sections">${ALL_SECTIONS.map(s => {
      const got = have[s.id], n = got ? Object.values(got.levels).reduce((t, l) => t + l.count, 0) : 0;
      return `<button class="sec-btn" data-sec="${s.id}"${got ? '' : ' disabled'}>
        <span class="emo">${s.emoji}</span><b>${esc(s.name)}</b>
        <small>${got ? `${n}문제${s.id === 'nonsense' ? ' · 점수 없이 즐기기' : ''}` : '준비 중'}</small></button>`;
    }).join('')}</div>
    <div class="extras">
      <button class="extra-btn" id="goWrong"${nw ? '' : ' disabled'}>📝 오답 노트 <b>${nw}</b></button>
      <button class="extra-btn" id="goFav"${nf ? '' : ' disabled'}>⭐ 즐겨찾기 <b>${nf}</b></button>
    </div>
    <p class="sync-line muted" id="syncStatus"></p>
    <button class="admin-link" id="goAdmin">⚙️ 관리자</button>`;
  app.querySelectorAll('.sec-btn:not([disabled])').forEach(b => b.onclick = () => renderLevels(b.dataset.sec));
  document.getElementById('goAdmin').onclick = () => (adminToken() ? renderAdmin() : renderAdminLogin());
  document.getElementById('goWrong').onclick = playWrong;
  document.getElementById('goFav').onclick = renderFavs;
  if (!token()) setSync('게임월드에서 동기화 비밀번호를 넣으면 다른 기기와 기록이 이어져요.');
}

function renderLevels(secId) {
  onHome = false;
  const sec = catalog().find(s => s.id === secId);
  app.innerHTML = `<button class="back" id="back">‹ 분야 고르기</button>
    <h2>${sec.emoji} ${esc(sec.name)} — 단계 고르기</h2>
    <div class="levels">${[1, 2, 3, 4].map(lv => {
      const l = sec.levels[lv], best = prog.best[`${secId}-${lv}`];
      return `<button class="lv-btn" data-lv="${lv}"${l ? '' : ' disabled'}>
        <span class="lv-n">${lv}</span>
        <span><b>${LEVELS[lv][0]}</b><small>${l ? `${l.count}문제${best && sec.type === 'mcq' ? ` · 최고 ${best.score}점` : ''}` : '준비 중'}</small></span></button>`;
    }).join('')}</div>`;
  document.getElementById('back').onclick = renderHome;
  app.querySelectorAll('.lv-btn:not([disabled])').forEach(b => b.onclick = async () => {
    const lv = Number(b.dataset.lv);
    app.innerHTML = `<p class="muted">문제를 불러오는 중…</p>`;
    let qs;
    try { qs = await questionsFor(sec.id, lv); }
    catch { loadFail(() => renderLevels(sec.id)); return; }
    play(pickRound(qs, ROUND), { key: `${sec.id}-${lv}`, again: () => b.onclick(), back: () => renderLevels(sec.id) });
  });
}
function loadFail(back) {
  app.innerHTML = `<p class="muted">문제를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p><button class="btn sub" id="back">돌아가기</button>`;
  document.getElementById('back').onclick = back;
}

async function playWrong() {
  onHome = false;
  app.innerHTML = `<p class="muted">오답 노트를 불러오는 중…</p>`;
  const qs = (await loadByIds(wrongIds())).filter(q => q.type === 'mcq');
  play(shuffle(qs.filter(usable)).slice(0, ROUND), { wrongMode: true, again: playWrong, back: renderHome });
}

async function renderFavs() {
  onHome = false;
  app.innerHTML = `<p class="muted">즐겨찾기를 불러오는 중…</p>`;
  const qs = await loadByIds(favIds());
  app.innerHTML = `<button class="back" id="back">‹ 분야 고르기</button><h2>⭐ 즐겨찾기 ${qs.length}개</h2>
    <div class="fav-list">${qs.map(q => `<div class="fav-item">
      <p class="fav-q">${esc(q.q)}</p>
      <p class="fav-a">→ <b>${esc(q.type === 'mcq' ? q.choices[q.answer] : q.a)}</b></p>
      ${q.explain ? `<p class="fav-e muted">${esc(q.explain)}</p>` : ''}
      <button class="star on" data-id="${esc(q.id)}" aria-label="즐겨찾기 빼기">★</button></div>`).join('') || '<p class="muted">즐겨찾기한 문제가 없어요.</p>'}</div>`;
  document.getElementById('back').onclick = renderHome;
  app.querySelectorAll('.fav-item .star').forEach(b => b.onclick = () => { toggleFav(b.dataset.id); b.closest('.fav-item').remove(); });
}

// 한 판 진행. ctx: { key(최고점 저장용, 일반 모드만), wrongMode, again(), back() }
function play(round, ctx) {
  onHome = false;
  if (!round.length) {
    app.innerHTML = `<p class="muted">${ctx.wrongMode ? '오답 노트가 비었어요. 잘했어요! 🎉' : '지금 풀 수 있는 문제가 없어요.'}</p><button class="btn sub" id="back">돌아가기</button>`;
    document.getElementById('back').onclick = ctx.back; return;
  }
  const st = { i: 0, score: 0, streak: 0, bestStreak: 0, cleared: 0, mcq: 0 };

  // 정답 확인 뒤 아래쪽 도구줄: 즐겨찾기 · 신고
  const tools = q => `<div class="qtools">
      <button class="star${isFav(q.id) ? ' on' : ''}" id="star" aria-label="즐겨찾기">${isFav(q.id) ? '★' : '☆'} 즐겨찾기</button>
      <button class="report" id="report">🚩 문제가 이상해요</button></div>`;
  const bindTools = q => {
    const s = document.getElementById('star');
    s.onclick = () => { const on = toggleFav(q.id); s.classList.toggle('on', on); s.textContent = `${on ? '★' : '☆'} 즐겨찾기`; };
    const rp = document.getElementById('report');
    // 한 번 더 눌러야 신고 — 잘못 누르는 걸 줄인다(신고하면 두 아이 모두에게 숨겨진다)
    rp.onclick = () => {
      if (!rp.dataset.armed) { rp.dataset.armed = '1'; rp.textContent = '정말 신고할까요? 한 번 더 누르세요'; return; }
      report(q); rp.disabled = true; rp.textContent = '신고했어요. 이 문제는 숨겨져요';
    };
  };

  const show = () => {
    const q = round[st.i];
    const isMcq = q.type === 'mcq';
    const bar = `<div class="qbar"><span>${ctx.wrongMode ? '📝 ' : ''}${st.i + 1} / ${round.length}</span>
      <span class="track"><span class="fill" style="width:${(st.i / round.length) * 100}%"></span></span>
      ${isMcq ? `<span class="streak">${st.streak >= 2 ? `🔥 ${st.streak}연속` : ''}</span>` : ''}</div>`;
    const nextLabel = st.i + 1 < round.length ? '다음 문제' : (isMcq ? '결과 보기' : '끝');
    if (isMcq) {
      // 선택지는 풀 때마다 섞는다 — 정답 번호를 외워도 소용없게
      const order = shuffle([0, 1, 2, 3]);
      app.innerHTML = `${bar}<div class="qcard"><p class="qtext">${esc(q.q)}</p>
        <div class="choices">${order.map((ci, k) => `<button class="choice" data-ci="${ci}"><span class="num">${k + 1}</span>${esc(q.choices[ci])}</button>`).join('')}</div>
        <div id="after"></div></div>`;
      app.querySelectorAll('.choice').forEach(b => b.onclick = () => {
        const ok = Number(b.dataset.ci) === q.answer;
        app.querySelectorAll('.choice').forEach(x => { x.disabled = true; if (Number(x.dataset.ci) === q.answer) x.classList.add('ok'); });
        if (!ok) b.classList.add('ng');
        st.mcq++;
        if (ok) { st.score++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else st.streak = 0;
        const wasWrong = inWrong(q.id);
        record(q, ok);
        let note = '';
        if (wasWrong && ok) note = inWrong(q.id) ? `<small class="wnote">📝 한 번 더 맞히면 오답 노트에서 빠져요</small>` : `<small class="wnote">📝 오답 노트에서 빠졌어요!</small>`;
        if (wasWrong && ok && !inWrong(q.id)) st.cleared++;
        if (!ok) note = `<small class="wnote">📝 오답 노트에 넣었어요</small>`;
        document.getElementById('after').innerHTML = `<div class="explain"><span class="verdict ${ok ? 'ok' : 'ng'}">${ok ? '⭕ 정답!' : '❌ 아쉬워요'}</span>${esc(q.explain)}${note}</div>
          ${tools(q)}<button class="btn" id="next">${nextLabel}</button>`;
        bindTools(q);
        document.getElementById('next').onclick = next;
      });
    } else {
      app.innerHTML = `${bar}<div class="qcard"><p class="qtext">${esc(q.q)}</p><div id="after"><button class="btn" id="reveal">답 보기</button></div></div>`;
      document.getElementById('reveal').onclick = () => {
        record(q);
        document.getElementById('after').innerHTML = `<div class="explain"><div class="answer">${esc(q.a)}</div>${q.explain ? esc(q.explain) : ''}</div>
          ${tools(q)}<button class="btn" id="next">${nextLabel}</button>`;
        bindTools(q);
        document.getElementById('next').onclick = next;
      };
    }
    window.scrollTo(0, 0);
  };
  const next = () => { st.i++; if (st.i < round.length) show(); else finish(); };
  const finish = () => {
    if (!st.mcq) {
      app.innerHTML = `<div class="result"><div class="big">🤪</div><p class="msg">${round.length}문제를 다 봤어요!</p>
        <button class="btn" id="again">또 하기</button><button class="btn sub" id="home">분야 고르기</button></div>`;
    } else {
      let extra = '';
      if (ctx.key) {
        const prev = prog.best[ctx.key] || { score: 0, streak: 0 };
        if (st.score > prev.score) extra = ' · 🏆 이 단계 최고 점수!';
        prog.best[ctx.key] = { score: Math.max(prev.score, st.score), streak: Math.max(prev.streak, st.bestStreak) };
        saveProg();
      }
      if (ctx.wrongMode) extra = ` · 오답 노트에서 ${st.cleared}개 빠짐 (남은 ${wrongIds().length}개)`;
      const ratio = st.score / st.mcq;
      const msg = ratio === 1 ? '만점이에요! 🎉' : ratio >= 0.7 ? '아주 잘했어요!' : ratio >= 0.4 ? '좋아요, 조금만 더!' : '다시 하면 더 잘할 수 있어요!';
      app.innerHTML = `<div class="result"><div class="big">${st.score} / ${st.mcq}</div><p class="msg">${msg}</p>
        <p class="muted">최고 연속 정답 ${st.bestStreak}개${extra}</p>
        <button class="btn" id="again">한 판 더</button><button class="btn sub" id="home">분야 고르기</button></div>`;
    }
    document.getElementById('again').onclick = ctx.again;
    document.getElementById('home').onclick = renderHome;
  };
  show();
}

// ── 관리자 모드 — 직접 문제 만들기(검증 없이 바로 등록) ──────────
// 저장하면 서버(KV)에 들어가고 두 아이 모두에게 바로 보인다. 앱 코드·문제 파일은 다시 배포하지 않는다.
function adminToken() { return localStorage.getItem(ADMIN_KEY) || ''; }
function adminHeaders() { return { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken() }; }
const SEC_LABEL = Object.fromEntries(ALL_SECTIONS.map(s => [s.id, `${s.emoji} ${s.name}`]));

function renderAdminLogin(msg = '') {
  onHome = false;
  app.innerHTML = `<button class="back" id="back">‹ 분야 고르기</button><h2>⚙️ 관리자 모드</h2>
    <div class="adm-card">
      <label class="adm-lbl" for="admPw">관리자 비밀번호</label>
      <input class="adm-in" id="admPw" type="password" inputmode="numeric" autocomplete="off" />
      <p class="adm-err">${esc(msg)}</p>
      <button class="btn" id="admGo">들어가기</button>
    </div>`;
  document.getElementById('back').onclick = renderHome;
  const go = async () => {
    const pw = document.getElementById('admPw').value.trim();
    if (!pw) return;
    try {
      const r = await fetch(`${API}/api/admin/check`, { method: 'POST', headers: { 'X-Admin-Token': pw } });
      if (r.ok) { localStorage.setItem(ADMIN_KEY, pw); renderAdmin(); }
      else renderAdminLogin('비밀번호가 맞지 않아요.');
    } catch { renderAdminLogin('인터넷 연결을 확인해 주세요.'); }
  };
  document.getElementById('admGo').onclick = go;
  document.getElementById('admPw').onkeydown = e => { if (e.key === 'Enter') go(); };
}

function threeMonthsLater() { const d = new Date(); d.setMonth(d.getMonth() + 3); return d.toISOString().slice(0, 10); }

// editing: 고칠 문제(없으면 새 문제)
function renderAdmin(editing = null, notice = '') {
  onHome = false;
  const e = editing || {};
  const kind = e.section === 'nonsense' ? 'nonsense' : 'basic';
  const mine = Object.values(custom).sort((a, b) => String(b.updated || '').localeCompare(a.updated || ''));
  const ch = e.choices || ['', '', '', ''];
  const opt = (v, label, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${label}</option>`;
  app.innerHTML = `<button class="back" id="back">‹ 분야 고르기</button>
    <h2>⚙️ ${editing ? '문제 고치기' : '새 문제 만들기'}</h2>
    ${notice ? `<p class="adm-ok">${esc(notice)}</p>` : ''}
    <div class="adm-card">
      <div class="adm-row">
        <label class="adm-radio"><input type="radio" name="kind" value="basic"${kind === 'basic' ? ' checked' : ''}> 기본 (4지선다)</label>
        <label class="adm-radio"><input type="radio" name="kind" value="nonsense"${kind === 'nonsense' ? ' checked' : ''}> 넌센스 (답 하나)</label>
      </div>
      <div class="adm-row">
        <select class="adm-in" id="admSec">${['history', 'general', 'news', 'english'].map(id => opt(id, SEC_LABEL[id], e.section || 'general')).join('')}</select>
        <select class="adm-in" id="admLv">${[1, 2, 3, 4].map(lv => opt(lv, `${lv}단계 · ${LEVELS[lv][0]}`, e.level || 2)).join('')}</select>
      </div>

      <label class="adm-lbl" for="admQ">문제</label>
      <textarea class="adm-in" id="admQ" rows="3">${esc(e.q || '')}</textarea>

      <div id="admBasic">
        <label class="adm-lbl">보기 4개 <small>— 정답인 보기 왼쪽 동그라미를 눌러요</small></label>
        ${ch.map((c, i) => `<div class="adm-choice"><input type="radio" name="ans" value="${i}"${e.answer === i ? ' checked' : ''} aria-label="${i + 1}번이 정답">
          <input class="adm-in" id="admC${i}" value="${esc(c)}" placeholder="보기 ${i + 1}" /></div>`).join('')}
      </div>
      <div id="admNonsense">
        <label class="adm-lbl" for="admA">답</label>
        <input class="adm-in" id="admA" value="${esc(e.a || '')}" />
      </div>

      <div id="admExpWrap">
        <label class="adm-lbl" for="admExp">유효기간 <small>— 시사 문제만. 이 날짜가 지나면 자동으로 숨겨져요</small></label>
        <input class="adm-in" id="admExp" type="date" value="${esc(e.expires || threeMonthsLater())}" />
      </div>

      <label class="adm-lbl" for="admEx">해설</label>
      <textarea class="adm-in" id="admEx" rows="2" placeholder="(선택) 정답을 고른 뒤 보여 줄 짧은 설명">${esc(e.explain || '')}</textarea>
      <label class="adm-lbl" for="admSrc">출처</label>
      <input class="adm-in" id="admSrc" value="${esc(e.sources && e.sources[0] && e.sources[0].title !== '직접 입력' ? e.sources[0].title : '')}" placeholder="(선택) 예: 국립중앙박물관 누리집, 교과서 3학년 사회" />

      <p class="adm-err" id="admErr"></p>
      <button class="btn" id="admSave">${editing ? '고친 내용 저장' : '저장'}</button>
      ${editing ? '<button class="btn sub" id="admCancel">고치기 그만두기</button>' : ''}
    </div>

    <h2 class="adm-h">내가 만든 문제 ${mine.length}개</h2>
    <div class="fav-list">${mine.map(q => `<div class="fav-item adm-item">
      <small class="muted">${SEC_LABEL[q.section]} · ${q.level}단계${q.expires ? ` · ~${esc(q.expires)}${q.expires < today() ? ' (지남)' : ''}` : ''}${isHidden(q.id) ? ' · 🚩신고됨' : ''}</small>
      <p class="fav-q">${esc(q.q)}</p>
      <p class="fav-a">→ <b>${esc(q.type === 'mcq' ? q.choices[q.answer] : q.a)}</b></p>
      <div class="adm-acts"><button class="star" data-edit="${esc(q.id)}">고치기</button><button class="report" data-del="${esc(q.id)}">지우기</button></div>
    </div>`).join('') || '<p class="muted">아직 없어요.</p>'}</div>
    <button class="admin-link" id="admOut">관리자 모드 나가기 (이 기기에서 비밀번호 지우기)</button>`;

  // 기본/넌센스에 따라 보기 칸을 바꾸고, 유효기간은 시사일 때만 켠다
  const sync = () => {
    const isN = app.querySelector('input[name=kind]:checked').value === 'nonsense';
    document.getElementById('admBasic').classList.toggle('hidden', isN);
    document.getElementById('admNonsense').classList.toggle('hidden', !isN);
    document.getElementById('admSec').disabled = isN;
    const isNews = !isN && document.getElementById('admSec').value === 'news';
    document.getElementById('admExpWrap').classList.toggle('off', !isNews);
    document.getElementById('admExp').disabled = !isNews;
  };
  app.querySelectorAll('input[name=kind]').forEach(r => r.onchange = sync);
  document.getElementById('admSec').onchange = sync;
  sync();

  document.getElementById('back').onclick = renderHome;
  if (editing) document.getElementById('admCancel').onclick = () => renderAdmin();
  document.getElementById('admOut').onclick = () => { localStorage.removeItem(ADMIN_KEY); renderHome(); };

  document.getElementById('admSave').onclick = async () => {
    const err = document.getElementById('admErr');
    const isN = app.querySelector('input[name=kind]:checked').value === 'nonsense';
    const section = isN ? 'nonsense' : document.getElementById('admSec').value;
    const body = {
      ...(editing ? { id: editing.id } : {}),
      section, level: Number(document.getElementById('admLv').value),
      q: document.getElementById('admQ').value,
      explain: document.getElementById('admEx').value,
      source: document.getElementById('admSrc').value,
    };
    if (isN) body.a = document.getElementById('admA').value;
    else {
      body.choices = [0, 1, 2, 3].map(i => document.getElementById('admC' + i).value);
      const a = app.querySelector('input[name=ans]:checked');
      body.answer = a ? Number(a.value) : -1;
    }
    if (section === 'news') body.expires = document.getElementById('admExp').value;
    // 서버와 같은 기준을 먼저 화면에서 확인 — 빠진 칸을 바로 알려 준다
    const miss = !body.q.trim() ? '문제를 입력하세요'
      : isN ? (!body.a.trim() ? '답을 입력하세요' : '')
      : body.choices.some(c => !c.trim()) ? '보기 4개를 모두 입력하세요'
      : new Set(body.choices.map(c => c.trim())).size !== 4 ? '보기가 서로 달라야 해요'
      : body.answer < 0 ? '정답인 보기를 골라 주세요' : '';
    if (miss) { err.textContent = miss; return; }
    err.textContent = '저장 중…';
    try {
      const r = await fetch(`${API}/api/custom`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(body) });
      if (r.status === 401) { localStorage.removeItem(ADMIN_KEY); renderAdminLogin('비밀번호가 바뀌었어요. 다시 입력해 주세요.'); return; }
      const j = await r.json();
      if (!r.ok) { err.textContent = j.detail || '저장하지 못했어요.'; return; }
      if (editing && editing.id !== j.id) delete custom[editing.id];   // 분야·단계를 바꾸면 새 id
      custom[j.id] = j; writeJSON(CUSTOM_KEY, custom);
      renderAdmin(null, editing ? '고친 내용을 저장했어요.' : `저장했어요. ${SEC_LABEL[j.section]} ${j.level}단계에 바로 나와요.`);
    } catch { err.textContent = '인터넷 연결을 확인해 주세요.'; }
  };

  app.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { renderAdmin(custom[b.dataset.edit]); window.scrollTo(0, 0); });
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '한 번 더 누르면 지워져요'; return; }
    try {
      const r = await fetch(`${API}/api/custom/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE', headers: adminHeaders() });
      if (r.ok || r.status === 404) { delete custom[b.dataset.del]; writeJSON(CUSTOM_KEY, custom); renderAdmin(null, '지웠어요.'); }
      else b.textContent = '지우지 못했어요';
    } catch { b.textContent = '인터넷 연결을 확인해 주세요'; }
  });
  window.scrollTo(0, 0);
}

// ── 시작 ─────────────────────────────────────────────
// 게임월드의 '퀴즈세상' 카드로 들어왔으면 돌아가는 버튼을 보여 준다(앱 안에서 화면이 바뀌어도 유지)
try { if (/\/game-world\//.test(document.referrer)) sessionStorage.setItem('quiz-world-from-gw', '1'); } catch {}
if (sessionStorage.getItem('quiz-world-from-gw')) {
  const gb = document.getElementById('gwBack'); gb.classList.remove('hidden');
  gb.onclick = () => { location.href = '../game-world/'; };
}
document.getElementById('btnHome').onclick = () => (user ? renderHome() : renderUsers());
document.getElementById('userChip').onclick = renderUsers;
// 앱으로 돌아올 때마다 다른 기기 기록·신고를 받아 온다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !user) return;
  if (!_pushTimer) pullProgress();
  loadReports();
  loadCustom().then(() => { if (onHome) renderHome(); });
});
(async () => {
  app.innerHTML = `<p class="muted">불러오는 중…</p>`;
  await Promise.all([loadUsers(), loadIndex(), loadReports(), loadCustom()]);
  const u = pickInitialUser();
  if (u) { setUser(u); renderHome(); } else renderUsers();
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
