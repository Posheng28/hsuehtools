// lib/clauseEngine.test.ts
import { describe, it, expect } from 'vitest'
import { evalClauses, type ClauseInput } from '@/lib/clauseEngine'

const base: ClauseInput = {
  market: 'TWSE', prevClose: 100, sumKnown: 0, price: 130, spreadBase: 100,
  marketAvg6: null, sectorAvg6: null,
  c2: null, volMet: false,
  pe: null, pbr: null, mktPe: null, mktPbr: null, c6Assume: false,
  sblRate: null, sblAmp: null, c12Assume: false,
}

describe('款一差幅閘 = max(全體, 同類)+20', () => {
  it('同類均值較高時，綁定門檻被同類拉高（款一①更難觸發）', () => {
    // 全體10→閘30%；同類50→閘70%。price=130(+30%) 在純全體下可觸發①，但同類70%下不行
    const withSector = evalClauses({ ...base, marketAvg6: 10, sectorAvg6: 50 })
    const c1a = withSector.find(r => r.id === '1①')!
    expect(c1a.fired).toBe(false)   // 需 ≥ 70% 累積，130 僅 +30%
  })
  it('只有全體（同類 null）時行為同舊版', () => {
    // 全體10→閘30%；price 達 +32%(>32 且 >30) → 款一①觸發
    const r = evalClauses({ ...base, price: 133, marketAvg6: 10, sectorAvg6: null })
    expect(r.find(x => x.id === '1①')!.fired).toBe(true)
  })
  it('兩者皆 null → 退回純價格門檻(32%)', () => {
    expect(evalClauses({ ...base, price: 133 }).find(x => x.id === '1①')!.fired).toBe(true)   // +33% > 32
    expect(evalClauses({ ...base, price: 131 }).find(x => x.id === '1①')!.fired).toBe(false)  // +31% < 32
  })
})
