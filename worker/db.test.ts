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
