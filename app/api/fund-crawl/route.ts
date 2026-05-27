import { NextResponse } from 'next/server'
import { defById } from '@/lib/fund/sources'
import { isAfterCutoff } from '@/lib/fund/timegate'
// saveSnapshot will be used by the real crawlers in later tasks:
// import { saveSnapshot } from '@/lib/fund/store'

export async function POST(req: Request) {
  const { fundId, force } = await req.json().catch(() => ({} as { fundId?: string; force?: boolean }))
  if (!force && !isAfterCutoff()) {
    return NextResponse.json({ error: '尚未過 18:30，資料當日未定案' }, { status: 425 })
  }
  const def = fundId ? defById(fundId) : null
  if (!def) return NextResponse.json({ error: 'unknown fundId' }, { status: 400 })

  switch (def.crawl) {
    case 'nomura-api':
    case 'capital-api':
    case 'fuhua-excel':
    case 'uni-stealth':
    case 'allianz':
    case 'sitca':
    default:
      return NextResponse.json({ error: `crawl '${def.crawl}' 尚未實作` }, { status: 501 })
  }
}
