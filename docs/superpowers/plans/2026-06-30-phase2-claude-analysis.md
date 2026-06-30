# Phase 2 — Claude 분석 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans로 task별 실행. 스텝은 체크박스(`- [ ]`).
> 선행: Phase 0~1 완료(`docs/superpowers/plans/2026-06-30-stock-insight.md`). 미국 워치리스트 시세가 SQLite→대시보드로 흐르는 상태에서 시작.

**Goal:** 미국 워치리스트 종목의 뉴스를 10분마다 수집하고, Claude(하이브리드: LLM 추론 + 시세 컨텍스트)로 매수/매도 신호·근거·영향(공급망 1-depth) 기업을 생성해 대시보드 카드에 표시한다.

**Architecture:** 워커가 Finnhub `/company-news`로 종목별 최근 뉴스를 수집(`news` 테이블) → 새 뉴스가 있는 종목만 Claude `messages.parse()`로 구조화 분석(`signals` 테이블) → UI가 `tauri-plugin-sql`로 신호를 읽어 카드에 배지+근거+신뢰도 표시. Claude는 `ant auth login` 구독 OAuth로 인증(워커는 zero-arg `new Anthropic()`).

**Tech Stack:** `@anthropic-ai/sdk`(`messages.parse` + `zodOutputFormat`), `zod`, 모델 `claude-opus-4-8`(adaptive thinking, effort medium), Finnhub company-news, 기존 `better-sqlite3`/Vitest 스택.

## Global Constraints

- Phase 0~1의 Global Constraints 모두 승계(참고 고지, 시크릿 비커밋, WAL, 소스별 try-catch, ts=epoch ms).
- **인증:** Anthropic은 `ant auth login`(OAuth 구독 프로필)로만. 워커 코드에 API 키를 넣지 않는다. `ant auth status`로 활성 프로필 확인. `ANTHROPIC_API_KEY`는 설정하지 않는다(설정 시 프로필을 가린다).
- **모델 호출 규칙(claude-api 스킬 권위):** 모델 `claude-opus-4-8`, `thinking: {type: "adaptive"}`, `output_config: {effort: "medium"}`. `budget_tokens`·`temperature`·`top_p`는 보내지 않는다(400). 구조화 출력은 `output_config.format`(= `zodOutputFormat`)로, `output_format`(구) 금지.
- **비용 가드:** 매 주기 전 종목을 분석하지 않는다. **마지막 분석 이후 새 뉴스가 있는 종목만** 분석한다(`signals.ts` < 최신 `news.datetime`). 호출 폭증 방지.
- 분석 결과의 매매 신호는 항상 "참고용"으로 표기(UI 고지 유지).

## File Structure

| 파일 | 책임 |
|---|---|
| `worker/sources/companyNews.ts` | Finnhub company-news 클라이언트 + 순수 파서 |
| `worker/sources/companyNews.test.ts` | 파서 테스트 |
| `worker/db.ts` (수정) | `news`·`signals` 테이블 + upsert/조회 헬퍼 추가 |
| `worker/db.test.ts` (수정) | news/signals 헬퍼 테스트 |
| `worker/analyze.ts` | 프롬프트 빌더(순수) + Claude 분석 호출(`analyzeSymbol`) |
| `worker/analyze.test.ts` | 프롬프트 빌더 테스트 + Claude 클라이언트 모킹 분석 테스트 |
| `worker/index.ts` (수정) | 수집 루프에 뉴스 수집 + 조건부 분석 추가 |
| `lib/db.ts` (수정) | `getLatestSignals()` 추가 |
| `app/page.tsx` (수정) | 카드에 신호 배지 + 근거 토글 + 신뢰도 + 영향 기업 |
| `.env.example` (수정) | 변경 없음(Finnhub만, Claude는 OAuth) — 주석으로 `ant auth login` 안내 |

---

## Task 2.1: Finnhub company-news 클라이언트 (순수 파서 TDD)

**Files:**
- Create: `worker/sources/companyNews.ts`, `worker/sources/companyNews.test.ts`

**Interfaces:**
- Produces:
```ts
export interface NewsItem { id: string; symbol: string; headline: string; summary: string; url: string; source: string; datetime: number }
export function parseCompanyNews(symbol: string, raw: unknown): NewsItem[]
export function fetchCompanyNews(symbol: string, token: string, fromISO: string, toISO: string): Promise<NewsItem[]>
```

