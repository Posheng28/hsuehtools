// app/api/sectoravg/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { fetchTwseDailyPct, fetchTpexDailyPct, fetchSectorMap, cumulativeMap, eqAvg, type Market } from '@/lib/disposal/marketData'
import { liveSectorAvg, fetchSectorTodayPct } from '@/lib/disposal/sectorLive'

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const market = (p.get('market') === 'TPEx' ? 'TPEx' : 'TWSE') as Market
  const code = (p.get('code') ?? '').trim()
  const win = (p.get('win') ?? '').split(',').map(s => s.trim()).filter(s => /^\d{8}$/.test(s))
  if (!code || win.length < 1) return NextResponse.json({ error: 'need code & win' }, { status: 400 })

  const cacheKey = `sectoravg:${market}:${win.join('-')}`
  let cached = getCached(cacheKey) as { cums: Record<string, number>; sectorMap: Record<string, string> } | undefined
  if (p.get('bust') === '1') cached = undefined

  let cums: Record<string, number>, sectorMap: Record<string, string>
  if (cached) { cums = cached.cums; sectorMap = cached.sectorMap }
  else {
    const fetcher = market === 'TWSE' ? fetchTwseDailyPct : fetchTpexDailyPct
    const snaps: Record<string, number>[] = []
    for (const d of win) { const s = await fetcher(d); if (!s) return NextResponse.json({ error: `fetch fail ${d}` }, { status: 200 }) ; snaps.push(s) }
    cums = cumulativeMap(snaps)
    sectorMap = await fetchSectorMap(market)
    setCached(cacheKey, { cums, sectorMap }, 6 * 60 * 60 * 1000)
  }

  const sectorCode = sectorMap[code] ?? null
  const market_ = eqAvg(cums, { exclude: code })
  const sector_ = sectorCode ? eqAvg(cums, { sectorMap, sector: sectorCode, exclude: code }) : { avg: null, n: 0 }

  // 盤中即時：同類成員當日 live% 併入（全體仍 0%）。失敗則全 null，前端退回歷史值。
  let sectorAvgLive: number | null = null, sectorTodayAvg: number | null = null, sectorLiveN: number | null = null
  if (p.get('live') === '1' && sectorCode) {
    const members = Object.keys(cums).filter(c => sectorMap[c] === sectorCode && c !== code)
    const todayPct = await fetchSectorTodayPct(market, members)
    const r = liveSectorAvg(cums, sectorMap, sectorCode, code, todayPct)
    sectorAvgLive = r.avg; sectorTodayAvg = r.todayAvg; sectorLiveN = r.n
  }

  return NextResponse.json({
    targetCum: code in cums ? +cums[code].toFixed(2) : null,
    marketAvg: market_.avg, marketN: market_.n,
    sectorAvg: sector_.avg, sectorN: sector_.n,
    sectorAvgLive, sectorTodayAvg, sectorLiveN,
    sectorCode,
  })
}
