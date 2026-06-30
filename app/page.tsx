'use client'
import { useEffect, useState } from 'react'
import { getLatestQuotes, type QuoteRow } from '@/lib/db'

export default function Home() {
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [err, setErr] = useState<string>()

  useEffect(() => {
    const load = () => getLatestQuotes().then(setQuotes).catch((e) => setErr(String(e)))
    load()
    const id = setInterval(load, 30_000) // ponytail: 30초 폴링. 실시간 푸시는 YAGNI, 10분 수집 주기엔 과함
    return () => clearInterval(id)
  }, [])

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">Stock Insight</h1>
      {err && <p className="text-red-400">DB 오류: {err}</p>}
      {quotes.length > 0 && (
        <p className="text-xs text-neutral-500 mb-2">
          마지막 갱신: {new Date(Math.max(...quotes.map((q) => q.ts))).toLocaleTimeString('ko-KR')}
        </p>
      )}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        {quotes.map((q) => (
          <article
            key={q.symbol}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <h2 className="text-lg font-semibold">{q.symbol}</h2>
            <p className="text-2xl tabular-nums">{q.price.toFixed(2)}</p>
            <p className={q.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {q.change_pct >= 0 ? '▲' : '▼'} {q.change_pct.toFixed(2)}%
            </p>
          </article>
        ))}
      </div>
      <p className="mt-6 text-xs text-neutral-500">
        투자 참고용입니다. 투자 책임은 본인에게 있습니다.
      </p>
    </main>
  )
}