- [ ] **Step 1: 파서 실패 테스트 작성**

`worker/sources/companyNews.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseCompanyNews } from './companyNews'

describe('parseCompanyNews', () => {
  it('Finnhub 배열을 NewsItem[]로 변환(ms 단위 datetime)', () => {
    const raw = [
      { id: 111, headline: 'Apple beats', summary: 's1', url: 'u1', source: 'Reuters', datetime: 1735603200 },
      { id: 222, headline: 'Apple sues', summary: 's2', url: 'u2', source: 'CNBC', datetime: 1735606800 },
    ]
    const items = parseCompanyNews('AAPL', raw)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      id: 'AAPL:111', symbol: 'AAPL', headline: 'Apple beats', summary: 's1',
      url: 'u1', source: 'Reuters', datetime: 1735603200000,
    })
  })
  it('배열 아니면 빈 배열', () => {
    expect(parseCompanyNews('AAPL', { error: 'x' })).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run worker/sources/companyNews.test.ts`
Expected: FAIL — `parseCompanyNews` 미정의.

- [ ] **Step 3: 클라이언트 구현**

`worker/sources/companyNews.ts`:
```ts
export interface NewsItem {
  id: string
  symbol: string
  headline: string
  summary: string
  url: string
  source: string
  datetime: number
}

export function parseCompanyNews(symbol: string, raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((n) => n && typeof n.headline === 'string' && typeof n.datetime === 'number')
    .map((n) => ({
      id: `${symbol}:${n.id}`,
      symbol,
      headline: n.headline,
      summary: typeof n.summary === 'string' ? n.summary : '',
      url: typeof n.url === 'string' ? n.url : '',
      source: typeof n.source === 'string' ? n.source : '',
      datetime: n.datetime * 1000, // Finnhub는 초 단위 → ms로 통일
    }))
}

export async function fetchCompanyNews(
  symbol: string,
  token: string,
  fromISO: string,
  toISO: string,
): Promise<NewsItem[]> {
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromISO}&to=${toISO}&token=${token}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub company-news ${res.status} for ${symbol}`)
  return parseCompanyNews(symbol, await res.json())
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run worker/sources/companyNews.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/sources/companyNews.ts worker/sources/companyNews.test.ts
git commit -m "feat: Finnhub company-news client with tested parser"
```

---

## Task 2.2: news + signals 테이블/헬퍼 (TDD)

**Files:**
- Modify: `worker/db.ts`, `worker/db.test.ts`

**Interfaces:**
- Consumes: `NewsItem` (companyNews.ts).
- Produces 타입 + 함수:
```ts
export interface Signal { symbol: string; market: string; signal: 'buy' | 'sell' | 'hold'; confidence: number; rationale: string; affected: AffectedCompany[]; ts: number }
export interface AffectedCompany { name: string; ticker?: string; relation: string }
export interface SignalRow { symbol: string; market: string; signal: string; confidence: number; rationale: string; affected: string; ts: number } // affected=JSON 문자열

export function upsertNews(db, items: NewsItem[]): number  // 새로 삽입된 개수
export function latestNewsTs(db, symbol: string): number   // 해당 종목 최신 news.datetime, 없으면 0
export function symbolsWithFreshNews(db): string[]          // 최신 뉴스 > 마지막 신호 ts 인 종목
export function recentNews(db, symbol: string, limit: number): NewsItem[]
export function upsertSignal(db, s: Signal): void
export function latestSignals(db): SignalRow[]
```

- [ ] **Step 1: 실패 테스트 작성 (db.test.ts에 추가)**

`worker/db.test.ts`에 append:
```ts
import { upsertNews, latestNewsTs, symbolsWithFreshNews, recentNews, upsertSignal, latestSignals } from './db'

