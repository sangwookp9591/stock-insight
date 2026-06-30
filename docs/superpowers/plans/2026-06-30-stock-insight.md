# Stock Insight 데스크톱 위젯 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미국·한국 주식의 시세/뉴스를 10분마다 수집하고, Claude 하이브리드 분석으로 영향 기업·공급망·매수/매도 신호를 만들어 데스크톱 위젯에 표시하는 개인용 Tauri 앱을 만든다.

**Architecture:** Tauri(Rust 셸) + Next.js(정적 export) UI가 SQLite를 `tauri-plugin-sql`로 읽고, 별도 Node 워커(node-cron)가 10분마다 수집·분석해 같은 SQLite에 쓴다. 쓰기는 워커 단독, 읽기는 UI — SQLite WAL 모드로 동시 접근. Claude는 앱 시작 시 구독 OAuth로 인증.

**Tech Stack:** Tauri v2, Next.js 15(App Router, `output: 'export'`), React 19 + TypeScript, Tailwind v4, SQLite(`better-sqlite3` 쓰기 / `@tauri-apps/plugin-sql` 읽기), `node-cron`, Finnhub(미국)·KIS OpenAPI(한국), Anthropic SDK(OAuth), Telegram Bot API, Vitest.

## Global Constraints

- 매매 신호 UI에는 항상 **"투자 참고용, 투자 책임은 본인"** 고지를 표시한다.
- 시크릿(API 키·토큰)은 코드/커밋에 넣지 않는다. `.env`(워커) + Tauri secure store로만. `.env`와 `data/`는 `.gitignore`.
- SQLite는 항상 WAL 모드(`journal_mode = WAL`). 쓰기는 워커만, UI는 읽기 전용.
- 모든 외부 호출(시세·뉴스·LLM)은 실패해도 워커 전체가 죽지 않게 종목/소스 단위 try-catch + 로그.
- 시세 timestamp(`ts`)는 항상 epoch milliseconds(UTC). 통화는 `market`으로 구분(US=USD, KR=KRW), UI에서 포맷.
- 각 Phase 종료 = 동작·테스트되는 슬라이스 + commit.

---

## 전체 로드맵 (Phase 개요)

| Phase | 목표 | 핵심 산출물 | 완료 기준 |
|---|---|---|---|
| **0. 골격** | Tauri+Next+SQLite 부팅 | 앱 셸, DB 스키마, 더미 카드 | 앱창이 SQLite의 더미 시세 1행을 카드로 표시 |
| **1. 미국 수직 슬라이스** | 실제 시세 수집→표시 | Node 워커, Finnhub 클라이언트, 10분 cron, 대시보드 | 워치리스트 5종목 실시세가 10분마다 갱신되어 카드에 뜸 |
| **2. Claude 분석** | 뉴스→영향·신호·근거 | 뉴스 수집(미국 RSS), Claude OAuth, 분석 엔진, 신호 카드 | 종목별 매수/매도 신호+근거가 카드에 표시(참고 고지 포함) |
| **3. 한국 시장** | KR 시세·뉴스 | KIS OpenAPI 클라이언트, 한국 뉴스 스크래핑 | 한국 종목이 미국과 동일 파이프라인으로 카드에 표시 |
| **4. 공급망·발굴** | 다단계 공급망 + 자동 종목 발굴 | Claude 공급망 추론, 발굴 큐, 관계 그래프 | 뉴스에서 워치리스트 밖 종목 발굴 + 공급망 N-depth 카드 |
| **5. 알림** | 데스크톱 + Telegram | Tauri notification, Telegram 봇 발송 | 신호 발생 시 OS 알림 + Telegram 메시지 도착 |
| **6. 미니 위젯 + 백테스트** | 항상 떠있는 미니창 + 간단 백테스트 | always-on-top 미니 윈도우, 백테스트 계산 | 미니 위젯에 핵심 신호 요약 + 과거 N일 가상 수익률 표시 |

> Phase 2~6은 이 문서에 개요만 있다. 각 Phase 도달 시 `writing-plans`로 그 Phase의 상세 bite-sized plan을 별도 작성한다(이전 Phase 학습 반영 + YAGNI).

---

## Phase 0 — 프로젝트 골격

