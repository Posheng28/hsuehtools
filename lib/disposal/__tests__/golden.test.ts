// lib/disposal/__tests__/golden.test.ts
import { describe, it, expect } from 'vitest'
import { cumulativeMap, eqAvg } from '@/lib/disposal/marketData'
import s22 from './fixtures/twse_20260522.json'
import s25 from './fixtures/twse_20260525.json'
import s26 from './fixtures/twse_20260526.json'
import s27 from './fixtures/twse_20260527.json'
import s28 from './fixtures/twse_20260528.json'
import sectorMap from './fixtures/twse_sectormap.json'

// fixture row = [code, closeStr, sign(+1/-1), magnitudeStr] → raw daily%
const toSnap = (rows: [string, string, number, string][]): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [c, closeS, sign, magS] of rows) {
    const close = parseFloat(closeS), diff = parseFloat(magS) * sign, prev = close - diff
    if (prev > 0) out[c] = (diff / prev) * 100
  }
  return out
}

describe('黃金值對拍 attstock（窗口 5/22~28）', () => {
  const snaps = [s22, s25, s26, s27, s28].map(r => toSnap(r as [string, string, number, string][]))
  const cums = cumulativeMap(snaps)
  it('國巨 2327 已知5日累積 = 27.36', () => {
    expect(+cums['2327'].toFixed(2)).toBeCloseTo(27.36, 2)
  })
  it('同類均值(產業別28, 排除國巨) = 6.15', () => {
    expect(eqAvg(cums, { sectorMap: sectorMap as Record<string, string>, sector: '28', exclude: '2327' }).avg).toBeCloseTo(6.15, 2)
  })
  it('全體均值(排除國巨) = 2.22', () => {
    expect(eqAvg(cums, { exclude: '2327' }).avg).toBeCloseTo(2.22, 2)
  })
})