describe('news + signals', () => {
  it('upsertNews는 중복 id를 무시하고 새 개수만 반환', () => {
    const db = openDb(':memory:')
    const items = [
      { id: 'AAPL:1', symbol: 'AAPL', headline: 'h1', summary: '', url: '', source: 'R', datetime: 1000 },
      { id: 'AAPL:2', symbol: 'AAPL', headline: 'h2', summary: '', url: '', source: 'R', datetime: 2000 },
    ]
    expect(upsertNews(db, items)).toBe(2)
    expect(upsertNews(db, items)).toBe(0) // 중복
    expect(latestNewsTs(db, 'AAPL')).toBe(2000)
    expect(recentNews(db, 'AAPL', 10)).toHaveLength(2)
  })

  it('symbolsWithFreshNews: 신호보다 새 뉴스가 있는 종목만', () => {
    const db = openDb(':memory:')
    upsertNews(db, [{ id: 'AAPL:1', symbol: 'AAPL', headline: 'h', summary: '', url: '', source: 'R', datetime: 5000 }])
    // 신호 없음 → 후보
    expect(symbolsWithFreshNews(db)).toContain('AAPL')
    upsertSignal(db, { symbol: 'AAPL', market: 'US', signal: 'buy', confidence: 0.8, rationale: 'r', affected: [], ts: 6000 })
    // 신호 ts(6000) > 뉴스(5000) → 더 이상 후보 아님
    expect(symbolsWithFreshNews(db)).not.toContain('AAPL')
  })

  it('latestSignals: affected를 JSON 문자열로 저장', () => {
    const db = openDb(':memory:')
    upsertSignal(db, {
      symbol: 'AAPL', market: 'US', signal: 'sell', confidence: 0.6, rationale: 'why',
      affected: [{ name: 'Foxconn', ticker: '2317.TW', relation: '공급사' }], ts: 7000,
    })
    const rows = latestSignals(db)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].affected)[0].name).toBe('Foxconn')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run worker/db.test.ts`
Expected: FAIL — 신규 함수 미정의.

- [ ] **Step 3: db.ts에 스키마 + 헬퍼 추가**

`worker/db.ts`의 `openDb` 안 `db.exec(...)`에 테이블 추가:
```ts
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, headline TEXT NOT NULL,
      summary TEXT, url TEXT, source TEXT, datetime INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signals (
      symbol TEXT NOT NULL, market TEXT NOT NULL, signal TEXT NOT NULL,
      confidence REAL NOT NULL, rationale TEXT NOT NULL, affected TEXT NOT NULL,
      ts INTEGER NOT NULL, PRIMARY KEY (symbol, ts)
    );
```

`worker/db.ts` 하단에 타입 + 함수 추가:
```ts
import type { NewsItem } from './sources/companyNews'

export interface AffectedCompany { name: string; ticker?: string; relation: string }
export interface Signal {
  symbol: string
  market: string
  signal: 'buy' | 'sell' | 'hold'
  confidence: number
  rationale: string
  affected: AffectedCompany[]
  ts: number
}
export interface SignalRow {
  symbol: string; market: string; signal: string; confidence: number
  rationale: string; affected: string; ts: number
}

export function upsertNews(db: Database.Database, items: NewsItem[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO news (id, symbol, headline, summary, url, source, datetime)
     VALUES (@id, @symbol, @headline, @summary, @url, @source, @datetime)`,
  )
  let inserted = 0
  for (const n of items) inserted += stmt.run(n).changes
  return inserted
}

export function latestNewsTs(db: Database.Database, symbol: string): number {
  const row = db.prepare(`SELECT MAX(datetime) AS ts FROM news WHERE symbol = ?`).get(symbol) as { ts: number | null }
  return row.ts ?? 0
}

export function symbolsWithFreshNews(db: Database.Database): string[] {
  // 종목별 최신 뉴스 datetime > 최신 신호 ts(없으면 0)
  const rows = db
    .prepare(
      `SELECT n.symbol AS symbol
       FROM (SELECT symbol, MAX(datetime) AS news_ts FROM news GROUP BY symbol) n
       LEFT JOIN (SELECT symbol, MAX(ts) AS sig_ts FROM signals GROUP BY symbol) s
         ON n.symbol = s.symbol
       WHERE n.news_ts > COALESCE(s.sig_ts, 0)`,
    )
    .all() as { symbol: string }[]
  return rows.map((r) => r.symbol)
}

export function recentNews(db: Database.Database, symbol: string, limit: number): NewsItem[] {
  return db
    .prepare(`SELECT id, symbol, headline, summary, url, source, datetime FROM news WHERE symbol = ? ORDER BY datetime DESC LIMIT ?`)
    .all(symbol, limit) as NewsItem[]
}

export function upsertSignal(db: Database.Database, s: Signal): void {
  db.prepare(
    `INSERT OR REPLACE INTO signals (symbol, market, signal, confidence, rationale, affected, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(s.symbol, s.market, s.signal, s.confidence, s.rationale, JSON.stringify(s.affected), s.ts)
}

export function latestSignals(db: Database.Database): SignalRow[] {
  return db
    .prepare(
      `SELECT g.symbol, g.market, g.signal, g.confidence, g.rationale, g.affected, g.ts
       FROM signals g
       JOIN (SELECT symbol, MAX(ts) AS ts FROM signals GROUP BY symbol) m
         ON g.symbol = m.symbol AND g.ts = m.ts`,
    )
    .all() as SignalRow[]
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run worker/db.test.ts`
Expected: PASS (기존 + 신규 모두).

- [ ] **Step 5: Commit**

```bash
git add worker/db.ts worker/db.test.ts
git commit -m "feat: news + signals tables and query helpers"
```

---

## Task 2.3: Claude 분석 엔진 (프롬프트 빌더 TDD + 모킹 분석)

**Files:**
- Create: `worker/analyze.ts`, `worker/analyze.test.ts`

**Interfaces:**
- Consumes: `NewsItem`, `QuoteRow`, `Signal`, `AffectedCompany` (db.ts).
- Produces:
```ts
export const SignalSchema: z.ZodType  // zod 스키마
export function buildAnalysisPrompt(symbol: string, quote: QuoteRow | undefined, news: NewsItem[]): string
export function analyzeSymbol(client: Anthropic, symbol: string, market: string, quote: QuoteRow | undefined, news: NewsItem[], now: number): Promise<Signal>
```

- [ ] **Step 1: 의존성 설치**

```bash
npm install @anthropic-ai/sdk zod
```

- [ ] **Step 2: 프롬프트 빌더 실패 테스트 작성**

`worker/analyze.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildAnalysisPrompt, analyzeSymbol } from './analyze'

const news = [
  { id: 'AAPL:1', symbol: 'AAPL', headline: 'Apple cuts iPhone orders', summary: 'demand weak', url: 'u', source: 'R', datetime: 1735603200000 },
]
const quote = { symbol: 'AAPL', market: 'US', price: 200, prev_close: 210, change_pct: -4.76, ts: 1735603200000 }

describe('buildAnalysisPrompt', () => {
  it('종목·시세·뉴스 헤드라인을 프롬프트에 포함', () => {
    const p = buildAnalysisPrompt('AAPL', quote, news)
    expect(p).toContain('AAPL')
    expect(p).toContain('Apple cuts iPhone orders')
    expect(p).toContain('-4.76') // 시세 컨텍스트
  })
})

describe('analyzeSymbol', () => {
  it('Claude parsed_output을 Signal로 변환', async () => {
    const fakeClient = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          parsed_output: {
            signal: 'sell',
            confidence: 0.72,
            rationale: '수요 약화 + 4.76% 하락',
            affected: [{ name: 'Foxconn', ticker: '2317.TW', relation: '주요 공급사' }],
          },
        }),
      },
    } as unknown as import('@anthropic-ai/sdk').default
    const sig = await analyzeSymbol(fakeClient, 'AAPL', 'US', quote, news, 1735606800000)
    expect(sig.signal).toBe('sell')
    expect(sig.confidence).toBe(0.72)
    expect(sig.affected[0].name).toBe('Foxconn')
    expect(sig.ts).toBe(1735606800000)
    // 모델 호출 인자 검증: opus-4-8 + adaptive + effort
    const callArg = (fakeClient.messages.parse as any).mock.calls[0][0]
    expect(callArg.model).toBe('claude-opus-4-8')
    expect(callArg.thinking).toEqual({ type: 'adaptive' })
    expect(callArg.output_config.effort).toBe('medium')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run worker/analyze.test.ts`
Expected: FAIL — `analyze.ts` 미정의.

- [ ] **Step 4: analyze.ts 구현**

`worker/analyze.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { NewsItem, QuoteRow, Signal } from './db'

export const SignalSchema = z.object({
  signal: z.enum(['buy', 'sell', 'hold']),
  confidence: z.number(), // 0..1 (구조화 출력은 min/max 미지원 — SDK가 클라이언트 검증)
  rationale: z.string(),
  affected: z.array(
    z.object({
      name: z.string(),
      ticker: z.string().optional(),
      relation: z.string(), // 예: "주요 공급사", "경쟁사", "고객사"
    }),
  ),
})

export function buildAnalysisPrompt(
  symbol: string,
  quote: QuoteRow | undefined,
  news: NewsItem[],
): string {
  const priceLine = quote
    ? `현재가 ${quote.price} (전일대비 ${quote.change_pct}%)`
    : '시세 데이터 없음'
  const headlines = news.map((n) => `- [${n.source}] ${n.headline}: ${n.summary}`).join('\n')
  return [
    `종목: ${symbol}`,
    `시세: ${priceLine}`,
    `최근 뉴스:`,
    headlines || '(없음)',
    '',
    '위 뉴스와 시세를 근거로 이 종목의 매수/매도/관망 신호를 판단하라.',
    '뉴스로 영향받는 공급망/연관 기업(공급사·고객사·경쟁사)을 1단계까지 affected에 포함하라.',
    'confidence는 0~1 사이. rationale은 한국어로 2~3문장.',
    '이것은 투자 참고용 분석이며 단정적 권유가 아니다.',
  ].join('\n')
}

export async function analyzeSymbol(
  client: Anthropic,
  symbol: string,
  market: string,
  quote: QuoteRow | undefined,
  news: NewsItem[],
  now: number,
): Promise<Signal> {
  const res = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: zodOutputFormat(SignalSchema) },
    messages: [{ role: 'user', content: buildAnalysisPrompt(symbol, quote, news) }],
  })
  const out = res.parsed_output
  if (!out) throw new Error(`analysis parse failed for ${symbol}`)
  return {
    symbol,
    market,
    signal: out.signal,
    confidence: out.confidence,
    rationale: out.rationale,
    affected: out.affected,
    ts: now,
  }
}
```

> 참고: `output_config`에 `effort`와 `format`을 함께 둔다(claude-api 스킬: effort는 `output_config` 내부). `messages.parse`는 스키마 검증 후 `parsed_output` 반환.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run worker/analyze.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/analyze.ts worker/analyze.test.ts package.json package-lock.json
git commit -m "feat: Claude analysis engine (structured signal output)"
```

