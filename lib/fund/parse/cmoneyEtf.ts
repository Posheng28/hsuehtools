import type { FundSnapshot, FundHolding } from '../types'

interface CmoneyResponse {
  columns: Record<string, string>
  rows: Array<[string, string, string, number, number, string]>
}

const STOCK_CODE = /^\d{4,6}[A-Z]?$/

export function parseCmoneyEtf(raw: CmoneyResponse, fundId: string): FundSnapshot {
  if (!Array.isArray(raw?.rows)) throw new Error('CMoney: rows missing')
  const stockRows = raw.rows.filter(r => STOCK_CODE.test(String(r[1] ?? '')))
  if (!stockRows.length) throw new Error('CMoney: zero stock rows')
  // Derive period from the first stock row's date (YYYYMMDD -> YYYY-MM-DD)
  const ymd = String(stockRows[0][0] ?? '')
  if (!/^\d{8}$/.test(ymd)) throw new Error(`CMoney: bad date ${ymd}`)
  const period = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  const holdings: FundHolding[] = stockRows.map((r, i) => ({
    code: String(r[1]).trim(),
    name: String(r[2]).trim(),
    weightPct: Number(r[3]),
    rank: i + 1,
  })).filter(h => !Number.isNaN(h.weightPct))
  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'cmoney-jsoncsv',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