### Task 0.1: Tauri + Next.js 정적 export 스캐폴드

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`, `.gitignore`
- Create: `src-tauri/` (Tauri init 생성물)

**Interfaces:**
- Produces: `npm run dev`(Next 개발 서버), `npm run build`(→ `out/` 정적 export), `npm run tauri dev`(데스크톱 셸).

- [ ] **Step 1: Next.js 앱 스캐폴드 (수동, 최소 구성)**

```bash
npm init -y
npm install next@latest react@latest react-dom@latest
npm install -D typescript @types/react @types/node @types/react-dom tailwindcss @tailwindcss/postcss
```

- [ ] **Step 2: 설정 파일 작성**

`next.config.ts`:
```ts
import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  output: 'export',                 // Tauri는 정적 파일만 싣는다
  images: { unoptimized: true },    // 정적 export는 next/image 최적화 불가
}
export default nextConfig
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true, "skipLibCheck": true, "strict": true, "noEmit": true,
    "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve",
    "incremental": true, "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "src-tauri", "worker"]
}
```

`postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`.gitignore`:
```
node_modules/
.next/
out/
data/
.env
src-tauri/target/
*.db
*.db-wal
*.db-shm
.DS_Store
```

- [ ] **Step 3: 최소 페이지 + 스타일**

`app/globals.css`:
```css
@import "tailwindcss";
body { background: #0a0a0a; color: #ededed; font-family: system-ui, sans-serif; }
```

`app/layout.tsx`:
```tsx
import './globals.css'
export const metadata = { title: 'Stock Insight' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return <main className="p-6"><h1 className="text-xl font-semibold">Stock Insight</h1></main>
}
```

- [ ] **Step 4: 정적 export 동작 확인**

Run: `npm run build` (package.json scripts에 `"build": "next build"` 추가 후)
Expected: `out/index.html` 생성, 에러 없음.

- [ ] **Step 5: Tauri v2 초기화**

```bash
npm install -D @tauri-apps/cli@latest
npm install @tauri-apps/api@latest
npx tauri init --frontend-dist ../out --dev-url http://localhost:3000 \
  --before-dev-command "npm run dev" --before-build-command "npm run build" --app-name "Stock Insight" --window-title "Stock Insight" --yes
```

- [ ] **Step 6: package.json scripts 정리**

`package.json`의 `"scripts"`:
```json
{
  "dev": "next dev",
  "build": "next build",
  "tauri": "tauri",
  "worker": "tsx watch worker/index.ts",
  "test": "vitest run"
}
```

- [ ] **Step 7: 데스크톱 셸 부팅 확인**

Run: `npm run tauri dev`
Expected: 네이티브 창이 열리고 "Stock Insight" 헤더가 보인다.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + Next.js static export shell"
```

---

### Task 0.2: SQLite 스키마 + tauri-plugin-sql 읽기 경로

**Files:**
- Create: `worker/db.ts` (스키마 + 쓰기 헬퍼), `worker/db.test.ts`
- Create: `lib/db.ts` (프론트 읽기)
- Modify: `src-tauri/src/lib.rs` (또는 `main.rs`) — `tauri-plugin-sql` 등록
- Modify: `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`
- Modify: `app/page.tsx` (더미 카드 표시)

**Interfaces:**
- Produces: `openDb(path) -> Database`, `upsertQuote(db, quote, market)`, `latestQuotes(db) -> QuoteRow[]` (worker/db.ts); `getLatestQuotes() -> Promise<QuoteRow[]>` (lib/db.ts).
- Produces 타입:
```ts
export interface Quote { symbol: string; price: number; prevClose: number; changePct: number; ts: number }
export interface QuoteRow { symbol: string; market: string; price: number; prev_close: number; change_pct: number; ts: number }
```

- [ ] **Step 1: 워커 의존성 설치**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3 tsx vitest
```

- [ ] **Step 2: DB 헬퍼 실패 테스트 작성**

`worker/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { openDb, upsertQuote, latestQuotes } from './db'

describe('quotes db', () => {
  it('upsert 후 latestQuotes가 최신 ts 행만 반환', () => {
    const db = openDb(':memory:')
    upsertQuote(db, { symbol: 'AAPL', price: 100, prevClose: 99, changePct: 1.01, ts: 1000 }, 'US')
    upsertQuote(db, { symbol: 'AAPL', price: 105, prevClose: 99, changePct: 6.06, ts: 2000 }, 'US')
    const rows = latestQuotes(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].price).toBe(105)
    expect(rows[0].market).toBe('US')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run worker/db.test.ts`
Expected: FAIL — `openDb` 등 미정의.

- [ ] **Step 4: DB 헬퍼 구현**