---

## Task 2.4: 워커 루프에 뉴스 수집 + 조건부 분석 통합

**Files:**
- Modify: `worker/index.ts`
- Modify: `.env.example` (주석 안내만)

**Interfaces:**
- Consumes: `fetchCompanyNews`, `upsertNews`, `symbolsWithFreshNews`, `recentNews`, `latestQuotes`, `analyzeSymbol`, `upsertSignal`.
- Produces: `collectAndAnalyze()` (수집→뉴스→조건부 분석 1회 실행).

- [ ] **Step 1: 통합 테스트 작성 (fetch + Claude 모킹)**

`worker/index.test.ts`에 append:
```ts
it('collectAndAnalyze: 새 뉴스가 있는 종목만 분석해 신호 저장', async () => {
  // fetch: quote 1회 + company-news 1회 응답
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes('/quote'))
      return { ok: true, json: async () => ({ c: 200, pc: 210, dp: -4.76 }) } as any
    return { ok: true, json: async () => [
      { id: 9, headline: 'demand weak', summary: 's', url: 'u', source: 'R', datetime: 1735603200 },
    ] } as any
  }) as any
  const fakeClaude = {
    messages: { parse: vi.fn().mockResolvedValue({ parsed_output: { signal: 'sell', confidence: 0.7, rationale: 'r', affected: [] } }) },
  }
  const { collectAndAnalyze } = await import('./index')
  const signals = await collectAndAnalyze(fakeClaude as any)
  expect(signals.length).toBe(1)
  expect(signals[0].signal).toBe('sell')
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run worker/index.test.ts`
Expected: FAIL — `collectAndAnalyze` 미정의.

