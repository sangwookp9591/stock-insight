import { describe, it, expect } from 'vitest'
import { parseFinnhubQuote } from './finnhub'

describe('parseFinnhubQuote', () => {
  it('정상 응답을 Quote로 변환', () => {
    const raw = { c: 212.34, d: 2.34, dp: 1.11, pc: 210.0 }
    const q = parseFinnhubQuote('AAPL', raw, 1735603200000)
    expect(q).toEqual({
      symbol: 'AAPL',
      price: 212.34,
      prevClose: 210.0,
      changePct: 1.11,
      ts: 1735603200000,
    })
  })

  it('현재가 0(휴장/오류)이면 throw', () => {
    expect(() => parseFinnhubQuote('AAPL', { c: 0, pc: 0, dp: 0 }, 1)).toThrow()
  })
})
