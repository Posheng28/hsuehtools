import { NextRequest, NextResponse } from 'next/server'
import { loadFund, saveFund } from '@/lib/fundStore'

// 個股外資持股比率%（官方），單日或逐週。用於籌碼/大戶「扣三大法人」之外資部分。
// 上市：TWSE MI_QFIIS（row[6]=外資持股比率%），per-date 全市場、跨股快取。
// 上櫃：此表查不到 → 回 null（外資資料待接）。投信/自營為估算，另行處理。

async function fetchQfiiDate(date: string): Promise<Record<string, number>> {
  const cached = await loadFund(date)
  if (cached) return cached
  const url = `https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date=${date}&selectType=ALLBUT0999&response=json`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`MI_QFIIS ${res.status}`)
  const j = await res.json()
  const map: Record<string, number> = {}
  if (j.stat === 'OK' && Array.isArray(j.data)) {
    for (const row of j.data as unknown[][]) {
      const c = String(row[0]).trim()
      const pct = parseFloat(String(row[6]))
      if (/^\d{4}$/.test(c) && !isNaN(pct)) map[c] = pct
    }
  }
  await saveFund(date, map) // 即使空也存，避免重抓非交易日
  return map
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('ticker') || '').trim()
  if (!/^\d{4}$/.test(code)) return NextResponse.json({ error: '代號錯誤' }, { status: 400 })

  // dates=逗號分隔 YYYYMMDD（逐週）；或單一 date
  const datesParam = searchParams.get('dates') || searchParams.get('date') || ''
  const dates = [...new Set(datesParam.split(',').map(s => s.replace(/-/g, '').trim()).filter(d => /^\d{8}$/.test(d)))]
  if (dates.length === 0) return NextResponse.json({ error: '日期錯誤' }, { status: 400 })

  try {
    const byDate: Record<string, number | null> = {}
    for (const d of dates) {
      const map = await fetchQfiiDate(d)
      byDate[d] = map[code] ?? null // null = 非上市/查無（如上櫃）
    }
    return NextResponse.json({ code, foreign: byDate })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '外資資料取得失敗' }, { status: 502 })
  }
}
