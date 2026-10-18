# 퀴즈세상 — 데이터 구조

## 1. 문제 파일 `data/q/<section>-<level>.json`

```json
{
  "section": "history",
  "level": 2,
  "questions": [ { ...문제... } ]
}
```

### 4지선다 문제 (`type: "mcq"`)

```json
{
  "id": "history-2-0001",
  "section": "history",
  "level": 2,
  "type": "mcq",
  "q": "한글을 만든 조선의 임금은 누구일까요?",
  "choices": ["세종대왕", "태조 이성계", "정조", "광개토대왕"],
  "answer": 0,
  "explain": "세종대왕은 1443년 훈민정음을 만들고 1446년 세상에 알렸어요.",
  "tags": ["조선", "한글"],
  "sources": [
    { "title": "국립한글박물관 — 훈민정음", "url": "https://www.hangeul.go.kr/", "checked": "2026-10-18" }
  ],
  "status": "verified",
  "created": "2026-10-18",
  "rev": 1
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | O | `<section>-<level>-<4자리>`. 한 번 정하면 바꾸지 않는다(기록·오답 노트가 이 id 로 붙는다). |
| `section` | O | `history` `general` `news` `nonsense` `english` |
| `level` | O | 1 유치원 · 2 초등 저학년 · 3 초등 고학년 · 4 중학교 |
| `type` | O | `mcq`(4지선다) 또는 `reveal`(답보기 — 넌센스) |
| `q` | O | 문제 |
| `choices` | mcq | 선택지 정확히 4개. 저장 순서는 의미 없음 — 앱이 매번 섞는다. |
| `answer` | mcq | `choices` 안의 정답 위치(0~3) |
| `a` | reveal | 넌센스 답 |
| `explain` | mcq 필수 / reveal 선택 | 짧은 해설(1~2문장) |
| `tags` | 선택 | 세부 주제. 비슷한 문제 묶기·나중 필터용 |
| `sources` | O | `{title, url, checked}` 목록. 넌센스는 `[{"title":"자체 창작"}]` |
| `as_of` | news 필수 | 시사 기준 날짜 `YYYY-MM-DD` |
| `expires` | news 필수 | 유효기한 `YYYY-MM-DD`. 지나면 앱이 숨김 |
| `status` | O | `draft`(초안) · `verified`(검증 통과) · `rejected`(반려). `data/q/` 에는 `verified` 만 |
| `created` | O | 만든 날짜 |
| `rev` | O | 내용을 고칠 때마다 +1. 고친 문제는 오답 노트·기록이 그대로 유지된다 |

### 넌센스 (`type: "reveal"`)

```json
{
  "id": "nonsense-2-0001",
  "section": "nonsense",
  "level": 2,
  "type": "reveal",
  "q": "세상에서 가장 빠른 닭은?",
  "a": "후다닥",
  "explain": "'후다닥' 하고 뛰어가서요.",
  "sources": [{ "title": "자체 창작" }],
  "status": "verified",
  "created": "2026-10-18",
  "rev": 1
}
```

## 2. 목차 `data/index.json`

앱이 처음 읽는 파일. 문제가 있는 칸만 적는다(없는 칸은 앱에서 숨김).

```json
{
  "version": "2026-10-18.1",
  "sections": [
    { "id": "history", "name": "역사", "emoji": "🏯", "type": "mcq",
      "levels": { "2": { "file": "q/history-2.json", "count": 30 } } }
  ]
}
```

`tools/build-index.mjs` 가 `data/q/` 를 훑어 자동으로 만든다(손으로 고치지 않음).

## 3. 아이별 기록 (서버 KV `progress:<userId>`)

```json
{
  "userId": "u...",
  "updated": "2026-10-18T10:00:00Z",
  "q": {
    "history-2-0001": { "seen": 3, "ok": 2, "ng": 1, "last": "2026-10-18T10:00:00Z", "lastOk": true }
  },
  "wrong": { "history-2-0007": { "okStreak": 1, "added": "2026-10-18T09:00:00Z" } },
  "fav":   { "nonsense-2-0001": { "on": true, "at": "2026-10-18T09:30:00Z" } },
  "best":  { "history": { "streak": 7, "score": 9 } }
}
```

- `q`: 문제별 풀이 기록 — 배분 가중치 계산용.
- `wrong`: 오답 노트. `okStreak` 가 2가 되면 빠진다(빠질 때 항목 삭제가 아니라 `cleared` 시각을 남겨 병합 시 되살아나지 않게 한다).
- `fav`: 즐겨찾기. 끈 것도 `on:false` 와 시각으로 남긴다(병합 시 시각이 늦은 쪽이 이김).
- 넌센스는 `q` 에 `seen` 만 쌓고 점수·오답 노트에 들어가지 않는다.

### 서버 병합 규칙 (PUT 은 덮어쓰기가 아니라 병합)

| 항목 | 규칙 |
|---|---|
| `q.*.seen/ok/ng` | 큰 값 |
| `q.*.last`, `lastOk` | `last` 가 늦은 쪽 |
| `wrong.*`, `fav.*` | 시각(`added`·`cleared`·`at`)이 늦은 쪽 |
| `best.*` | 큰 값 |

## 4. 신고 (서버 KV `reports`)

```json
{ "history-2-0007": { "at": "2026-10-18T10:05:00Z", "by": "u...", "state": "hidden" } }
```

- 앱 → `POST /api/report {id, by}` (추가만). `state: "hidden"` 이면 두 아이 모두에게 숨김.
- 맥에서 `tools/reports.mjs` 로 목록 확인 → 문제를 고치면 `rev` +1 후 `state: "fixed"`, 잘못된 신고면 `state: "restored"`.

## 5. 배분 가중치

한 판(10문제)을 고를 때 문제마다 가중치를 주고 그 비율로 뽑는다.

| 상태 | 가중치 |
|---|---|
| 안 푼 문제 | 1.0 |
| 마지막에 틀린 문제 | 0.6 |
| 맞힌 문제 | 0.3 ÷ (맞힌 횟수) |
| 24시간 안에 본 문제 | × 0.1 |
| 신고·유효기한 지난 문제 | 0 (제외) |

## 6. 영어단어 원천

- 단어 목록·단계: 승호의사전 `data/level.json`(교육부 고시 제2015-74호 기본 어휘 목록) — **읽기만**.
  - `lv1`(초등 권장 800) → 1~3단계, `lv2`(중·고 공통) → 4단계.
  - 1단계(유치원)는 lv1 중 그림으로 떠올릴 수 있는 쉬운 낱말(동물·색·가족·음식 등)만 골라 쓴다.
- 뜻: 승호의사전 `core.json`(손질된 뜻) 우선, 없으면 사전 뜻을 확인해 새로 쓴다.
- 오답 선택지: 같은 품사·같은 단계의 다른 단어 뜻에서 고른다(뜻이 겹치는 단어 제외).
