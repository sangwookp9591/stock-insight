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
