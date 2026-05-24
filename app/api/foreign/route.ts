import { NextRequest, NextResponse } from 'next/server'
import { fetchDJLegal } from '@/lib/dj'

// 個股三大法人持股比重%（逐週），供籌碼/大戶「扣三大法人」用。來源：DJ（lib/dj）。
// 回傳每個請求週的 { foreign%（外資）, legal%（三大法人） }；該週無資料則取最近一個較早日。

const cache = new Map<string, { at: number; map: Record<string, number[]> }>()
const adToDash = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('ticker') || '').trim()
  if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: '代號錯誤' }, { status: 400 })
  const dates = [...new Set((searchParams.get('dates') || searchParams.get('date') || '')
    .split(',').map(s => s.replace(/-/g, '').trim()).filter(d => /^\d{8}$/.test(d)))].sort()
  if (dates.length === 0) return NextResponse.json({ error: '日期錯誤' }, { status: 400 })

  try {
    const hit = cache.get(code)
    let map = hit && Date.now() - hit.at < 12 * 60 * 60 * 1000 ? hit.map : null
    if (!map) {
      map = await fetchDJLegal(code, adToDash(dates[0]), adToDash(dates[dates.length - 1]))
      cache.set(code, { at: Date.now(), map })
    }
    const keys = Object.keys(map).sort()
    const foreign: Record<string, number | null> = {}      // 外資%
    const legal: Record<string, number | null> = {}        // 三大法人%
    const qfiiLots: Record<string, number | null> = {}     // 外資持股(張)
    const itLots: Record<string, number | null> = {}       // 投信持股(張)
    const dealerLots: Record<string, number | null> = {}   // 自營持股(張)
    for (const d of dates) {
      let k: string | undefined = map[d] ? d : undefined
      if (!k) { for (let i = keys.length - 1; i >= 0; i--) if (keys[i] <= d) { k = keys[i]; break } }
      foreign[d]    = k ? map[k][0] : null
      legal[d]      = k ? map[k][1] : null
      qfiiLots[d]   = k ? map[k][2] : null
      itLots[d]     = k ? map[k][3] : null
      dealerLots[d] = k ? map[k][4] : null
    }
    return NextResponse.json({ code, foreign, legal, qfiiLots, itLots, dealerLots })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '法人持股取得失敗' }, { status: 502 })
  }
}
