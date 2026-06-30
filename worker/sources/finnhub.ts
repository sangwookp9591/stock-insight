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
