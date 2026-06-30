import Database from 'better-sqlite3'

export interface Quote {
  symbol: string
  price: number
  prevClose: number
  changePct: number
  ts: number
}

export interface QuoteRow {
  symbol: string
  market: string
  price: number
  prev_close: number
  change_pct: number
  ts: number
}

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
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(q.symbol, market, q.price, q.prevClose, q.changePct, q.ts)
}

export function latestQuotes(db: Database.Database): QuoteRow[] {
  return db
    .prepare(
      `SELECT q.symbol, q.market, q.price, q.prev_close, q.change_pct, q.ts
       FROM quotes q
       JOIN (SELECT symbol, MAX(ts) AS ts FROM quotes GROUP BY symbol) m
         ON q.symbol = m.symbol AND q.ts = m.ts`,
    )
    .all() as QuoteRow[]
}
