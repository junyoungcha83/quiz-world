#!/usr/bin/env node
// 신고 확인·처리 (맥에서). 신고된 문제는 두 아이 모두에게 숨겨져 있다.
//   node tools/reports.mjs                  목록 (문제 내용 함께)
//   node tools/reports.mjs restore <id>     잘못 누른 신고 → 다시 보이게
//   node tools/reports.mjs fixed <id>       문제를 고친 뒤(rev +1) → 다시 보이게
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NS = '355b2778a9174f09a8037f0b97a6d168';
const kv = (...a) => execFileSync('npx', ['wrangler', 'kv', 'key', ...a, '--namespace-id', NS, '--remote'], { cwd: join(ROOT, 'api'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let reports = {};
try { reports = JSON.parse(kv('get', 'reports') || '{}'); } catch {}
const [cmd, id] = process.argv.slice(2);

function findQ(qid) {
  const [sec, lv] = qid.split('-');
  const f = join(ROOT, 'data', 'q', `${sec}-${lv}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).questions.find(q => q.id === qid) : null;
}

if (!cmd) {
  const rows = Object.entries(reports).sort((a, b) => String(b[1].at).localeCompare(a[1].at));
  if (!rows.length) { console.log('신고가 없습니다.'); process.exit(0); }
  for (const [qid, r] of rows) {
    const q = findQ(qid);
    console.log(`${r.state === 'hidden' ? '🚩 숨김' : '✅ ' + r.state}  ${qid}  (${String(r.at).slice(0, 16)})`);
    if (q) console.log(`   ${q.q}\n   → ${q.type === 'mcq' ? q.choices[q.answer] : q.a}`);
  }
} else if ((cmd === 'restore' || cmd === 'fixed') && id) {
  if (!reports[id]) { console.error(`${id} 신고가 없습니다.`); process.exit(1); }
  reports[id] = { ...reports[id], state: cmd === 'restore' ? 'restored' : 'fixed', handled: new Date().toISOString() };
  const tmp = join(mkdtempSync(join(tmpdir(), 'qw-')), 'reports.json');
  writeFileSync(tmp, JSON.stringify(reports));
  kv('put', 'reports', '--path', tmp);
  console.log(`${id} → ${reports[id].state} (다시 보이게 됨)`);
} else {
  console.log('사용: node tools/reports.mjs [restore|fixed <문제id>]');
}
