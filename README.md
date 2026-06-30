# Stock Insight

개인용 주식 신호 데스크톱 위젯 (Tauri + Next.js).

미국·한국 주식 시세/뉴스를 10분마다 수집하고, Claude 하이브리드 분석으로
영향 기업·공급망·매수/매도 신호를 데스크톱 위젯에 표시한다.

> 투자 참고용입니다. 투자 책임은 본인에게 있습니다.

## Dev 실행

1. `.env` 작성 (`.env.example` 참고). `FINNHUB_TOKEN` 필수 — https://finnhub.io 무료 가입 후 발급.
2. 워커 기동(별도 터미널): `npm run worker`
3. 앱 기동: `NEXT_PUBLIC_DB_PATH="$(pwd)/data/app.db" npm run tauri dev`

워커와 앱은 같은 `data/app.db`를 본다 (워커=쓰기, 앱=읽기, SQLite WAL 모드).
대시보드는 30초마다 DB를 재조회한다.

## 테스트

```bash
npm test   # vitest
```

## 구조

- `app/` — Next.js UI (정적 export, Tauri가 번들)
- `lib/db.ts` — 프론트의 SQLite 읽기 (`@tauri-apps/plugin-sql`)
- `worker/` — Node 수집·분석 워커 (`node-cron`, `better-sqlite3`)
  - `sources/finnhub.ts` — 미국 시세 클라이언트
- `src-tauri/` — Tauri Rust 셸
- `docs/superpowers/plans/` — 구현 계획 (Phase 0~6 로드맵)
