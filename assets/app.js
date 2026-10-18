// 퀴즈세상 — 사용자 선택(게임월드 사용자) → 섹션 → 단계 → 한 판(10문제) → 결과.
// 문제는 data/ 의 JSON 에만 있다(앱 코드에 문제를 넣지 않는다). 기록은 지금은 이 기기에만 저장 — 동기화는 다음 단계.

const GW_API     = 'https://game-world-api.junyoung-cha83.workers.dev';
const GW_CURUSER = 'game-world-current-user';   // 같은 주소(github.io)라 게임월드에서 고른 아이를 그대로 읽을 수 있다
const USERS_KEY  = 'quiz-world-users';          // 게임월드 사용자 목록 캐시(오프라인용)
const CUR_KEY    = 'quiz-world-current-user';
const progKey = id => 'quiz-world-progress:' + id;
const ROUND = 10;
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
const qCache = {};   // 파일 경로 → 문제 배열

// ── 유틸 ──────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function readJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function today() { return new Date().toISOString().slice(0, 10); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function avatar(u, cls = '') {
  const inner = u && u.photo ? `<img src="${esc(u.photo)}" alt="" />` : esc((u && u.name || '?').trim().charAt(0) || '?');
  return `<span class="av ${cls}">${inner}</span>`;
}

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
function setUser(u) {
  user = u; localStorage.setItem(CUR_KEY, u.id);
  prog = readJSON(progKey(u.id), null) || { userId: u.id, q: {}, wrong: {}, fav: {}, best: {} };
  const chip = document.getElementById('userChip');
  chip.innerHTML = `${avatar(u)}${esc(u.name)}`; chip.classList.remove('hidden');
}
function saveProg() { prog.updated = new Date().toISOString(); writeJSON(progKey(user.id), prog); }

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
// 유효기한이 지난 시사 문제는 빼고 보여 준다(업데이트가 늦어도 틀린 정답이 나오지 않게)
function usable(q) { return !(q.expires && q.expires < today()); }

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
function record(q, ok) {
  const s = prog.q[q.id] || (prog.q[q.id] = { seen: 0, ok: 0, ng: 0 });
  s.seen++; s.last = new Date().toISOString();
  if (q.type === 'mcq') { if (ok) s.ok++; else s.ng++; s.lastOk = ok; }
  saveProg();
}

// ── 화면 ─────────────────────────────────────────────
function renderUsers() {
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
  const have = Object.fromEntries((index.sections || []).map(s => [s.id, s]));
  app.innerHTML = `<h2>${esc(user.name)}, 어떤 퀴즈를 풀까요?</h2>
    <div class="sections">${ALL_SECTIONS.map(s => {
      const got = have[s.id], n = got ? Object.values(got.levels).reduce((t, l) => t + l.count, 0) : 0;
      return `<button class="sec-btn" data-sec="${s.id}"${got ? '' : ' disabled'}>
        <span class="emo">${s.emoji}</span><b>${esc(s.name)}</b>
        <small>${got ? `${n}문제${s.id === 'nonsense' ? ' · 점수 없이 즐기기' : ''}` : '준비 중'}</small></button>`;
    }).join('')}</div>`;
  app.querySelectorAll('.sec-btn:not([disabled])').forEach(b => b.onclick = () => renderLevels(b.dataset.sec));
}

function renderLevels(secId) {
  const sec = index.sections.find(s => s.id === secId);
  app.innerHTML = `<button class="back" id="back">‹ 분야 고르기</button>
    <h2>${sec.emoji} ${esc(sec.name)} — 단계 고르기</h2>
    <div class="levels">${[1, 2, 3, 4].map(lv => {
      const l = sec.levels[lv], best = prog.best[`${secId}-${lv}`];
      return `<button class="lv-btn" data-lv="${lv}"${l ? '' : ' disabled'}>
        <span class="lv-n">${lv}</span>
        <span><b>${LEVELS[lv][0]}</b><small>${l ? `${l.count}문제${best && sec.type === 'mcq' ? ` · 최고 ${best.score}점` : ''}` : '준비 중'}</small></span></button>`;
    }).join('')}</div>`;
  document.getElementById('back').onclick = renderHome;
  app.querySelectorAll('.lv-btn:not([disabled])').forEach(b => b.onclick = () => play(sec, Number(b.dataset.lv)));
}

