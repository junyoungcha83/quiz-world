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
