import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { parseNomuraEtf } from '../parse/nomuraEtf'
import { parseCapitalEtf } from '../parse/capitalEtf'
import { parseAllianzEtf } from '../parse/allianzEtf'
import { parseCmoneyEtf } from '../parse/cmoneyEtf'
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

describe('parseCmoneyEtf (real fixtures)', () => {
  it('00981A: filters out cash rows, real holdings', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/cmoney-holdings-00981A.json'), 'utf-8'))
    const snap = parseCmoneyEtf(raw, '00981A')
    expect(snap.fundId).toBe('00981A')
    expect(snap.reportType).toBe('etf_daily')
    expect(snap.source).toBe('cmoney-jsoncsv')
    // 55 total rows - 4 non-stock (C_NTD, M_NTD, PFUR_NTD, RDI_NTD) = 51 stock rows
    expect(snap.period).toBe('2026-05-27')
    expect(snap.holdings.length).toBe(51)
    expect(snap.holdings[0].code).toBe('2330')
    expect(snap.holdings[0].weightPct).toBe(9.23)
    // No cash rows leaked through
    expect(snap.holdings.find(h => h.code.includes('_'))).toBeUndefined()
  })

  it('00991A: same shape', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/cmoney-holdings-00991A.json'), 'utf-8'))
    const snap = parseCmoneyEtf(raw, '00991A')
    expect(snap.fundId).toBe('00991A')
    expect(snap.reportType).toBe('etf_daily')
    expect(snap.source).toBe('cmoney-jsoncsv')
    // 52 total rows - 2 non-stock (DA_NTD, PB_NTD) = 50 stock rows
    expect(snap.period).toBe('2026-05-27')
    expect(snap.holdings.length).toBe(50)
    expect(snap.holdings[0].code).toBe('2330')
    expect(snap.holdings[0].weightPct).toBe(15.86)
    // No cash rows leaked through
    expect(snap.holdings.find(h => h.code.includes('_'))).toBeUndefined()
  })
})
