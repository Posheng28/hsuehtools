import { NextRequest, NextResponse } from 'next/server'
import { defById } from '@/lib/fund/sources'
import { isAfterCutoff } from '@/lib/fund/timegate'
import { saveSnapshot } from '@/lib/fund/store'
import { parseMoneyDJEtf } from '@/lib/fund/parse/moneyDjEtf'

export async function POST(req: NextRequest) {
  const { fundId, force } = await req.json().catch(() => ({} as { fundId?: string; force?: boolean }))
  if (!force && !isAfterCutoff()) {
    return NextResponse.json({ error: '尚未過 18:30，資料當日未定案' }, { status: 425 })
  }
  const def = fundId ? defById(fundId) : null
  if (!def) return NextResponse.json({ error: 'unknown fundId' }, { status: 400 })

  switch (def.crawl) {
    case 'moneydj': {
      const url = `https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=${def.etfTicker}.TW`
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } })
      if (!res.ok) return NextResponse.json({ error: `moneydj HTTP ${res.status}` }, { status: 502 })
      const html = await res.text()
      const snap = parseMoneyDJEtf(html, def.fundId)
      await saveSnapshot(snap)
      return NextResponse.json({ ok: true, period: snap.period, holdings: snap.holdings.length })
    }

    case 'sitca':
    default:
      return NextResponse.json({ error: `crawl '${def.crawl}' 尚未實作` }, { status: 501 })
  }
}
