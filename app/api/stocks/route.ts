import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

function toYahooTicker(ticker: string): string {
  const t = ticker.trim()
  // Already a Yahoo-format ticker (^GSPC, TSM, etc.) — pass through
  return t.toUpperCase()
}

function yahooRange(range: string): string {
  if (range === '1Y') return '1y'
  if (range === '5Y') return '5y'
  return '2y'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')
  const range  = searchParams.get('range') || '2Y'

  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 })

  const symbol   = toYahooTicker(ticker)
  const cacheKey = `stocks:${symbol}:${range}`
  const hit = getCached(cacheKey)
  if (hit) return NextResponse.json({ data: hit, cached: true })

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${yahooRange(range)}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!res.ok) throw new Error(`Yahoo Finance responded ${res.status}`)

    const json   = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) throw new Error(`找不到 "${ticker}" 的資料，請確認代碼（例：TSM、NVDA、^GSPC）`)

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

    if (data.length === 0) throw new Error('No valid data rows parsed')

    setCached(cacheKey, data, 30 * 60 * 1000)
    return NextResponse.json({ data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
