import { slugBySitca, ETFS } from './sources'
import { joyPeriod } from './period'
import type { FundSnapshot, FundHolding, ReportType } from './types'

interface JoyRow {
  period: string; report_type: 'monthly' | 'quarterly'
  fund_code: string; fund_name: string
  rank: number; market?: string; stock_id: string; stock_name: string
  amount?: number; weight_pct: number
}
interface JoyFundInfo { last_updated: string; funds: { name: string; code: string; manager?: string; aum_nt_yi?: number }[] }

function buildNameToSlug(fi: JoyFundInfo): Map<string, { fundId: string; manager?: string; aum?: number }> {
  const m = new Map<string, { fundId: string; manager?: string; aum?: number }>()
  for (const f of fi.funds) {
    const fundId = slugBySitca(f.code)
    if (!fundId) continue
    m.set(f.name, { fundId, manager: f.manager, aum: f.aum_nt_yi })
  }
  return m
}

export function transformHoldings(
  holdings: Record<string, JoyRow[]>, fi: JoyFundInfo, fetchedAt: string,
): FundSnapshot[] {
  const nameToSlug = buildNameToSlug(fi)
  const groups = new Map<string, FundSnapshot>()
  for (const rows of Object.values(holdings)) {
    for (const r of rows) {
      const meta = nameToSlug.get(r.fund_name)
      if (!meta) continue
      const reportType: ReportType = r.report_type === 'monthly' ? 'monthly_top10' : 'quarterly_full'
      const period = joyPeriod(r.period, r.report_type)
      const k = `${meta.fundId}|${reportType}|${period}`
      if (!groups.has(k)) {
        groups.set(k, {
          fundId: meta.fundId, reportType, period, source: 'joy88-seed',
          fetchedAt, holdings: [], meta: { manager: meta.manager, aum: meta.aum },
        })
      }
      const h: FundHolding = {
        code: r.stock_id, name: r.stock_name, weightPct: r.weight_pct,
        rank: r.rank, amount: r.amount, market: r.market,
      }
      groups.get(k)!.holdings.push(h)
    }
  }
  for (const s of groups.values()) s.holdings.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  return [...groups.values()]
}

interface JoyEtf {
  name?: string
  company?: string
  manager?: string
  latest_date: string
  holdings: { stock_id: string; stock_name: string; weight_pct: number }[]
}

export function transformEtfHoldings(data: Record<string, JoyEtf>, fetchedAt: string): FundSnapshot[] {
  const tracked = new Set(ETFS.map(e => e.fundId))
  const out: FundSnapshot[] = []
  for (const [ticker, v] of Object.entries(data)) {
    if (!tracked.has(ticker)) continue
    out.push({
      fundId: ticker,
      reportType: 'etf_daily',
      period: v.latest_date,
      source: 'joy88-seed',
      fetchedAt,
      holdings: v.holdings.map(h => ({ code: h.stock_id, name: h.stock_name, weightPct: h.weight_pct })),
      meta: v.manager ? { manager: v.manager } : undefined,
    })
  }
  return out
}
