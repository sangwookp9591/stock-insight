import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openDb, upsertQuote } from './db'

const dbPath = resolve(process.cwd(), 'data/app.db')
mkdirSync(resolve(process.cwd(), 'data'), { recursive: true })
const db = openDb(dbPath)
db.prepare(`INSERT OR REPLACE INTO watchlist (symbol, market, name) VALUES (?, ?, ?)`).run(
  'AAPL',
  'US',
  'Apple',
)
upsertQuote(
  db,
  { symbol: 'AAPL', price: 212.34, prevClose: 210.0, changePct: 1.11, ts: 1735603200000 },
  'US',
)
db.close()
console.log('seeded data/app.db')