`worker/db.ts`:
```ts
import Database from 'better-sqlite3'

export interface Quote { symbol: string; price: number; prevClose: number; changePct: number; ts: number }
export interface QuoteRow { symbol: string; market: string; price: number; prev_close: number; change_pct: number; ts: number }

export function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL') // ponytail: WAL → 워커 쓰기 중 UI 읽기 가능. 단일 writer 가정
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY, market TEXT NOT NULL, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      symbol TEXT NOT NULL, market TEXT NOT NULL, price REAL NOT NULL,
      prev_close REAL, change_pct REAL, ts INTEGER NOT NULL,
      PRIMARY KEY (symbol, ts)
    );
  `)
  return db
}

export function upsertQuote(db: Database.Database, q: Quote, market: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO quotes (symbol, market, price, prev_close, change_pct, ts)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(q.symbol, market, q.price, q.prevClose, q.changePct, q.ts)
}

export function latestQuotes(db: Database.Database): QuoteRow[] {
  return db.prepare(
    `SELECT q.symbol, q.market, q.price, q.prev_close, q.change_pct, q.ts
     FROM quotes q
     JOIN (SELECT symbol, MAX(ts) AS ts FROM quotes GROUP BY symbol) m
       ON q.symbol = m.symbol AND q.ts = m.ts`
  ).all() as QuoteRow[]
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run worker/db.test.ts`
Expected: PASS.

- [ ] **Step 6: 더미 데이터 시드 스크립트로 dev DB 생성**

`worker/seed.ts`:
```ts
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openDb, upsertQuote } from './db'

const dbPath = resolve(process.cwd(), 'data/app.db')
mkdirSync(resolve(process.cwd(), 'data'), { recursive: true })
const db = openDb(dbPath)
db.prepare(`INSERT OR REPLACE INTO watchlist (symbol, market, name) VALUES (?,?,?)`)
  .run('AAPL', 'US', 'Apple')
upsertQuote(db, { symbol: 'AAPL', price: 212.34, prevClose: 210.0, changePct: 1.11, ts: 1735603200000 }, 'US')
db.close()
console.log('seeded data/app.db')
```

Run: `npx tsx worker/seed.ts`
Expected: `data/app.db` 생성, "seeded" 로그.

- [ ] **Step 7: Rust에 tauri-plugin-sql 등록**

`src-tauri/Cargo.toml` `[dependencies]`에 추가:
```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

`src-tauri/src/lib.rs`의 `run()`에서 builder에 플러그인 추가:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

- [ ] **Step 8: SQL 플러그인 권한 부여**

`src-tauri/capabilities/default.json`의 `permissions` 배열에 추가:
```json
"sql:default",
"sql:allow-load",
"sql:allow-select"
```

- [ ] **Step 9: 프론트 읽기 헬퍼 + JS 의존성**

```bash
npm install @tauri-apps/plugin-sql
```

`lib/db.ts`:
```ts
import Database from '@tauri-apps/plugin-sql'
import type { QuoteRow } from '@/worker/db'

// ponytail: dev에선 repo의 data/app.db를 절대경로로 로드. 번들 배포 시 앱 데이터 디렉터리로 교체(Phase 1 Task 1.3에서 정리).
const DB_URL = `sqlite:${process.env.NEXT_PUBLIC_DB_PATH ?? 'app.db'}`

export async function getLatestQuotes(): Promise<QuoteRow[]> {
  const db = await Database.load(DB_URL)
  return db.select<QuoteRow[]>(
    `SELECT q.symbol, q.market, q.price, q.prev_close, q.change_pct, q.ts
     FROM quotes q
     JOIN (SELECT symbol, MAX(ts) AS ts FROM quotes GROUP BY symbol) m
       ON q.symbol = m.symbol AND q.ts = m.ts`
  )
}
```

> 경로 정렬 주의: `tauri-plugin-sql`의 `sqlite:app.db`는 앱 config 디렉터리를 기준으로 한다. dev에서 워커가 쓰는 `data/app.db`와 같은 파일을 보게 하려면 `NEXT_PUBLIC_DB_PATH`에 절대경로를 주거나 워커 `DB_PATH`를 앱 config 디렉터리로 맞춘다. dev 기본은 절대경로 사용.

- [ ] **Step 10: 더미 카드 표시**

