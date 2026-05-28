import type { FundSnapshot, FundHolding } from '../types'

interface CapitalResponse {
  code: number
  message?: string | null
  data?: {
    pcf?: { date2?: string; date1?: string }
    stocks?: Array<{
      stocNo: string
      stocName: string
      weight?: number
      weightRound?: number
      share?: number
      stocEname?: string
    }>
  }
}

export function parseCapitalEtf(raw: CapitalResponse, fundId: string): FundSnapshot {
  if (raw.code !== 200) throw new Error(`Capital code=${raw.code} message=${raw.message}`)
  const stocks = raw.data?.stocks ?? []
  const period = raw.data?.pcf?.date2 ?? raw.data?.pcf?.date1 ?? ''
  if (!period) throw new Error('Capital: missing pcf date')
  const holdings: FundHolding[] = stocks.map(s => ({
    code: String(s.stocNo).trim(),
    name: String(s.stocName).trim(),
    weightPct: s.weightRound != null ? Number(s.weightRound) : Number(s.weight),
  })).filter(h => h.code && !Number.isNaN(h.weightPct))
  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'capital-api',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
