import { NextRequest, NextResponse } from 'next/server'
import { defById } from '@/lib/fund/sources'
import { isAfterCutoff } from '@/lib/fund/timegate'
import { saveSnapshot } from '@/lib/fund/store'
import { parseNomuraEtf } from '@/lib/fund/parse/nomuraEtf'
import { parseCapitalEtf } from '@/lib/fund/parse/capitalEtf'

export async function POST(req: NextRequest) {
  const { fundId, force } = await req.json().catch(() => ({} as { fundId?: string; force?: boolean }))
  if (!force && !isAfterCutoff()) {
    return NextResponse.json({ error: '尚未過 18:30，資料當日未定案' }, { status: 425 })
  }
  const def = fundId ? defById(fundId) : null
  if (!def) return NextResponse.json({ error: 'unknown fundId' }, { status: 400 })

  switch (def.crawl) {
    case 'nomura-api': {
      const ticker = def.etfTicker!
      const res = await fetch('https://www.nomurafunds.com.tw/API/ETFAPI/api/Fund/GetFundAssets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://www.nomurafunds.com.tw',
          'Referer': `https://www.nomurafunds.com.tw/ETFWEB/product-description?fundNo=${ticker}&tab=Shareholding`,
        },
        body: JSON.stringify({ FundID: ticker, SearchDate: null }),
      })
      if (!res.ok) {
        return NextResponse.json({ error: `Nomura upstream ${res.status}` }, { status: 502 })
      }
      const snap = parseNomuraEtf(await res.json(), def.fundId)
      await saveSnapshot(snap)
      return NextResponse.json({ ok: true, period: snap.period, holdings: snap.holdings.length })
    }

    case 'capital-api': {
      if (!def.capitalInternalId) {
        return NextResponse.json({ error: `No capitalInternalId configured for ${def.fundId}` }, { status: 500 })
      }
      const internalId = def.capitalInternalId
      const res = await fetch('https://www.capitalfund.com.tw/CFWeb/api/etf/buyback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Origin': 'https://www.capitalfund.com.tw',
          'Referer': `https://www.capitalfund.com.tw/etf/product/detail/${internalId}/portfolio`,
        },
        body: JSON.stringify({ fundId: internalId, date: null }),
      })
      if (!res.ok) {
        return NextResponse.json({ error: `Capital upstream ${res.status}` }, { status: 502 })
      }
      const snap = parseCapitalEtf(await res.json(), def.fundId)
      await saveSnapshot(snap)
      return NextResponse.json({ ok: true, period: snap.period, holdings: snap.holdings.length })
    }

    case 'fuhua-excel':
    case 'uni-stealth':
    case 'allianz':
    case 'sitca':
    default:
      return NextResponse.json({ error: `crawl '${def.crawl}' 尚未實作` }, { status: 501 })
  }
}