- [ ] **Step 3: index.ts 확장**

`worker/index.ts` 상단 import 추가:
```ts
import Anthropic from '@anthropic-ai/sdk'
import { fetchCompanyNews } from './sources/companyNews'
import {
  upsertNews, symbolsWithFreshNews, recentNews, latestQuotes,
  upsertSignal, type Signal,
} from './db'
import { analyzeSymbol } from './analyze'
```

`collectUS` 아래에 추가:
```ts
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export async function collectAndAnalyze(client: Anthropic): Promise<Signal[]> {
  const db = openDb(DB_PATH)
  const now = Date.now()
  const from = isoDate(now - 7 * 24 * 60 * 60 * 1000) // 최근 7일 뉴스
  const to = isoDate(now)

  // 1) 시세 (collectUS와 동일 경로 — 여기선 뉴스+분석에 집중)
  for (const item of WATCHLIST.filter((w) => w.market === 'US')) {
    try {
      const news = await fetchCompanyNews(item.symbol, FINNHUB_TOKEN, from, to)
      const n = upsertNews(db, news)
      if (n > 0) console.log(`[news] ${item.symbol} +${n}`)
    } catch (e) {
      console.error(`[news] ${item.symbol} failed: ${(e as Error).message}`)
    }
  }

  // 2) 새 뉴스가 있는 종목만 분석 (비용 가드)
  const quotes = latestQuotes(db)
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]))
  const out: Signal[] = []
  for (const symbol of symbolsWithFreshNews(db)) {
    const market = WATCHLIST.find((w) => w.symbol === symbol)?.market ?? 'US'
    try {
      const sig = await analyzeSymbol(
        client, symbol, market, quoteBySymbol.get(symbol),
        recentNews(db, symbol, 10), Date.now(),
      )
      upsertSignal(db, sig)
      out.push(sig)
      console.log(`[signal] ${symbol} ${sig.signal} (${sig.confidence})`)
    } catch (e) {
      console.error(`[signal] ${symbol} failed: ${(e as Error).message}`)
    }
  }
  db.close()
  return out
}
```

