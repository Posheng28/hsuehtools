import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { parseMoneyDJEtf } from '../parse/moneyDjEtf'

const EXPECTED: Array<[string, number, string, string, number]> = [
  // [fundId, holdingsCount, period, firstCode, firstWeight]
  ['00980A', 45, '2026-05-27', '2330', 7.96],
  ['00981A', 51, '2026-05-27', '2330', 9.23],
  ['00982A', 59, '2026-05-27', '2330', 8.01],
  ['00988A', 13, '2026-05-26', '3037', 3.83],
  ['00991A', 50, '2026-05-27', '2330', 15.86],
  ['00993A', 52, '2026-05-27', '2330', 9.08],
]

describe('parseMoneyDJEtf (6 real fixtures)', () => {
  for (const [fundId, count, period, code1, weight1] of EXPECTED) {
    it(`${fundId}: ${count} holdings, period ${period}, top1 ${code1}@${weight1}`, async () => {
      const html = await fs.readFile(path.join(__dirname, 'fixtures', `moneydj-${fundId}.html`), 'utf-8')
      const snap = parseMoneyDJEtf(html, fundId)
      expect(snap.fundId).toBe(fundId)
      expect(snap.reportType).toBe('etf_daily')
      expect(snap.source).toBe('moneydj')
      expect(snap.period).toBe(period)
      expect(snap.holdings.length).toBe(count)
      expect(snap.holdings[0].code).toBe(code1)
      expect(snap.holdings[0].weightPct).toBe(weight1)
      expect(snap.holdings[0].rank).toBe(1)
    })
  }
})
