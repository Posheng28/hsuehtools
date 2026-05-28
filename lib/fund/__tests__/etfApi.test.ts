import { describe, it, expect } from 'vitest'
import { parseNomuraEtf } from '../parse/nomuraEtf'
import { parseCapitalEtf } from '../parse/capitalEtf'
import { parseAllianzEtf } from '../parse/allianzEtf'
import nomura from './fixtures/nomura-00980A.json'
import capital from './fixtures/capital-00982A.json'
import allianz from './fixtures/allianz-00993A.json'

describe('parseNomuraEtf (real fixture 00980A)', () => {
  const s = parseNomuraEtf(nomura as any, '00980A')
  it('basic fields', () => {
    expect(s.fundId).toBe('00980A')
    expect(s.reportType).toBe('etf_daily')
    expect(s.source).toBe('nomura-api')
  })
  it('period from NavDate', () => { expect(s.period).toBe('2026-05-27') })
  it('45 holdings', () => { expect(s.holdings.length).toBe(45) })
  it('first row 2330 weight 7.96', () => {
    const r = s.holdings[0]
    expect(r.code).toBe('2330')
    expect(r.weightPct).toBe(7.96)
  })
})

describe('parseCapitalEtf (real fixture 00982A)', () => {
  const s = parseCapitalEtf(capital as any, '00982A')
  it('basic fields', () => {
    expect(s.fundId).toBe('00982A')
    expect(s.reportType).toBe('etf_daily')
    expect(s.source).toBe('capital-api')
  })
  it('period from pcf.date2', () => { expect(s.period).toBe('2026-05-27') })
  it('59 holdings', () => { expect(s.holdings.length).toBe(59) })
  it('first row 2330 weight 8.01', () => {
    const r = s.holdings[0]
    expect(r.code).toBe('2330')
    expect(r.weightPct).toBe(8.01)
  })
})

describe('parseAllianzEtf (real fixture 00993A)', () => {
  const s = parseAllianzEtf(allianz as any, '00993A')
  it('basic fields', () => {
    expect(s.fundId).toBe('00993A')
    expect(s.reportType).toBe('etf_daily')
    expect(s.source).toBe('allianz')
  })
  it('period from FundAsset.NavDate', () => { expect(s.period).toBe('2026-05-27') })
  it('52 holdings', () => { expect(s.holdings.length).toBe(52) })
  it('first row 2330 weight 9.08', () => {
    const r = s.holdings[0]
    expect(r.code).toBe('2330')
    expect(r.weightPct).toBe(9.08)
  })
})
