// lib/disposal/__tests__/sectorLive.test.ts
import { describe, it, expect } from 'vitest'
import { misExChBatch, misRowsToTodayPct, liveSectorAvg } from '@/lib/disposal/sectorLive'

describe('misExChBatch', () => {
  it('上市/上櫃前綴 + | 串接', () => {
    expect(misExChBatch('TWSE', ['2327', '2330'])).toEqual(['tse_2327.tw|tse_2330.tw'])
    expect(misExChBatch('TPEx', ['6488'])).toEqual(['otc_6488.tw'])
  })
  it('每 40 檔一批', () => {
    const codes = Array.from({ length: 45 }, (_, i) => String(1000 + i))
    const batches = misExChBatch('TWSE', codes)
    expect(batches.length).toBe(2)
    expect(batches[0].split('|').length).toBe(40)
    expect(batches[1].split('|').length).toBe(5)
  })
  it('空陣列 → []', () => { expect(misExChBatch('TWSE', [])).toEqual([]) })
})

describe('misRowsToTodayPct', () => {
  it('(z−y)/y×100 取 trunc2；z/y 缺或 y≤0 跳過', () => {
    expect(misRowsToTodayPct([
      { code: 'A', price: 800,  prevClose: 780 },  // 2.5641 → 2.56
      { code: 'B', price: null, prevClose: 100 },  // skip
      { code: 'C', price: 50,   prevClose: 0 },    // skip (y≤0)
      { code: 'D', price: 495,  prevClose: 490 },  // 1.0204 → 1.02
      { code: 'E', price: 97,   prevClose: 100 },  // -3.00
    ])).toEqual({ A: 2.56, D: 1.02, E: -3 })
  })
})

describe('liveSectorAvg', () => {
  // 2327=目標(排除)；A,B,D 屬類28；C 屬類99(不計)
  const cums = { '2327': 24, A: 10, B: 4, C: 2, D: 6 }
  const sectorMap = { '2327': '28', A: '28', B: '28', C: '99', D: '28' }

  it('併入今日 live%、排除目標、等權；回 avg/n/todayAvg', () => {
    // members A,B,D；今日 A+1.5 B-0.5 D 無(0)
    // liveCum A=11.5 B=3.5 D=6 → sum=21 /3 = 7.00；todayAvg=(1.5-0.5+0)/3=0.3333→0.33
    expect(liveSectorAvg(cums, sectorMap, '28', '2327', { A: 1.5, B: -0.5 }))
      .toEqual({ avg: 7, n: 3, todayAvg: 0.33 })
  })

  it('無任何 live → 等於歷史同類均值、todayAvg=0', () => {
    // 歷史同類(A,B,D)=(10+4+6)/3=6.6667→6.67
    expect(liveSectorAvg(cums, sectorMap, '28', '2327', {}))
      .toEqual({ avg: 6.67, n: 3, todayAvg: 0 })
  })

  it('同類只剩目標一檔(n=0) → 全 null', () => {
    expect(liveSectorAvg({ '2327': 24 }, { '2327': '28' }, '28', '2327', {}))
      .toEqual({ avg: null, n: 0, todayAvg: null })
  })
})