`worker/index.ts`의 실행 가드 블록을 교체:
```ts
if (process.argv[1]?.includes('worker/index')) {
  if (!FINNHUB_TOKEN) console.warn('[worker] FINNHUB_TOKEN 미설정 — 미국 수집 실패함')
  const claude = new Anthropic() // ant auth login 프로필로 인증 (API 키 불필요)
  const tick = async () => {
    await collectUS()
    await collectAndAnalyze(claude)
  }
  tick()
  cron.schedule('*/10 * * * *', tick)
  console.log('[worker] started — 10분마다 수집+분석')
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run`
Expected: 전체 PASS.

- [ ] **Step 5: `.env.example`에 OAuth 안내 주석 추가**

`.env.example` 하단에:
```
# Claude 분석은 API 키가 아니라 구독 OAuth로 인증합니다.
# 최초 1회: `ant auth login` 실행 (https://platform.claude.com/docs/en/api/sdks/cli)
# 확인: `ant auth status`  /  ANTHROPIC_API_KEY 는 설정하지 마세요(프로필을 가립니다)
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integrate news collection + conditional Claude analysis into worker loop"
```

---

## Task 2.5: 대시보드에 신호 카드 표시

**Files:**
- Modify: `lib/db.ts`, `app/page.tsx`

**Interfaces:**
- Produces: `getLatestSignals() -> Promise<SignalRow[]>` (lib/db.ts, 프론트 로컬 타입).

- [ ] **Step 1: lib/db.ts에 신호 읽기 추가**

`lib/db.ts`에 추가:
```ts
export interface AffectedCompany { name: string; ticker?: string; relation: string }
export interface SignalRow {
  symbol: string; market: string; signal: string; confidence: number
  rationale: string; affected: string; ts: number // affected=JSON 문자열
}

export async function getLatestSignals(): Promise<SignalRow[]> {
  const db = await Database.load(DB_URL)
  return db.select<SignalRow[]>(
    `SELECT g.symbol, g.market, g.signal, g.confidence, g.rationale, g.affected, g.ts
     FROM signals g
     JOIN (SELECT symbol, MAX(ts) AS ts FROM signals GROUP BY symbol) m
       ON g.symbol = m.symbol AND g.ts = m.ts`,
  )
}
```

