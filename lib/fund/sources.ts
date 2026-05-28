import type { FundDef } from './types'

const SLUG_BY_SITCA: Record<string, string> = {
  A09002: 'uni-allweather',
  A09012: 'uni-benteng',
  A09003: 'uni-blackhorse',
  A09011: 'uni-sme',
  A09:    'uni-greater-china-sme',
  A22001: 'fh-growth',
  A22:    'fh-allround',
  A32001: 'nomura-quality',
  A32:    'nomura-hitech',
  A36001: 'allianz-dabar',
  A36004: 'allianz-tech',
  A47:    'taishin-mainstream',
  A05:    'yuanta-newmain',
}

export function slugBySitca(code: string): string | undefined {
  return SLUG_BY_SITCA[code]
}

export const FUNDS: FundDef[] = [
  { fundId: 'uni-allweather',        kind: 'fund', company: 'uni',     sitcaCode: 'A09002', relatedEtf: '00988A', crawl: 'sitca' },
  { fundId: 'uni-benteng',           kind: 'fund', company: 'uni',     sitcaCode: 'A09012', relatedEtf: '00981A', crawl: 'sitca' },
  { fundId: 'uni-blackhorse',        kind: 'fund', company: 'uni',     sitcaCode: 'A09003', crawl: 'sitca' },
  { fundId: 'uni-sme',               kind: 'fund', company: 'uni',     sitcaCode: 'A09011', crawl: 'sitca' },
  { fundId: 'uni-greater-china-sme', kind: 'fund', company: 'uni',     sitcaCode: 'A09',    crawl: 'sitca' },
  { fundId: 'fh-growth',             kind: 'fund', company: 'fuhua',   sitcaCode: 'A22001', relatedEtf: '00991A', crawl: 'sitca' },
  { fundId: 'fh-allround',           kind: 'fund', company: 'fuhua',   sitcaCode: 'A22',    crawl: 'sitca' },
  { fundId: 'nomura-quality',        kind: 'fund', company: 'nomura',  sitcaCode: 'A32001', crawl: 'sitca' },
  { fundId: 'nomura-hitech',         kind: 'fund', company: 'nomura',  sitcaCode: 'A32',    crawl: 'sitca' },
  { fundId: 'allianz-dabar',         kind: 'fund', company: 'allianz', sitcaCode: 'A36001', crawl: 'sitca' },
  { fundId: 'allianz-tech',          kind: 'fund', company: 'allianz', sitcaCode: 'A36004', relatedEtf: '00993A', crawl: 'sitca' },
  { fundId: 'taishin-mainstream',    kind: 'fund', company: 'taishin', sitcaCode: 'A47',    crawl: 'sitca' },
  { fundId: 'yuanta-newmain',        kind: 'fund', company: 'yuanta',  sitcaCode: 'A05',    crawl: 'sitca' },
]

export const ETFS: FundDef[] = [
  { fundId: '00980A', kind: 'etf', company: 'nomura',  etfTicker: '00980A', crawl: 'nomura-api' },
  { fundId: '00981A', kind: 'etf', company: 'uni',     etfTicker: '00981A', crawl: 'cmoney-jsoncsv' },
  { fundId: '00982A', kind: 'etf', company: 'capital', etfTicker: '00982A', crawl: 'capital-api', capitalInternalId: '399' },
  { fundId: '00988A', kind: 'etf', company: 'uni',     etfTicker: '00988A', crawl: 'uni-stealth' },
  { fundId: '00991A', kind: 'etf', company: 'fuhua',   etfTicker: '00991A', crawl: 'cmoney-jsoncsv' },
  { fundId: '00993A', kind: 'etf', company: 'allianz', etfTicker: '00993A', crawl: 'allianz', allianzInternalId: 'E0002' },
]

export const ALL_DEFS: FundDef[] = [...FUNDS, ...ETFS]
export const defById = (id: string) => ALL_DEFS.find(d => d.fundId === id)