async function play(sec, lv) {
  app.innerHTML = `<p class="muted">문제를 불러오는 중…</p>`;
  let qs;
  try { qs = await loadQuestions(sec.levels[lv].file); }
  catch { app.innerHTML = `<p class="muted">문제를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p><button class="btn sub" id="back">돌아가기</button>`; document.getElementById('back').onclick = () => renderLevels(sec.id); return; }
  const round = pickRound(qs, ROUND);
  const st = { i: 0, score: 0, streak: 0, bestStreak: 0 };
  const isMcq = sec.type === 'mcq';

  const show = () => {
    const q = round[st.i];
    const bar = `<div class="qbar"><span>${st.i + 1} / ${round.length}</span>
      <span class="track"><span class="fill" style="width:${(st.i / round.length) * 100}%"></span></span>
      ${isMcq ? `<span class="streak">${st.streak >= 2 ? `🔥 ${st.streak}연속` : ''}</span>` : ''}</div>`;
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
        if (ok) { st.score++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else st.streak = 0;
        record(q, ok);
        document.getElementById('after').innerHTML = `<div class="explain"><span class="verdict ${ok ? 'ok' : 'ng'}">${ok ? '⭕ 정답!' : '❌ 아쉬워요'}</span>${esc(q.explain)}</div>
          <button class="btn" id="next">${st.i + 1 < round.length ? '다음 문제' : '결과 보기'}</button>`;
        document.getElementById('next').onclick = next;
      });
    } else {
      app.innerHTML = `${bar}<div class="qcard"><p class="qtext">${esc(q.q)}</p><div id="after"><button class="btn" id="reveal">답 보기</button></div></div>`;
      document.getElementById('reveal').onclick = () => {
        record(q);
        document.getElementById('after').innerHTML = `<div class="explain"><div class="answer">${esc(q.a)}</div>${q.explain ? esc(q.explain) : ''}</div>
          <button class="btn" id="next">${st.i + 1 < round.length ? '다음 문제' : '끝'}</button>`;
        document.getElementById('next').onclick = next;
      };
    }
    window.scrollTo(0, 0);
  };
  const next = () => { st.i++; if (st.i < round.length) show(); else finish(); };
  const finish = () => {
    if (!isMcq) {
      app.innerHTML = `<div class="result"><div class="big">🤪</div><p class="msg">${round.length}문제를 다 봤어요!</p>
        <button class="btn" id="again">또 하기</button><button class="btn sub" id="home">분야 고르기</button></div>`;
    } else {
      const key = `${sec.id}-${lv}`, prev = prog.best[key] || { score: 0, streak: 0 };
      const newBest = st.score > prev.score;
      prog.best[key] = { score: Math.max(prev.score, st.score), streak: Math.max(prev.streak, st.bestStreak) };
      saveProg();
      const ratio = st.score / round.length;
      const msg = ratio === 1 ? '만점이에요! 🎉' : ratio >= 0.7 ? '아주 잘했어요!' : ratio >= 0.4 ? '좋아요, 조금만 더!' : '다시 하면 더 잘할 수 있어요!';
      app.innerHTML = `<div class="result"><div class="big">${st.score} / ${round.length}</div><p class="msg">${msg}</p>
        <p class="muted">최고 연속 정답 ${st.bestStreak}개${newBest ? ' · 🏆 이 단계 최고 점수!' : ''}</p>
        <button class="btn" id="again">한 판 더</button><button class="btn sub" id="home">분야 고르기</button></div>`;
    }
    document.getElementById('again').onclick = () => play(sec, lv);
    document.getElementById('home').onclick = renderHome;
  };
  if (!round.length) { app.innerHTML = `<p class="muted">지금 풀 수 있는 문제가 없어요.</p>`; return; }
  show();
}

// ── 시작 ─────────────────────────────────────────────
document.getElementById('btnHome').onclick = () => (user ? renderHome() : renderUsers());
document.getElementById('userChip').onclick = renderUsers;
(async () => {
  app.innerHTML = `<p class="muted">불러오는 중…</p>`;
  await Promise.all([loadUsers(), loadIndex()]);
  const u = pickInitialUser();
  if (u) { setUser(u); renderHome(); } else renderUsers();
})();
