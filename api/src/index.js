// 퀴즈세상 API — 아이별 풀이 기록 + 문제 신고. Cloudflare Worker + KV.
//  GET  /api/progress/:uid   기록 읽기
//  PUT  /api/progress/:uid   기록 저장 — 덮어쓰지 않고 서버 값과 '병합'한다(docs/DATA.md 3절)
//  GET  /api/reports         신고 목록
//  POST /api/report          신고 추가 {id, by} — 추가만 가능
//  GET  /api/custom          직접 만든 문제 목록(공개)  · POST /api/custom 추가·수정 · DELETE /api/custom/:id  (X-Admin-Token)
// 쓰기는 X-Edit-Token 필요. 비밀번호는 게임월드와 같은 값을 쓴다(앱이 게임월드 저장값을 그대로 읽음).
import { mergeProgress } from './merge.js';

const ALLOWED_ORIGINS = ['https://junyoungcha83.github.io', 'http://localhost:8000'];
const MAX_BYTES = 1024 * 1024;
const UID = /^[A-Za-z0-9_-]{1,40}$/;
const QID = /^[a-z]+-[1-4]-(\d{4}|u[a-z0-9]+)$/;   // 기본 문제(0001) 또는 직접 만든 문제(u…)
const SECTIONS = ['history', 'general', 'news', 'nonsense', 'english'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// 관리자(문제 직접 입력)는 아이 폰의 동기화 비밀번호와 다른 ADMIN_TOKEN 으로만 — 아이들이 문제를 바꾸지 못하게
const admin = (req, env) => !!env.ADMIN_TOKEN && (req.headers.get('X-Admin-Token') || '') === env.ADMIN_TOKEN;
// 직접 입력은 검증 과정을 거치지 않으므로, 앱이 깨지지 않을 최소한의 형식만 본다
function checkCustom(q) {
  if (!q || typeof q !== 'object') return '형식 오류';
  if (!SECTIONS.includes(q.section)) return '분야 오류';
  if (![1, 2, 3, 4].includes(q.level)) return '단계 오류';
  if (!String(q.q || '').trim()) return '문제를 입력하세요';
  if (q.section === 'nonsense') { if (!String(q.a || '').trim()) return '답을 입력하세요'; }
  else {
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || q.choices.some(c => !String(c || '').trim())) return '보기 4개를 모두 입력하세요';
    if (new Set(q.choices.map(c => String(c).trim())).size !== 4) return '보기가 서로 달라야 해요';
    if (![0, 1, 2, 3].includes(q.answer)) return '정답을 고르세요';
  }
  if (q.section === 'news' && !DATE.test(q.expires || '')) return '시사 문제는 유효기간이 필요해요';
  if (String(q.q).length > 500 || String(q.explain || '').length > 1000) return '글이 너무 길어요';
  return '';
}

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Token, X-Admin-Token',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
  };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), {
  status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const authed = (req, env) => !!env.EDIT_TOKEN && (req.headers.get('X-Edit-Token') || '') === env.EDIT_TOKEN;
async function readJSON(env, key) { try { const r = await env.QUIZ.get(key); return r ? JSON.parse(r) : null; } catch { return null; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });

    const pm = url.pathname.match(/^\/api\/progress\/([^/]+)$/);
    if (pm) {
      const uid = decodeURIComponent(pm[1]);
      if (!UID.test(uid)) return json({ error: 'bad_uid' }, 400, h);
      const key = `progress:${uid}`;
      if (req.method === 'GET') return json((await readJSON(env, key)) || { userId: uid, q: {}, wrong: {}, fav: {}, best: {} }, 200, h);
      if (req.method === 'PUT') {
        if (!authed(req, env)) return json({ error: 'unauthorized' }, 401, h);
        const body = await req.text();
        if (body.length > MAX_BYTES) return json({ error: 'too_large' }, 413, h);
        let incoming; try { incoming = JSON.parse(body); } catch { return json({ error: 'invalid_json' }, 400, h); }
        if (!incoming || typeof incoming !== 'object') return json({ error: 'invalid_shape' }, 400, h);
        const merged = mergeProgress(await readJSON(env, key), incoming);
        merged.userId = uid;
        await env.QUIZ.put(key, JSON.stringify(merged));
        return json(merged, 200, h);   // 병합 결과를 돌려줘 앱이 다른 기기 기록까지 받게 한다
      }
      return json({ error: 'method_not_allowed' }, 405, h);
    }

    // ── 직접 만든 문제(관리자 모드) — KV 'custom' 에 {id: 문제} 로 저장. 읽기는 공개, 쓰기는 ADMIN_TOKEN ──
    if (url.pathname === '/api/custom' && req.method === 'GET') {
      return json((await readJSON(env, 'custom')) || {}, 200, h);
    }
    if (url.pathname === '/api/admin/check' && req.method === 'POST') {
      return json({ ok: admin(req, env) }, admin(req, env) ? 200 : 401, h);
    }
    if (url.pathname === '/api/custom' && req.method === 'POST') {
      if (!admin(req, env)) return json({ error: 'unauthorized' }, 401, h);
      let q; try { q = await req.json(); } catch { return json({ error: 'invalid_json' }, 400, h); }
      const bad = checkCustom(q);
      if (bad) return json({ error: 'invalid', detail: bad }, 400, h);
      const all = (await readJSON(env, 'custom')) || {};
      const now = new Date().toISOString();
      const prev = q.id && all[q.id];
      if (q.id && !prev) return json({ error: 'not_found' }, 404, h);
      // 새 문제는 서버가 id 를 붙인다: <섹션>-<단계>-u<시각> (기본 문제 id 와 겹치지 않게)
      // 수정하면서 분야·단계를 바꾸면 id 앞부분이 달라지므로 새 id 로 옮긴다
      const moved = prev && (prev.section !== q.section || prev.level !== q.level);
      const id = prev && !moved ? q.id : `${q.section}-${q.level}-u${Date.now().toString(36)}`;
      if (moved) delete all[q.id];
      all[id] = {
        id, section: q.section, level: q.level, type: q.section === 'nonsense' ? 'reveal' : 'mcq', q: q.q.trim(),
        ...(q.section === 'nonsense' ? { a: q.a.trim() } : { choices: q.choices.map(c => String(c).trim()), answer: q.answer }),
        explain: String(q.explain || '').trim(),
        sources: String(q.source || '').trim() ? [{ title: String(q.source).trim().slice(0, 300) }] : [{ title: '직접 입력' }],
        ...(q.section === 'news' ? { as_of: now.slice(0, 10), expires: q.expires } : {}),
        status: 'verified', custom: true, created: prev ? prev.created : now.slice(0, 10), rev: prev ? (prev.rev || 1) + 1 : 1, updated: now,
      };
      await env.QUIZ.put('custom', JSON.stringify(all));
      return json(all[id], 200, h);
    }
    const cm = url.pathname.match(/^\/api\/custom\/([^/]+)$/);
    if (cm && req.method === 'DELETE') {
      if (!admin(req, env)) return json({ error: 'unauthorized' }, 401, h);
      const all = (await readJSON(env, 'custom')) || {};
      const id = decodeURIComponent(cm[1]);
      if (!all[id]) return json({ error: 'not_found' }, 404, h);
      delete all[id];
      await env.QUIZ.put('custom', JSON.stringify(all));
      return json({ ok: true }, 200, h);
    }

    if (url.pathname === '/api/reports' && req.method === 'GET') {
      return json((await readJSON(env, 'reports')) || {}, 200, h);
    }
    if (url.pathname === '/api/report' && req.method === 'POST') {
      if (!authed(req, env)) return json({ error: 'unauthorized' }, 401, h);
      let b; try { b = await req.json(); } catch { return json({ error: 'invalid_json' }, 400, h); }
      if (!b || !QID.test(String(b.id || ''))) return json({ error: 'bad_id' }, 400, h);
      const reports = (await readJSON(env, 'reports')) || {};
      // 이미 고쳤거나 되살린 신고를 아이가 다시 누르면 다시 숨긴다(새 신고로 본다)
      reports[b.id] = { at: new Date().toISOString(), by: String(b.by || '').slice(0, 40), state: 'hidden' };
      await env.QUIZ.put('reports', JSON.stringify(reports));
      return json({ ok: true }, 200, h);
    }

    if (url.pathname === '/' || url.pathname === '/api/health') return json({ ok: true, service: 'quiz-world-api' }, 200, h);
    return new Response('Not Found', { status: 404, headers: h });
  },
};