`app/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { getLatestQuotes } from '@/lib/db'
import type { QuoteRow } from '@/worker/db'

export default function Home() {
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [err, setErr] = useState<string>()
  useEffect(() => { getLatestQuotes().then(setQuotes).catch(e => setErr(String(e))) }, [])
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">Stock Insight</h1>
      {err && <p className="text-red-400">DB 오류: {err}</p>}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        {quotes.map(q => (
          <article key={q.symbol} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="text-lg font-semibold">{q.symbol}</h2>
            <p className="text-2xl tabular-nums">{q.price.toFixed(2)}</p>
            <p className={q.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {q.change_pct >= 0 ? '▲' : '▼'} {q.change_pct.toFixed(2)}%
            </p>
          </article>
        ))}
      </div>
      <p className="mt-6 text-xs text-neutral-500">투자 참고용입니다. 투자 책임은 본인에게 있습니다.</p>
    </main>
  )
}
```

- [ ] **Step 11: 더미 카드 표시 확인**

Run: `NEXT_PUBLIC_DB_PATH="$(pwd)/data/app.db" npm run tauri dev`
Expected: 창에 AAPL 카드(212.34, ▲1.11%)가 보인다.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: SQLite schema + tauri-plugin-sql read path, dummy quote card"
```

---

## Phase 1 — 미국 워치리스트 수직 슬라이스

### Task 1.1: Finnhub 시세 클라이언트 (순수 파서 TDD)

**Files:**
- Create: `worker/sources/finnhub.ts`, `worker/sources/finnhub.test.ts`

**Interfaces:**
- Consumes: `Quote` (worker/db.ts).
- Produces: `parseFinnhubQuote(symbol, raw, now) -> Quote`, `fetchQuote(symbol, token, now) -> Promise<Quote>`.

- [ ] **Step 1: 파서 실패 테스트 작성**

`worker/sources/finnhub.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseFinnhubQuote } from './finnhub'