- [ ] **Step 2: 카드에 신호 병합 표시**

`app/page.tsx`의 상태/로드에 signals 추가:
```tsx
import { getLatestQuotes, getLatestSignals, type QuoteRow, type SignalRow } from '@/lib/db'
// ...
const [signals, setSignals] = useState<Record<string, SignalRow>>({})
// useEffect의 load 안에서:
const load = () => {
  getLatestQuotes().then(setQuotes).catch((e) => setErr(String(e)))
  getLatestSignals()
    .then((rows) => setSignals(Object.fromEntries(rows.map((r) => [r.symbol, r]))))
    .catch(() => {}) // 신호 없으면 무시
}
```

카드 내부(가격/등락 아래)에 신호 블록 추가:
```tsx
{(() => {
  const s = signals[q.symbol]
  if (!s) return null
  const color = s.signal === 'buy' ? 'bg-emerald-600' : s.signal === 'sell' ? 'bg-red-600' : 'bg-neutral-600'
  const label = s.signal === 'buy' ? '매수' : s.signal === 'sell' ? '매도' : '관망'
  const affected = JSON.parse(s.affected) as { name: string; relation: string }[]
  return (
    <div className="mt-3 border-t border-neutral-800 pt-2">
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold text-white ${color}`}>
        {label} · {(s.confidence * 100).toFixed(0)}%
      </span>
      <p className="mt-1 text-xs text-neutral-300">{s.rationale}</p>
      {affected.length > 0 && (
        <p className="mt-1 text-[11px] text-neutral-500">
          영향: {affected.map((a) => `${a.name}(${a.relation})`).join(', ')}
        </p>
      )}
    </div>
  )
})()}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 정적 export 성공.

- [ ] **Step 4: 라이브 확인 (사용자)**

`ant auth login` 후 워커 재기동 → 뉴스 있는 종목 카드에 매수/매도 배지 + 근거 + 영향 기업 표시.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts app/page.tsx
git commit -m "feat: render buy/sell signal cards with rationale and affected companies"
```

---

## Self-Review

- **Spec coverage:** 뉴스 수집(2.1) / news·signals 저장(2.2) / 하이브리드 LLM 분석=뉴스+시세→신호·근거·영향(2.3) / 구독 OAuth 인증(2.4: `new Anthropic()` + ant auth login) / 비용 가드=새 뉴스 종목만(2.2 `symbolsWithFreshNews` + 2.4) / 매수·매도·근거·신뢰도·공급망 1-depth UI(2.5) / 참고 고지(승계) — 모두 매핑됨.
- **Placeholder scan:** 실제 코드·명령·기대결과 포함, 플레이스홀더 없음. Claude 호출은 모킹 테스트로 네트워크 없이 검증, 라이브는 사용자 체크포인트.
- **claude-api 스킬 준수:** 모델 `claude-opus-4-8`, `thinking:{type:'adaptive'}`, `output_config.effort:'medium'`, 구조화 출력 `output_config.format`(zodOutputFormat) + `messages.parse`. `budget_tokens`/`temperature`/`output_format`(구) 미사용. 인증은 OAuth 프로필(`new Anthropic()`), API 키 비저장.
- **Type consistency:** `Signal`/`SignalRow`(snake_case affected=JSON), `NewsItem`(datetime=ms), `AffectedCompany` 일관. `symbolsWithFreshNews`/`latestSignals` SQL과 헬퍼 시그니처 일치. 워커 `Signal` ↔ 프론트 `SignalRow` 분리(프론트 번들에 better-sqlite3 비유입).

## 미해결/후속(Phase 3+ 로 이월)
- 한국 시장(KIS) 뉴스/시세 — Phase 3.
- 공급망 다단계(N-depth) + 자동 종목 발굴 — Phase 4 (현재는 1-depth, 워치리스트 한정).
- 기술적 지표 정식 결합(이평선·RSI 등) — 현재는 시세 컨텍스트만 프롬프트에 제공. 정식 지표 confirm은 Phase 4+에서.
- Claude 호출량/rate limit 모니터링 — 구독 OAuth는 구독 한도 적용. 종목 수↑ 시 분석 빈도 조절 필요.
