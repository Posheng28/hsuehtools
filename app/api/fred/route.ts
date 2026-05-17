import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, throttle } from '@/lib/cache'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const seriesId = searchParams.get('series')
  const range = searchParams.get('range') || '2Y'

  if (!seriesId) return NextResponse.json({ error: 'Missing series' }, { status: 400 })

  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FRED_API_KEY not set' }, { status: 500 })

  const cacheKey = `fred:${seriesId}:${range}`
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json({ data: cached, cached: true })

  const end = new Date()
  const start = new Date()
  switch (range) {
    case '1Y': start.setFullYear(start.getFullYear() - 1); break
    case '5Y': start.setFullYear(start.getFullYear() - 5); break
    default:   start.setFullYear(start.getFullYear() - 2)   // '2Y'
  }

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // FRED allows 120 req/min; throttle to ~300 ms between requests to be safe
  await throttle('fred', 300, 200)

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${fmt(start)}&observation_end=${fmt(end)}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 chart-overlay-app' },
    })
    if (!res.ok) throw new Error(`FRED responded ${res.status}`)
    const json = await res.json()

    const data = (json.observations ?? [])
      .filter((o: { value: string }) => o.value !== '.')
      .map((o: { date: string; value: string }) => ({
        date: o.date,
        value: parseFloat(o.value),
      }))

    // Cache FRED data for 60 min (it updates daily)
    setCached(cacheKey, data, 60 * 60 * 1000)
    return NextResponse.json({ data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
