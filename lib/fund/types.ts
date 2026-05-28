export type ReportType = 'monthly_top10' | 'quarterly_full' | 'etf_daily'
export type FundKind = 'fund' | 'etf'
export type CrawlStrategy =
  | 'sitca' | 'nomura-api' | 'capital-api' | 'fuhua-excel' | 'uni-stealth' | 'allianz' | 'none'

export interface FundHolding {
  code: string
  name: string
  weightPct: number
  rank?: number
  amount?: number
  market?: string
}

export interface FundSnapshot {
  fundId: string
  reportType: ReportType
  period: string
  source: string
  fetchedAt: string
  holdings: FundHolding[]
  meta?: { aum?: number; manager?: string; cashPct?: number; note?: string }
}

export interface FundDef {
  fundId: string
  kind: FundKind
  company: string
  sitcaCode?: string
  etfTicker?: string
  relatedEtf?: string
  crawl: CrawlStrategy
  capitalInternalId?: string
}
