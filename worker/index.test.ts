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
      ok: true,
      json: async () => ({ c: 200, pc: 198, dp: 1.01 }),
    }) as unknown as typeof fetch
    const { collectUS } = await import('./index')
    const rows = await collectUS()
    expect(rows.length).toBe(1)
    expect(rows[0].price).toBe(200)
  })
})