describe('parseFinnhubQuote', () => {
  it('정상 응답을 Quote로 변환', () => {
    const raw = { c: 212.34, d: 2.34, dp: 1.11, pc: 210.0 }
    const q = parseFinnhubQuote('AAPL', raw, 1735603200000)
    expect(q).toEqual({ symbol: 'AAPL', price: 212.34, prevClose: 210.0, changePct: 1.11, ts: 1735603200000 })
  })
  it('현재가 0(휴장/오류)이면 throw', () => {
    expect(() => parseFinnhubQuote('AAPL', { c: 0, pc: 0, dp: 0 }, 1)).toThrow()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run worker/sources/finnhub.test.ts`
Expected: FAIL — `parseFinnhubQuote` 미정의.

- [ ] **Step 3: 클라이언트 구현**

`worker/sources/finnhub.ts`:
```ts
import type { Quote } from '../db'

export function parseFinnhubQuote(symbol: string, raw: unknown, now: number): Quote {
  const r = raw as { c?: number; pc?: number; dp?: number }
  if (typeof r?.c !== 'number' || r.c === 0) {
    throw new Error(`invalid Finnhub quote for ${symbol}`)
  }
  return { symbol, price: r.c, prevClose: r.pc ?? r.c, changePct: r.dp ?? 0, ts: now }
}

export async function fetchQuote(symbol: string, token: string, now: number): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub ${res.status} for ${symbol}`)
  return parseFinnhubQuote(symbol, await res.json(), now)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run worker/sources/finnhub.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/sources/finnhub.ts worker/sources/finnhub.test.ts
git commit -m "feat: Finnhub quote client with tested parser"
```

---

### Task 1.2: 워커 config + 10분 cron 수집 루프

**Files:**
- Create: `worker/config.ts`, `worker/index.ts`, `.env.example`
- Modify: `worker/seed.ts` (워치리스트 5종목 시드로 확장)

**Interfaces:**
- Consumes: `openDb`, `upsertQuote` (worker/db.ts), `fetchQuote` (worker/sources/finnhub.ts).
- Produces: `collectUS()` (수집 1회 실행), `WATCHLIST`, `DB_PATH`, `FINNHUB_TOKEN` (config).

- [ ] **Step 1: 의존성 + env 템플릿**

```bash
npm install node-cron dotenv
npm install -D @types/node-cron
```

`.env.example`:
```
FINNHUB_TOKEN=your_finnhub_free_token
DB_PATH=./data/app.db
```

- [ ] **Step 2: config 작성**

`worker/config.ts`:
```ts
import 'dotenv/config'
import { resolve } from 'node:path'

export const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), 'data/app.db')
export const FINNHUB_TOKEN = process.env.FINNHUB_TOKEN ?? ''

export const WATCHLIST = [
  { symbol: 'AAPL', market: 'US', name: 'Apple' },
  { symbol: 'MSFT', market: 'US', name: 'Microsoft' },
  { symbol: 'NVDA', market: 'US', name: 'NVIDIA' },
  { symbol: 'TSLA', market: 'US', name: 'Tesla' },
  { symbol: 'AMZN', market: 'US', name: 'Amazon' },
] as const
```

- [ ] **Step 3: 수집 루프 테스트 작성 (fetch 모킹)**

`worker/index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./config', () => ({
  DB_PATH: ':memory:',
  FINNHUB_TOKEN: 'test',
  WATCHLIST: [{ symbol: 'AAPL', market: 'US', name: 'Apple' }],
}))

describe('collectUS', () => {
  beforeEach(() => vi.restoreAllMocks())
  it('한 종목 실패해도 throw하지 않고 수집한 것만 저장', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ c: 200, pc: 198, dp: 1.01 }),
    }) as unknown as typeof fetch
    const { collectUS } = await import('./index')
    const rows = await collectUS()
    expect(rows.length).toBe(1)
    expect(rows[0].price).toBe(200)
  })
})
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run worker/index.test.ts`
Expected: FAIL — `collectUS` 미정의.

- [ ] **Step 5: 워커 엔트리 구현**

`worker/index.ts`:
```ts
import cron from 'node-cron'
import { openDb, upsertQuote, latestQuotes, type QuoteRow } from './db'
import { fetchQuote } from './sources/finnhub'
import { DB_PATH, FINNHUB_TOKEN, WATCHLIST } from './config'

export async function collectUS(): Promise<QuoteRow[]> {
  const db = openDb(DB_PATH)
  const now = Date.now()
  for (const item of WATCHLIST.filter(w => w.market === 'US')) {
    try {
      const q = await fetchQuote(item.symbol, FINNHUB_TOKEN, now)
      upsertQuote(db, q, 'US')
      console.log(`[collect] ${item.symbol} ${q.price}`)
    } catch (e) {
      console.error(`[collect] ${item.symbol} failed: ${(e as Error).message}`)
    }
  }
  const rows = latestQuotes(db)
  db.close()
  return rows
}

// 직접 실행 시에만 스케줄 시작 (테스트 import 시엔 시작 안 함)
if (process.argv[1]?.includes('worker/index')) {
  if (!FINNHUB_TOKEN) console.warn('[worker] FINNHUB_TOKEN 미설정 — 미국 수집 실패함')
  collectUS()
  cron.schedule('*/10 * * * *', collectUS)
  console.log('[worker] started — 10분마다 수집')
}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run worker/index.test.ts`
Expected: PASS.

- [ ] **Step 7: 실 토큰으로 수동 수집 확인**

`.env`에 실제 `FINNHUB_TOKEN` 설정 후:
Run: `npx tsx worker/index.ts` (몇 초 후 Ctrl+C)
Expected: `[collect] AAPL <실가격>` 등 5줄, `data/app.db`에 저장됨.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: worker collect loop with 10min cron and fault isolation"
```

---

### Task 1.3: 대시보드 자동 갱신 + dev 실행 정리

**Files:**
- Modify: `app/page.tsx` (30초 폴링 + 마지막 갱신 시각)
- Create: `README.md` (dev 실행법: 워커 + Tauri 동시 기동, DB 경로 정렬)

**Interfaces:**
- Consumes: `getLatestQuotes` (lib/db.ts).

- [ ] **Step 1: 대시보드 폴링 추가**

`app/page.tsx`의 `useEffect`를 교체:
```tsx
useEffect(() => {
  const load = () => getLatestQuotes().then(setQuotes).catch(e => setErr(String(e)))
  load()
  const id = setInterval(load, 30_000) // ponytail: 30초 폴링. 실시간 푸시는 YAGNI, 10분 수집 주기엔 과함
  return () => clearInterval(id)
}, [])
```

그리고 마지막 갱신 시각 표시(가장 큰 `ts`):
```tsx
{quotes.length > 0 && (
  <p className="text-xs text-neutral-500 mb-2">
    마지막 갱신: {new Date(Math.max(...quotes.map(q => q.ts))).toLocaleTimeString('ko-KR')}
  </p>
)}
```

- [ ] **Step 2: README에 dev 실행법 기록**

`README.md`:
```md
# Stock Insight

개인용 주식 신호 데스크톱 위젯 (Tauri + Next.js).

## Dev 실행

1. `.env` 작성 (`.env.example` 참고, `FINNHUB_TOKEN` 필수)
2. 워커 기동(별도 터미널): `npm run worker`
3. 앱 기동: `NEXT_PUBLIC_DB_PATH="$(pwd)/data/app.db" npm run tauri dev`

워커와 앱은 같은 `data/app.db`를 본다(워커=쓰기, 앱=읽기, WAL 모드).
```

- [ ] **Step 3: 통합 확인**

워커 실행 중인 상태에서 앱 기동.
Expected: 5종목 카드가 실시세로 표시, "마지막 갱신" 시각 갱신, 30초마다 재조회.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dashboard polling + dev run docs"
```

---

## Phase 2~6 (개요 — 도달 시 상세 plan 작성)

### Phase 2 — Claude 분석 엔진
- `worker/sources/news.ts`: 미국 뉴스 RSS(예: 종목별 Finnhub `/company-news` 또는 공개 RSS) 수집 → `news` 테이블.
- Claude **구독 OAuth**: Anthropic SDK OAuth 흐름으로 앱 시작 시 인증, 토큰은 Tauri secure store(`tauri-plugin-store` 또는 stronghold)에 저장.
- `worker/analyze.ts`: 종목+최근 뉴스를 Claude에 보내 `{영향도, 매수/매도 신호, 근거, 신뢰도}` 구조화 출력(JSON 스키마 강제) → `signals` 테이블.
- 카드에 신호 배지(매수/매도/관망) + 근거 토글 + 신뢰도. "참고용" 고지 유지.
- 호출량 제어: 워치리스트만 매 주기, 뉴스 없으면 분석 skip.

### Phase 3 — 한국 시장
- `worker/sources/kis.ts`: 한국투자증권 OpenAPI(앱키/시크릿 → 토큰 발급 → 시세). 통화 KRW.
- `worker/sources/news_kr.ts`: 한국 뉴스 스크래핑(폴백). 차단/구조변경 대비 셀렉터 격리.
- 워치리스트에 KR 종목 추가, 동일 파이프라인 합류.

### Phase 4 — 공급망 + 자동 발굴
- `worker/supplychain.ts`: Claude로 영향 기업의 공급망 N-depth 추론(근거 포함) → `companies` + `supply_links`(그래프).
- 발굴 큐: 뉴스에서 워치리스트 밖 종목 등장 시 후보 등록 → 저빈도 분석.
- UI: 관계 그래프/리스트 뷰. ponytail: 1차는 depth 1~2 제한, 비용 가드.

### Phase 5 — 알림
- `tauri-plugin-notification`: 신규 강신호 발생 시 OS 알림.
- `worker/telegram.ts`: Telegram **Bot API** 직접 호출(MCP 아님)로 신호 메시지 발송. 봇 토큰/chat_id는 `.env`.
- 알림 중복 억제(같은 신호 1회).

### Phase 6 — 미니 위젯 + 백테스트
- Tauri 2번째 윈도우(always-on-top, 작은 사이즈): 핵심 신호 요약만.
- `worker/backtest.ts`: 과거 N일 신호대로 가상 매매 시 수익률 간단 계산(저장된 quotes/signals 기반). UI에 요약 표시.

---

## Self-Review

- **Spec coverage:** 미국+한국(P1,P3) / 하이브리드 분석=LLM+지표(P2) / 영향·공급망 다단계(P4) / 매수·매도 신호(P2) / 자동 발굴(P4) / 알림 데스크톱+Telegram(P5) / Tauri+Next(P0) / 10분 수집(P1) / 미니위젯+대시보드(P0,P6) / 백테스트(P6) / Claude OAuth(P2) — 모두 Phase에 매핑됨.
- **Placeholder scan:** Phase 0~1은 실제 코드/명령/기대결과 포함, 플레이스홀더 없음. Phase 2~6은 의도적으로 개요만(별도 상세 plan 예정) — 실행 태스크로 위장하지 않음.
- **Type consistency:** `Quote`(worker 내부)와 `QuoteRow`(DB row, snake_case) 구분 일관. `latestQuotes`/`getLatestQuotes` 동일 SQL. `collectUS` 시그니처 일관.

## Execution Handoff

다음 단계는 실행 방식 선택 후 Phase 0부터 단계별 commit.
