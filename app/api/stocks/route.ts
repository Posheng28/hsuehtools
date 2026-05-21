import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

function yahooRange(range: string): string {
  if (range === '1Y') return '1y'
  if (range === '5Y') return '5y'
  return '2y'
}

function candidateTickers(ticker: string): string[] {
  const t = ticker.trim().toUpperCase()
  if (/^\d{4}$/.test(t)) return [`${t}.TW`, `${t}.TWO`]
  if (t.includes('.')) return [t]
  return [t]
}

async function fetchYahoo(symbol: string, params: { range?: string; from?: string; to?: string }) {
  let url: string
  if (params.from && params.to) {
    const p1 = Math.floor(new Date(params.from + 'T00:00:00Z').getTime() / 1000)
    const p2 = Math.floor(new Date(params.to   + 'T23:59:59Z').getTime() / 1000)
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}`
  } else {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${yahooRange(params.range ?? '2Y')}`
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })
  if (!res.ok) return null
  const json   = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null

  const timestamps: number[] = result.timestamp ?? []
  const closes: number[]     = result.indicators?.quote?.[0]?.close ?? []

  const data = timestamps
    .map((ts, i) => {
      const date  = new Date(ts * 1000).toISOString().split('T')[0]
      const value = closes[i]
      if (value == null || isNaN(value)) return null
      return { date, value }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.date < b!.date ? -1 : 1)) as { date: string; value: number }[]

  return data.length > 0 ? data : null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')
  const range  = searchParams.get('range') || '2Y'
  const from   = searchParams.get('from') ?? undefined
  const to     = searchParams.get('to')   ?? undefined

  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 })

  const candidates = candidateTickers(ticker)
  const cacheKey   = from && to
    ? `stocks:${candidates[0]}:${from}:${to}`
    : `stocks:${candidates[0]}:${range}`
  const hit = getCached(cacheKey)
  if (hit) return NextResponse.json({ data: hit, cached: true })

  try {
    for (const symbol of candidates) {
      const data = await fetchYahoo(symbol, { range, from, to })
      if (data) {
        setCached(cacheKey, data, 30 * 60 * 1000)
        return NextResponse.json({ data })
      }
    }
    throw new Error(`找不到 "${ticker}" 的資料（已嘗試：${candidates.join('、')}）`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
