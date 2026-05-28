import type { FundSnapshot, FundHolding } from '../types'

interface AllianzResponse {
  StatusCode: number
  Message?: string
  Entries?: {
    FundID?: string
    Data?: {
      FundAsset?: { NavDate?: string; PCFDate?: string }
      Table?: Array<{ TableTitle: string; Columns: Array<{ Name: string }>; Rows: string[][] }>
    }
  }
}

function navDateToISO(s: string | undefined): string {
  if (!s) return ''
  return s.trim().replace(/\//g, '-')
}

function parseWeight(s: string): number {
  // "9.08%" -> 9.08
  return Number(String(s).replace('%', '').trim())
}

export function parseAllianzEtf(raw: AllianzResponse, fundId: string): FundSnapshot {
  if (raw.StatusCode !== 0) throw new Error(`Allianz StatusCode=${raw.StatusCode} Message=${raw.Message ?? ''}`)
  const data = raw.Entries?.Data
  if (!data) throw new Error('Allianz: missing Entries.Data')
  const tables = data.Table ?? []
  const stockTable = tables.find(t => (t.TableTitle ?? '').startsWith('股票'))
  if (!stockTable) throw new Error('Allianz: stock table not found')
  const period = navDateToISO(data.FundAsset?.NavDate)
  if (!period) throw new Error('Allianz: missing FundAsset.NavDate')
  const holdings: FundHolding[] = stockTable.Rows.map(r => ({
    code: String(r[1] ?? '').trim(),
    name: String(r[2] ?? '').trim(),
    weightPct: parseWeight(String(r[4] ?? '')),
  })).filter(h => /^\d{4,}/.test(h.code) && !Number.isNaN(h.weightPct))
  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'allianz',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
