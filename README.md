# 퀴즈세상

승호·승아가 분야(역사·일반상식·시사·넌센스·영어단어)와 단계(1~4)를 골라 푸는 퀴즈 PWA.
게임월드의 '퀴즈' 아이콘으로 열고, 따로 설치도 된다.

- 계획: [docs/PLAN.md](docs/PLAN.md)
- 데이터 구조: [docs/DATA.md](docs/DATA.md)

## 문제 추가 흐름

```
tools/drafts/ 에 초안 작성 → node tools/validate.mjs tools/drafts/<파일>
→ 사람 훑어보기 → status: verified 로 바꿔 data/q/<섹션>-<단계>.json 에 합치기
→ node tools/build-index.mjs  (점검 통과해야 목차 생성)
```

문제는 `data/` 에만 있다. 문제를 바꿔도 앱 코드는 다시 배포하지 않는다.

## 운영

- 앱: https://junyoungcha83.github.io/quiz-world/
- 기록 서버: `api/` (Cloudflare Worker `quiz-world-api`, KV `QUIZ`). 배포 `cd api && npx wrangler deploy`
- 동기화 비밀번호는 게임월드와 같은 값 — 앱이 게임월드에 저장된 값을 그대로 읽는다.
- 신고 확인: `node tools/reports.mjs` · 되살리기 `restore <id>` · 고친 뒤 `fixed <id>`
- 병합 규칙은 `api/src/merge.js` 와 `assets/merge.js` 가 같아야 한다(앱용 사본).
