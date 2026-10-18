#!/usr/bin/env node
// 퀴즈세상 문제 기계 점검 — docs/DATA.md 규칙을 그대로 검사한다.
// 사용: node tools/validate.mjs [파일...]   (인자 없으면 data/q/*.json 전부)
//  · 오류(ERROR)가 하나라도 있으면 종료 코드 1 → 앱 데이터로 옮기지 않는다.
//  · 경고(WARN)는 사람이 보고 판단한다(정답만 긴 선택지, 비슷한 문제 등).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECTIONS = ['history', 'general', 'news', 'nonsense', 'english'];
const BANNED = /모두\s*(정답|맞|옳)|정답\s*없음|위의?\s*(것|보기)\s*모두|보기\s*중\s*없음|all of the above|none of the above/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SIMILAR = 0.6;          // 문제+정답 글자 유사도 이 이상이면 '비슷한 문제' 경고 (어미만 다른 문제가 0.7대, 다른 문제는 0.3 아래)
const LONG_ANSWER = 1.8;      // 정답 길이가 다른 선택지 평균의 이 배수 이상이면 경고

const errors = [], warns = [];
const err = (id, m) => errors.push(`${id}: ${m}`);
const warn = (id, m) => warns.push(`${id}: ${m}`);

// 공백·문장부호를 뺀 글자 2개씩 묶음 → Jaccard 유사도
const norm = s => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function bigrams(s) { const n = norm(s), out = new Set(); for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2)); return out; }
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function checkQuestion(q, file) {
  const id = q.id || `(id 없음 @${file})`;
  if (!q.id || !/^[a-z]+-[1-4]-\d{4}$/.test(q.id)) err(id, 'id 형식은 <section>-<level>-<4자리>');
  if (!SECTIONS.includes(q.section)) err(id, `section 값 오류: ${q.section}`);
  if (![1, 2, 3, 4].includes(q.level)) err(id, `level 은 1~4: ${q.level}`);
  if (q.id && q.section && q.level && !q.id.startsWith(`${q.section}-${q.level}-`)) err(id, 'id 앞부분이 section·level 과 다름');
  if (!q.q || !String(q.q).trim()) err(id, '문제(q) 없음');
  if (!['draft', 'verified', 'rejected'].includes(q.status)) err(id, `status 값 오류: ${q.status}`);
  if (!q.created || !DATE.test(q.created)) err(id, 'created 날짜 형식(YYYY-MM-DD)');
  if (!Number.isInteger(q.rev) || q.rev < 1) err(id, 'rev 는 1 이상 정수');

  const isNonsense = q.section === 'nonsense';
  const wantType = isNonsense ? 'reveal' : 'mcq';
  if (q.type !== wantType) err(id, `type 은 ${wantType} 이어야 함`);

  if (q.type === 'mcq') {
    const c = q.choices;
    if (!Array.isArray(c) || c.length !== 4) err(id, '선택지는 정확히 4개');
    else {
      if (c.some(x => !String(x || '').trim())) err(id, '빈 선택지');
      if (new Set(c.map(norm)).size !== 4) err(id, '같은 선택지가 있음');
      c.forEach(x => { if (BANNED.test(x)) err(id, `금지 선택지: "${x}"`); });
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(id, 'answer 는 0~3');
      else {
        const ans = String(c[q.answer]).length;
        const others = c.filter((_, i) => i !== q.answer).map(x => String(x).length);
        const avg = others.reduce((s, n) => s + n, 0) / others.length;
        if (avg > 0 && ans >= avg * LONG_ANSWER && ans - avg >= 4) warn(id, `정답만 김 (정답 ${ans}자 / 나머지 평균 ${avg.toFixed(1)}자)`);
      }
    }
    if (!q.explain || !String(q.explain).trim()) err(id, '해설(explain) 없음');
  }
  if (q.type === 'reveal' && (!q.a || !String(q.a).trim())) err(id, '답(a) 없음');

  // 출처 — 넌센스는 '자체 창작' 허용, 나머지는 주소+확인 날짜 필수
  const src = Array.isArray(q.sources) ? q.sources : [];
  if (!src.length) err(id, '출처(sources) 없음');
  if (isNonsense) {
    if (src.length && !src.some(s => s && s.title === '자체 창작')) err(id, '넌센스 출처는 "자체 창작"');
  } else {
    src.forEach((s, i) => {
      if (!s || !s.title) err(id, `출처 ${i + 1}: title 없음`);
      if (!s || !/^https?:\/\//.test(s.url || '')) err(id, `출처 ${i + 1}: url 없음/형식 오류`);
      if (!s || !DATE.test(s.checked || '')) err(id, `출처 ${i + 1}: checked 날짜 없음/형식 오류`);
    });
  }

  if (q.section === 'news') {
    if (!DATE.test(q.as_of || '')) err(id, '시사: as_of(기준 날짜) 필수');
    if (!DATE.test(q.expires || '')) err(id, '시사: expires(유효기한) 필수');
    else if (q.expires < new Date().toISOString().slice(0, 10)) warn(id, `유효기한 지남 (${q.expires}) — 앱에서 숨겨짐`);
    if (q.as_of && q.expires && q.expires <= q.as_of) err(id, 'expires 가 as_of 보다 늦어야 함');
  }
}

// ── 실행 ──
const qdir = join(ROOT, 'data', 'q');
const args = process.argv.slice(2);
const files = args.length ? args : (existsSync(qdir) ? readdirSync(qdir).filter(f => f.endsWith('.json')).map(f => join(qdir, f)) : []);
if (!files.length) { console.log('점검할 파일이 없습니다.'); process.exit(0); }

const all = [];   // 중복·유사 검사용 (섹션 전체 — 단계가 달라도 같은 문제면 잡는다)
for (const f of files) {
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { err(f, `JSON 오류: ${e.message}`); continue; }
  if (!doc || !Array.isArray(doc.questions)) { err(f, 'questions 배열 없음'); continue; }
  const inQ = f.includes(`${'/data/q/'}`);
  for (const q of doc.questions) {
    checkQuestion(q, f);
    if (doc.section && q.section !== doc.section) err(q.id, `파일 section(${doc.section})과 다름`);
    if (doc.level && q.level !== doc.level) err(q.id, `파일 level(${doc.level})과 다름`);
    if (inQ && q.status !== 'verified') err(q.id, 'data/q/ 에는 verified 만 둔다');
    all.push({ ...q, _bg: bigrams(q.q + ' ' + (q.type === 'mcq' ? q.choices?.[q.answer] : q.a)) });
  }
}

const seenId = new Map();
for (const q of all) {
  if (seenId.has(q.id)) err(q.id, '같은 id 가 두 번 나옴');
  seenId.set(q.id, true);
}
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = all[i], b = all[j];
  if (a.section !== b.section) continue;
  if (norm(a.q) === norm(b.q)) { err(a.id, `${b.id} 와 같은 문제`); continue; }
  const s = similarity(a._bg, b._bg);
  if (s >= SIMILAR) warn(a.id, `${b.id} 와 비슷함 (유사도 ${s.toFixed(2)})`);
}

const count = all.length;
console.log(`점검: 파일 ${files.length}개 · 문제 ${count}개 · 오류 ${errors.length} · 경고 ${warns.length}`);
errors.forEach(m => console.log('  ERROR ' + m));
warns.forEach(m => console.log('  WARN  ' + m));
process.exit(errors.length ? 1 : 0);
