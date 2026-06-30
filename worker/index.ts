import cron from 'node-cron'
import { openDb, upsertQuote, latestQuotes, type QuoteRow } from './db'
import { fetchQuote } from './sources/finnhub'
import { DB_PATH, FINNHUB_TOKEN, WATCHLIST } from './config'

export async function collectUS(): Promise<QuoteRow[]> {
  const db = openDb(DB_PATH)
  const now = Date.now()
  for (const item of WATCHLIST.filter((w) => w.market === 'US')) {
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
