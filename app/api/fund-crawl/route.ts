import { NextRequest, NextResponse } from 'next/server'
import { defById } from '@/lib/fund/sources'
import { isAfterCutoff } from '@/lib/fund/timegate'
import { saveSnapshot } from '@/lib/fund/store'
import { parseNomuraEtf } from '@/lib/fund/parse/nomuraEtf'
import { parseCapitalEtf } from '@/lib/fund/parse/capitalEtf'
import { parseAllianzEtf } from '@/lib/fund/parse/allianzEtf'
import { parseCmoneyEtf } from '@/lib/fund/parse/cmoneyEtf'

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

    case 'allianz': {
      if (!def.allianzInternalId) {
        return NextResponse.json({ error: 'allianzInternalId missing' }, { status: 500 })
      }
      const referer = `https://etf.allianzgi.com.tw/etf-info/${def.allianzInternalId}?tab=4`
      const origin = 'https://etf.allianzgi.com.tw'
      // Step 1: get antiforgery token
      const tokRes = await fetch('https://etf.allianzgi.com.tw/webapi/api/AntiForgery/GetAntiForgeryToken', {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Origin': origin,
          'Referer': referer,
        },
      })
      if (!tokRes.ok) {
        return NextResponse.json({ error: `allianz token HTTP ${tokRes.status}` }, { status: 502 })
      }
      const tokJson = await tokRes.json() as { token?: string }
      const token = tokJson.token
      if (!token) {
        return NextResponse.json({ error: 'allianz token missing in body' }, { status: 502 })
      }
      // Extract Set-Cookie headers for forwarding to step 2
      const sc: string[] = (tokRes.headers as any).getSetCookie?.() ?? [tokRes.headers.get('set-cookie')].filter(Boolean) as string[]
      const cookie = sc
        .map((c: string) => c.split(';')[0])
        .filter(Boolean)
        .join('; ')
      if (!cookie) {
        return NextResponse.json({ error: 'allianz cookies missing' }, { status: 502 })
      }
      // Step 2: get fund holdings
      const res = await fetch('https://etf.allianzgi.com.tw/webapi/api/Fund/GetFundAssets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'Origin': origin,
          'Referer': referer,
          'X-XSRF-TOKEN': token,
          'Cookie': cookie,
        },
        body: JSON.stringify({ FundID: def.allianzInternalId }),
      })
      if (!res.ok) {
        return NextResponse.json({ error: `allianz assets HTTP ${res.status}` }, { status: 502 })
      }
      const raw = await res.json()
      const snap = parseAllianzEtf(raw, def.fundId)
      await saveSnapshot(snap)
      return NextResponse.json({ ok: true, period: snap.period, holdings: snap.holdings.length })
    }

    case 'cmoney-jsoncsv': {
      const token = process.env.CMONEY_GUEST_TOKEN
      if (!token) return NextResponse.json({ error: 'CMONEY_GUEST_TOKEN env not set' }, { status: 500 })
      const ticker = def.etfTicker!
      const res = await fetch('https://www.cmoney.tw/api/customReport/app/v2/dtno/JsonCsv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'cmoneyapi-trace-context': '{"platform":3,"appVersion":"1.0.0","osName":"Windows 10","modelName":null,"manufacturer":null}',
          'Origin': 'https://www.cmoney.tw',
          'Referer': `https://www.cmoney.tw/etf/tw/${ticker}/fundholding`,
        },
        body: JSON.stringify({
          Dtno: 59449513,
          Params: `AssignID=${ticker};MTPeriod=0;DTMode=0;DTRange=1;DTOrder=1;MajorTable=M722;`,
          FilterNo: '0',
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        return NextResponse.json({ error: `cmoney HTTP ${res.status}: ${txt.slice(0, 200)}` }, { status: res.status === 401 ? 401 : 502 })
      }
      const raw = await res.json()
      const snap = parseCmoneyEtf(raw, def.fundId)
      await saveSnapshot(snap)
      return NextResponse.json({ ok: true, period: snap.period, holdings: snap.holdings.length })
    }

    case 'fuhua-excel':
    case 'uni-stealth':
    case 'sitca':
    default:
      return NextResponse.json({ error: `crawl '${def.crawl}' 尚未實作` }, { status: 501 })
  }
}
