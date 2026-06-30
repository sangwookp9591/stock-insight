import Database from '@tauri-apps/plugin-sql'

// ponytail: worker/db.ts의 QuoteRow와 동일 형태를 로컬 정의 — 프론트 번들이 better-sqlite3(네이티브)를 끌어오지 않게 결합 제거
export interface QuoteRow {
  symbol: string
  market: string
  price: number
  prev_close: number
  change_pct: number
  ts: number
}

// dev: NEXT_PUBLIC_DB_PATH에 repo의 data/app.db 절대경로 지정. 번들 배포 시 앱 데이터 디렉터리로 교체(이후 Phase에서 정리).
const DB_URL = `sqlite:${process.env.NEXT_PUBLIC_DB_PATH ?? 'app.db'}`

export async function getLatestQuotes(): Promise<QuoteRow[]> {
  const db = await Database.load(DB_URL)
  return db.select<QuoteRow[]>(
    `SELECT q.symbol, q.market, q.price, q.prev_close, q.change_pct, q.ts
     FROM quotes q
     JOIN (SELECT symbol, MAX(ts) AS ts FROM quotes GROUP BY symbol) m
       ON q.symbol = m.symbol AND q.ts = m.ts`,
  )
}
