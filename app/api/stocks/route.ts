import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, throttle } from '@/lib/cache'

function toStooqTicker(ticker: string): string {
  const t = ticker.trim()
  if (t.startsWith('^') || t.includes('.')) return t.toLowerCase()
  return `${t.toLowerCase()}.us`
}

function rangeStart(range: string): string {
  const d = new Date()
  if (range === '1Y') d.setFullYear(d.getFullYear() - 1)
  else if (range === '5Y') d.setFullYear(d.getFullYear() - 5)
  else d.setFullYear(d.getFullYear() - 2)
  return d.toISOString().split('T')[0].replace(/-/g, '')
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')
  const range  = searchParams.get('range') || '2Y'

  if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 })

  const apiKey = process.env.STOOQ_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'STOOQ_API_KEY not set' }, { status: 500 })

  const stooq    = toStooqTicker(ticker)
  const cacheKey = `stocks:${stooq}:${range}`
  const hit = getCached(cacheKey)
  if (hit) return NextResponse.json({ data: hit, cached: true })

  await throttle('stooq', 400, 300)

  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const d1    = rangeStart(range)
  const url   = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooq)}&d1=${d1}&d2=${today}&i=d&apikey=${apiKey}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://stooq.com/',
      },
    })

    if (!res.ok) throw new Error(`Stooq responded ${res.status}`)

    const text  = await res.text()
    const lines = text.trim().split('\n')

    if (lines.length < 2 || text.toLowerCase().includes('apikey')) {
      throw new Error(`找不到 "${ticker}" 的資料，請確認代碼（美股格式：aapl.us）`)
    }

    const data = lines
      .slice(1)
      .map((line) => {
        const cols  = line.split(',')
        if (cols.length < 5) return null
        const date  = cols[0].trim()
        const close = parseFloat(cols[4])
        if (!date.match(/^\d{4}-\d{2}-\d{2}$/) || isNaN(close)) return null
        return { date, value: close }
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
