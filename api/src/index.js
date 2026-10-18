// 퀴즈세상 API — 아이별 풀이 기록 + 문제 신고. Cloudflare Worker + KV.
//  GET  /api/progress/:uid   기록 읽기
//  PUT  /api/progress/:uid   기록 저장 — 덮어쓰지 않고 서버 값과 '병합'한다(docs/DATA.md 3절)
//  GET  /api/reports         신고 목록
//  POST /api/report          신고 추가 {id, by} — 추가만 가능
// 쓰기는 X-Edit-Token 필요. 비밀번호는 게임월드와 같은 값을 쓴다(앱이 게임월드 저장값을 그대로 읽음).
import { mergeProgress } from './merge.js';

const ALLOWED_ORIGINS = ['https://junyoungcha83.github.io', 'http://localhost:8000'];
const MAX_BYTES = 1024 * 1024;
const UID = /^[A-Za-z0-9_-]{1,40}$/;
const QID = /^[a-z]+-[1-4]-\d{4}$/;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Token',
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
