import type { FundSnapshot, FundHolding } from '../types'

interface NomuraResponse {
  StatusCode: number
  Entries?: {
    FundID: string
    Data?: {
      Table?: Array<{
        TableTitle: string
        Columns: Array<{ Name: string }>
        Rows: string[][]
        NavDate: string
      }>
    }
  }
}

function navDateToISO(s: string): string {
  // "2026/05/27" -> "2026-05-27"
  return s.trim().replace(/\//g, '-')
}

export function parseNomuraEtf(raw: NomuraResponse, fundId: string): FundSnapshot {
  if (raw.StatusCode !== 0) throw new Error(`Nomura StatusCode=${raw.StatusCode}`)
  const tables = raw.Entries?.Data?.Table ?? []
  const stockTable = tables.find(t => t.TableTitle === '股票')
  if (!stockTable) throw new Error('Nomura: stock table not found')
  const period = navDateToISO(stockTable.NavDate)
  const holdings: FundHolding[] = stockTable.Rows.map(r => ({
    code: String(r[0]).trim(),
    name: String(r[1]).trim(),
    weightPct: Number(r[3]),
  })).filter(h => /^\d{4,}/.test(h.code) && !Number.isNaN(h.weightPct))
  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'nomura-api',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
