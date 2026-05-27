import { describe, it, expect } from 'vitest'
import { transformHoldings } from '../seed'
import holdings from './fixtures/holdings.sample.json'
import fundInfo from './fixtures/fund-info.sample.json'

describe('transformHoldings', () => {
  const snaps = transformHoldings(holdings as any, fundInfo as any, '2026-04-11T00:00:00Z')

  it('產出含 monthly_top10 與 quarterly_full', () => {
    const types = new Set(snaps.map(s => s.reportType))
    expect(types.has('monthly_top10')).toBe(true)
    expect(types.has('quarterly_full')).toBe(true)
  })
  it('fundId 是我們的 slug（非 A0009 公司碼）', () => {
    expect(snaps.every(s => /^[a-z-]+$/.test(s.fundId))).toBe(true)
  })
  it('holdings 依 rank 排序、欄位齊全', () => {
    const s = snaps.find(s => s.reportType === 'monthly_top10')!
    expect(s.holdings[0].rank).toBe(1)
    expect(s.holdings[0].code).toMatch(/^\d{4,}$/)
    expect(typeof s.holdings[0].weightPct).toBe('number')
  })
})
