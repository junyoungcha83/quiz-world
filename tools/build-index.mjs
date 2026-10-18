#!/usr/bin/env node
// data/q/*.json 을 훑어 data/index.json(앱이 처음 읽는 목차)을 만든다. 손으로 고치지 않는다.
// 먼저 validate.mjs 가 통과해야 만든다 — 점검 안 된 문제가 앱으로 나가지 않게.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECTIONS = [
  { id: 'history',  name: '역사',     emoji: '🏯', type: 'mcq' },
  { id: 'general',  name: '일반상식', emoji: '💡', type: 'mcq' },
  { id: 'news',     name: '시사',     emoji: '📰', type: 'mcq' },
  { id: 'nonsense', name: '넌센스',   emoji: '🤪', type: 'reveal' },
  { id: 'english',  name: '영어단어', emoji: '🔤', type: 'mcq' },
];

try { execFileSync('node', [join(ROOT, 'tools', 'validate.mjs')], { stdio: 'inherit' }); }
catch { console.error('점검 오류가 있어 index.json 을 만들지 않았습니다.'); process.exit(1); }

const qdir = join(ROOT, 'data', 'q');
const files = existsSync(qdir) ? readdirSync(qdir).filter(f => /^[a-z]+-[1-4]\.json$/.test(f)) : [];
const out = SECTIONS.map(s => ({ ...s, levels: {} }));
for (const f of files) {
  const [sec, lv] = f.replace('.json', '').split('-');
  const doc = JSON.parse(readFileSync(join(qdir, f), 'utf8'));
  const n = doc.questions.length;
  const target = out.find(s => s.id === sec);
  if (target && n) target.levels[lv] = { file: `q/${f}`, count: n };
}

const today = new Date().toISOString().slice(0, 10);
const prev = existsSync(join(ROOT, 'data', 'index.json')) ? JSON.parse(readFileSync(join(ROOT, 'data', 'index.json'), 'utf8')) : null;
const seq = prev && String(prev.version).startsWith(today) ? (Number(String(prev.version).split('.')[1]) || 0) + 1 : 1;
const index = { version: `${today}.${seq}`, sections: out.filter(s => Object.keys(s.levels).length) };
writeFileSync(join(ROOT, 'data', 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`data/index.json 갱신 — 버전 ${index.version}, 섹션 ${index.sections.length}개`);
