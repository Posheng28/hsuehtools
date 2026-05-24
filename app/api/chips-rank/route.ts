import { NextRequest, NextResponse } from 'next/server'
import { loadRankWeek, saveRankWeek, listRankDates } from '@/lib/rankStore'

// 全市場大戶佔比排行（籌碼篩選器）。
// 資料：TDCC opendata id=1-5（最新一週全市場，~3900 檔 × 17 級距，一次抓到）。
// 每次呼叫：抓最新週 → 存快照；若有上週快照 → 算近1週增減。近2/3週增減隨累積週數長出。
// pct400=級距12-15佔比、pct1000=級距15佔比。

const OPENDATA = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'

// 全市場最新週快照記憶體快取（避免每次切換門檻/排序都重抓+重解析 ~67k 行）
let cache: { at: number; date: string; map: Record<string, [number, number]> } | null = null

async function fetchLatest(): Promise<{ date: string; map: Record<string, [number, number]> }> {
  if (cache && Date.now() - cache.at < 6 * 60 * 60 * 1000) return { date: cache.date, map: cache.map }
  const res = await fetch(OPENDATA, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`opendata ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  // 欄位：資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%
  const byCode: Record<string, number[]> = {}
  let date = ''
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < 6) continue
    date = c[0].trim()
    const code = c[1].trim()
    const tier = parseInt(c[2])
    const pct = parseFloat(c[5])
    if (!/^[1-9]\d{3}$/.test(code) || isNaN(tier) || tier < 1 || tier > 15 || isNaN(pct)) continue
    ;(byCode[code] ||= new Array(15).fill(0))[tier - 1] = pct
  }
  const map: Record<string, [number, number]> = {}
  for (const [code, t] of Object.entries(byCode)) {
    const p400 = +((t[11] + t[12] + t[13] + t[14])).toFixed(2)
    const p1000 = +t[14].toFixed(2)
    map[code] = [p400, p1000]
  }
  cache = { at: Date.now(), date, map }
  return { date, map }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const use1000 = searchParams.get('lots') === '1000'
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const sort = searchParams.get('sort') || 'd1' // d1=近1週增減 / level=大戶佔比

  try {
    // 以 opendata 最新週為準（其日期才是真實資料日），存快照
    const fresh = await fetchLatest()
    await saveRankWeek(fresh.date, fresh.map)
    const latest = fresh.map

    // 找前一週快照（已存的、早於最新週的最近一個）
    const dates = (await listRankDates()).filter(d => d < fresh.date)
    const prev = dates.length ? await loadRankWeek(dates[dates.length - 1]) : null
    const idx = use1000 ? 1 : 0

    const rows = Object.entries(latest).map(([code, v]) => {
      const cur = v[idx]
      const pv = prev?.[code]?.[idx]
      const d1 = pv != null ? +(cur - pv).toFixed(2) : null
      return { code, pct: cur, d1 }
    })
    rows.sort((a, b) =>
      sort === 'level' ? b.pct - a.pct : ((b.d1 ?? -999) - (a.d1 ?? -999)))

    return NextResponse.json({
      date: fresh.date, prevDate: dates[dates.length - 1] ?? null,
      lots: use1000 ? 1000 : 400, total: rows.length,
      hasDelta: !!prev,
      rows: rows.slice(0, limit),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '排行取得失敗' }, { status: 502 })
  }
}
