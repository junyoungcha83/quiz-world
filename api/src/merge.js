// 아이별 기록 병합 — 서버(Worker)와 앱이 똑같이 쓴다. 앱용 사본: assets/merge.js (내용을 항상 같게 유지).
// 규칙(docs/DATA.md 3절): 카운터는 큰 값, 시각이 있는 항목은 늦은 쪽. 같은 데이터를 몇 번 병합해도 결과가 같다.
const later = (a, b) => (String(a || '') >= String(b || '') ? a : b);
const stamp = w => later(w && w.added, w && w.cleared);   // 오답 노트 항목의 마지막 변경 시각

export function mergeProgress(a, b) {
  a = a || {}; b = b || {};
  const out = { userId: b.userId || a.userId, q: {}, wrong: {}, fav: {}, best: {} };
  for (const id of new Set([...Object.keys(a.q || {}), ...Object.keys(b.q || {})])) {
    const x = (a.q || {})[id], y = (b.q || {})[id];
    if (!x || !y) { out.q[id] = { ...(x || y) }; continue; }
    const newer = String(x.last || '') >= String(y.last || '') ? x : y;
    out.q[id] = { seen: Math.max(x.seen || 0, y.seen || 0), ok: Math.max(x.ok || 0, y.ok || 0), ng: Math.max(x.ng || 0, y.ng || 0), last: newer.last };
    if (newer.lastOk !== undefined) out.q[id].lastOk = newer.lastOk;
  }
  for (const id of new Set([...Object.keys(a.wrong || {}), ...Object.keys(b.wrong || {})])) {
    const x = (a.wrong || {})[id], y = (b.wrong || {})[id];
    out.wrong[id] = { ...(!x ? y : !y ? x : (String(stamp(x)) >= String(stamp(y)) ? x : y)) };
  }
  for (const id of new Set([...Object.keys(a.fav || {}), ...Object.keys(b.fav || {})])) {
    const x = (a.fav || {})[id], y = (b.fav || {})[id];
    out.fav[id] = { ...(!x ? y : !y ? x : (String(x.at || '') >= String(y.at || '') ? x : y)) };
  }
  for (const k of new Set([...Object.keys(a.best || {}), ...Object.keys(b.best || {})])) {
    const x = (a.best || {})[k] || {}, y = (b.best || {})[k] || {};
    out.best[k] = { score: Math.max(x.score || 0, y.score || 0), streak: Math.max(x.streak || 0, y.streak || 0) };
  }
  out.updated = later(a.updated, b.updated);
  return out;
}
