import { NextRequest, NextResponse } from 'next/server'
import { loadRankWeek, saveRankWeek, listRankDates } from '@/lib/rankStore'
import { loadLegal, listLegalCodes } from '@/lib/legalStore'

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
  const net = searchParams.get('net') === '1' // 內部大戶 = 大戶 − 三大法人
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const sort = searchParams.get('sort') || 'd1' // d1=近1週增減 / level=佔比

  // 取某 legal map 中 ≤ 指定日的最近一週三大法人%
  const legalAt = (lm: Record<string, [number, number]> | null, ymd: string): number | null => {
    if (!lm) return null
    const keys = Object.keys(lm).sort()
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i] <= ymd) return lm[keys[i]][1]
    return null
  }

  try {
    // 以 opendata 最新週為準（其日期才是真實資料日），存快照
    const fresh = await fetchLatest()
    await saveRankWeek(fresh.date, fresh.map)
    const latest = fresh.map

    // 找前一週快照（已存的、早於最新週的最近一個）
    const dates = (await listRankDates()).filter(d => d < fresh.date)
    const prevDate = dates.length ? dates[dates.length - 1] : null
    const prev = prevDate ? await loadRankWeek(prevDate) : null
    const idx = use1000 ? 1 : 0

    // 內部大戶：載入已爬取的三大法人 legalStore
    const legalMap = new Map<string, Record<string, [number, number]> | null>()
    let crawled = 0
    if (net) {
      for (const code of await listLegalCodes()) { legalMap.set(code, await loadLegal(code)); crawled++ }
    }

    let rows = Object.entries(latest).map(([code, v]) => {
      const big = v[idx]
      const bigPrev = prev?.[code]?.[idx]
      if (net) {
        const lm = legalMap.get(code) ?? null
        const lNow = legalAt(lm, fresh.date)
        if (lNow == null) return null // 尚未爬到三大法人 → 不列入內部大戶排行
        const cur = +(big - lNow).toFixed(2)
        const lPrev = prevDate ? legalAt(lm, prevDate) : null
        const d1 = bigPrev != null && lPrev != null ? +((big - lNow) - (bigPrev - lPrev)).toFixed(2) : null
        return { code, pct: cur, d1 }
      }
      const d1 = bigPrev != null ? +(big - bigPrev).toFixed(2) : null
      return { code, pct: big, d1 }
    }).filter(Boolean) as { code: string; pct: number; d1: number | null }[]

    rows.sort((a, b) => sort === 'level' ? b.pct - a.pct : ((b.d1 ?? -999) - (a.d1 ?? -999)))

    return NextResponse.json({
      date: fresh.date, prevDate,
      lots: use1000 ? 1000 : 400, net, total: rows.length, crawled,
      hasDelta: !!prev,
      rows: rows.slice(0, limit),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '排行取得失敗' }, { status: 502 })
  }
}
