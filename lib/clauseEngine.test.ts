// lib/clauseEngine.test.ts
import { describe, it, expect } from 'vitest'
import { evalClauses, summarize, sectorAppliesForPe, SECTOR_PE_LIMIT, type ClauseInput, type ClauseResult } from '@/lib/clauseEngine'

const base: ClauseInput = {
  market: 'TWSE', prevClose: 100, sumKnown: 0, price: 130, spreadBase: 100,
  marketAvg6: null, sectorAvg6: null,
  c2: null,
  pe: null, pbr: null, mktPe: null, mktPbr: null,
  dayVolume: null, avgVol60: null, sharesOutstanding: null,
  c3Assume: true, c4Assume: true, c5Assume: false, c6Assume: false,
}
const find = (rs: ClauseResult[], id: ClauseResult['id']) => rs.find(r => r.id === id)!

describe('id 集合與介面', () => {
  it('evalClauses 回 [1①,1②,2,3,4,5,6]，移除 11/12', () => {
    const ids = evalClauses(base).map(r => r.id)
    expect(ids).toEqual(['1①', '1②', '2', '3', '4', '5', '6'])
  })
  it('每款都有 name/lawText/badge/headerThreshold/groups', () => {
    for (const r of evalClauses(base)) {
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.lawText.length).toBeGreaterThan(0)
      expect(['safe', 'possible', 'fired']).toContain(r.badge)
      expect(typeof r.headerThreshold).toBe('string')
      expect(Array.isArray(r.groups)).toBe(true)
    }
  })
  it('summarize 只讀 fired/first（介面相容）', () => {
    const rs = evalClauses({ ...base, price: 133, marketAvg6: 10 })
    expect(summarize(rs).first).toBe(true)   // 款一①觸發
    expect(summarize(rs).any).toBe(true)
  })
})

describe('款一差幅閘 = max(全體, 同類)+20', () => {
  it('同類均值較高 → 綁定門檻被同類拉高（款一①更難觸發）', () => {
    const rs = evalClauses({ ...base, marketAvg6: 10, sectorAvg6: 50 }) // 閘=70%
    expect(find(rs, '1①').fired).toBe(false)   // price=130 僅 +30% < 70%
  })
  it('只有全體（同類 null）行為同舊版', () => {
    const rs = evalClauses({ ...base, price: 133, marketAvg6: 10, sectorAvg6: null }) // 閘=30%
    expect(find(rs, '1①').fired).toBe(true)    // +33% > max(32,30)
  })
  it('兩者皆 null → 退回純價格門檻(32%)', () => {
    expect(find(evalClauses({ ...base, price: 133 }), '1①').fired).toBe(true)   // +33% > 32
    expect(find(evalClauses({ ...base, price: 131 }), '1①').fired).toBe(false)  // +31% < 32
  })
})

describe('PE 為負/過高 → 差幅閘門不採計同類（不適用類股規定）', () => {
  // marketAvg6=10、sectorAvg6=50：含同類閘=70%(需+70%→170)；剔除同類後閘=max(32,30)=32%(需>32%→132.5)
  const hiSector = { ...base, price: 135, marketAvg6: 10, sectorAvg6: 50 }  // +35%
  it('PE 正常(<門檻) → 同類計入，閘=70% → 款一①不觸發', () => {
    expect(find(evalClauses({ ...hiSector, pe: 30 }), '1①').fired).toBe(false)
  })
  it('PE ≥ 門檻(上市60) → 剔除同類，閘退回32% → 款一①觸發', () => {
    expect(find(evalClauses({ ...hiSector, pe: 70 }), '1①').fired).toBe(true)
  })
  it('PE 為負(虧損) → 剔除同類 → 款一①觸發', () => {
    expect(find(evalClauses({ ...hiSector, pe: -5 }), '1①').fired).toBe(true)
  })
  it('PE 缺值(null) → 不排除同類（保守），閘=70% → 不觸發', () => {
    expect(find(evalClauses({ ...hiSector, pe: null }), '1①').fired).toBe(false)
  })
  it('剔除同類時，差幅子列 note 標示「不適用類股規定」', () => {
    const r = find(evalClauses({ ...hiSector, pe: 70 }), '1①')
    const diff = r.groups[0].subs.find(s => s.label === '差幅')!
    expect(diff.note).toContain('不適用類股規定')
  })
  it('款三/款四 共用同一閘 → PE≥門檻時亦剔除同類', () => {
    // 款三需價達標(+門檻%)且量達標；此處只驗證價格門檻(t3)因剔除同類而下降
    const inc = { ...hiSector, pe: 70, avgVol60: 1000, dayVolume: 5000, c3Assume: true }
    const exc = { ...hiSector, pe: 30, avgVol60: 1000, dayVolume: 5000, c3Assume: true }
    expect(find(evalClauses(inc), '3').fired).toBe(true)    // 閘32%→價達標 → 觸發
    expect(find(evalClauses(exc), '3').fired).toBe(false)   // 閘70%→價未達標
  })
  it('sectorAppliesForPe / SECTOR_PE_LIMIT 對拍門檻(上市60/上櫃65)', () => {
    expect(SECTOR_PE_LIMIT).toEqual({ TWSE: 60, TPEx: 65 })
    expect(sectorAppliesForPe('TWSE', 59.9)).toBe(true)
    expect(sectorAppliesForPe('TWSE', 60)).toBe(false)
    expect(sectorAppliesForPe('TPEx', 64.9)).toBe(true)
    expect(sectorAppliesForPe('TPEx', 65)).toBe(false)
    expect(sectorAppliesForPe('TWSE', -0.1)).toBe(false)
    expect(sectorAppliesForPe('TWSE', null)).toBe(true)
  })
})

describe('款三 量能：量 ≥ 5×近60日均量（張）', () => {
  // price=130(+30%>25%) 已過第一條件；avgVol60=1000張 → 門檻 5000張
  const over = { ...base, price: 130, avgVol60: 1000 }
  it('量達標且 c3Assume 開 → 觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 5000 }), '3').fired).toBe(true)
  })
  it('量達標但 c3Assume 關 → 不觸發、blocked', () => {
    const r = find(evalClauses({ ...over, dayVolume: 5000, c3Assume: false }), '3')
    expect(r.fired).toBe(false); expect(r.blocked).toBe(true)
  })
  it('量未達 → 不觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 4999 }), '3').fired).toBe(false)
  })
  it('量 < 500 張除外', () => {
    const r = find(evalClauses({ ...over, dayVolume: 400, avgVol60: 50 }), '3') // 門檻250張，但<500張除外
    expect(r.fired).toBe(false)
    expect(r.exclusions?.some(e => e.label.includes('500') && e.status === 'met')).toBe(true)
  })
  it('headerThreshold 含量門檻張數', () => {
    expect(find(evalClauses(over), '3').headerThreshold).toContain('5,000張')
  })
})

describe('款四 週轉率：量 ≥ 門檻%×發行張數', () => {
  // 上市 10%；發行 1,000,000 張 → 門檻 100,000 張
  const over = { ...base, price: 130, sharesOutstanding: 1_000_000 }
  it('量達標且 c4Assume 開 → 觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 100_000 }), '4').fired).toBe(true)
  })
  it('量未達 → 不觸發', () => {
    expect(find(evalClauses({ ...over, dayVolume: 99_999 }), '4').fired).toBe(false)
  })
  it('上櫃門檻 5%', () => {
    const r = evalClauses({ ...over, market: 'TPEx', dayVolume: 50_000 })
    expect(find(r, '4').fired).toBe(true)   // 0.05×1,000,000 = 50,000
  })
  it('headerThreshold 含發行推導量門檻', () => {
    expect(find(evalClauses(over), '4').headerThreshold).toContain('100,000張')
  })
})

describe('款六 四項 AND（修正既有 OR bug）', () => {
  // PE/PBR 皆異常 + 量達項三 + c6Assume(項四) 才觸發
  const all = {
    ...base, price: 130, pe: 200, pbr: 12, mktPe: 20, mktPbr: 2,
    sharesOutstanding: 1_000_000, dayVolume: 100_000, c6Assume: true,
  }
  it('四項齊備 → 觸發', () => {
    expect(find(evalClauses(all), '6').fired).toBe(true)
  })
  it('只有 PE 異常、PBR 正常 → 不觸發（AND）', () => {
    expect(find(evalClauses({ ...all, pbr: 1 }), '6').fired).toBe(false)
  })
  it('項四假設關 → 不觸發、blocked', () => {
    const r = find(evalClauses({ ...all, c6Assume: false }), '6')
    expect(r.fired).toBe(false); expect(r.blocked).toBe(true)
  })
  it('量未達項三 → 不觸發', () => {
    expect(find(evalClauses({ ...all, dayVolume: 100 }), '6').fired).toBe(false)
  })
})

describe('款一② 起迄價差雙底（累積 >25% 且 起迄價差 ≥50元）', () => {
  // prevClose=500,sumKnown=0,spreadBase=500（TWSE）：①門檻≈661；②門檻=max(626,550)=626
  it('累積介於 25~32% 且價差≥50元 → 款一②觸發、款一①不觸發', () => {
    const rs = evalClauses({ ...base, prevClose: 500, sumKnown: 0, spreadBase: 500, price: 630 })
    expect(find(rs, '1②').fired).toBe(true)   // 累積26% ≥25、價差130 ≥50、價<①門檻661
    expect(find(rs, '1①').fired).toBe(false)
  })
  it('累積未達 25%（雖價差≥50）→ 款一②不觸發（max 雙底）', () => {
    const rs = evalClauses({ ...base, prevClose: 500, sumKnown: 0, spreadBase: 500, price: 620 })
    expect(find(rs, '1②').fired).toBe(false)  // 累積24% < 25%，未過②門檻626
  })
  it('起迄價差群組顯示為達標', () => {
    const r = find(evalClauses({ ...base, prevClose: 500, sumKnown: 0, spreadBase: 500, price: 630 }), '1②')
    const gap = r.groups.find(g => g.title === '起迄價差')!
    expect(gap.status).toBe('met')   // 130 元 ≥ 50 元
  })
})

describe('款二 中長期窗口', () => {
  it('窗口達標且未豁免 → 觸發、headerThreshold 含百分比', () => {
    const r = find(evalClauses({ ...base, c2: { window: 60, pct: 140, exempt: false } }), '2')
    expect(r.fired).toBe(true)
    expect(r.headerThreshold).toContain('140.0%')
  })
  it('防重複豁免 → 不觸發、badge safe', () => {
    const r = find(evalClauses({ ...base, c2: { window: 60, pct: 140, exempt: true } }), '2')
    expect(r.fired).toBe(false)
    expect(r.badge).toBe('safe')
  })
  it('無窗口資料 → 不觸發、headerThreshold 標示、groups 空', () => {
    const r = find(evalClauses(base), '2')   // base.c2 = null
    expect(r.fired).toBe(false)
    expect(r.headerThreshold).toContain('無中長期窗口資料')
    expect(r.groups.length).toBe(0)
  })
})

describe('款五 券商集中（次要假設 + 差幅拉高門檻）', () => {
  it('價達標 + c5Assume 開 → 觸發', () => {
    expect(find(evalClauses({ ...base, price: 130, c5Assume: true }), '5').fired).toBe(true)
  })
  it('價達標但 c5Assume 關 → 不觸發、blocked', () => {
    const r = find(evalClauses({ ...base, price: 130, c5Assume: false }), '5')
    expect(r.fired).toBe(false)
    expect(r.blocked).toBe(true)
  })
  it('價未達門檻 → safe、不 blocked', () => {
    const r = find(evalClauses({ ...base, price: 120, c5Assume: true }), '5')
    expect(r.fired).toBe(false)
    expect(r.blocked).toBe(false)
    expect(r.badge).toBe('safe')
  })
  it('差幅閘拉高門檻（marketAvg6=50 → 閘=70%）→ price 130 不達標', () => {
    const r = find(evalClauses({ ...base, price: 130, marketAvg6: 50, c5Assume: true }), '5')
    expect(r.fired).toBe(false)   // effCum 25%→70%，t3 由 ~125.5 拉高至 ~170.5
  })
})

describe('對拍 attstock 黃金值（量門檻）', () => {
  // 國巨 2327：發行 2,071,465,484 股 = 2,071,465.484 張；上市款四 10% → 207,146.55 張 → 顯示 207,147 張
  it('款四 0.1×發行張數 = 207,147 張（對拍 attstock）', () => {
    const r = evalClauses({ ...base, price: 130, sharesOutstanding: 2_071_465.484 })
    expect(find(r, '4').headerThreshold).toContain('207,147張')
  })
  it('款四 量達 207,147 張即觸發、206,000 張不觸發', () => {
    const inp = { ...base, price: 130, sharesOutstanding: 2_071_465.484, c4Assume: true }
    expect(find(evalClauses({ ...inp, dayVolume: 207_147 }), '4').fired).toBe(true)
    expect(find(evalClauses({ ...inp, dayVolume: 206_000 }), '4').fired).toBe(false)
  })
  it('款三 5×近60日均量公式（均量 48,873.4 張 → 244,367 張）', () => {
    const r = evalClauses({ ...base, price: 130, avgVol60: 48_873.4 })
    expect(find(r, '3').headerThreshold).toContain('244,367張')
  })
  it('另一種算法對拍：量門檻/發行張數 = 門檻週轉率%', () => {
    const shares = 2_071_465.484, thLot = 0.10 * shares
    expect(thLot / shares * 100).toBeCloseTo(10, 6) // 反推回 10%
  })
})

describe('priceFloor / gateText 欄位', () => {
  it('款三/四/五 priceFloor = t3(125.5)；款二/六 priceFloor = null', () => {
    const rs = evalClauses({ ...base, price: 130 })
    expect(find(rs, '3').priceFloor).toBe(125.5)
    expect(find(rs, '4').priceFloor).toBe(125.5)
    expect(find(rs, '5').priceFloor).toBe(125.5)
    expect(find(rs, '2').priceFloor).toBeNull()
    expect(find(rs, '6').priceFloor).toBeNull()
  })
  it('款三 價已達(possible) → gateText 顯示量門檻', () => {
    const r = find(evalClauses({ ...base, price: 130, avgVol60: 1000 }), '3')
    expect(r.gateText).toContain('量 ≥ 5,000張')
  })
  it('款三 價未達 → gateText 顯示價格缺口（再漲 %）', () => {
    const r = find(evalClauses({ ...base, price: 120, avgVol60: 1000 }), '3')
    expect(r.gateText).toContain('收盤 ≥ 125.5')
    expect(r.gateText).toContain('再漲 +4.6%')
  })
  it('款六 gateText 顯示量門檻 max(5%×發行,3000) = 50,000張', () => {
    const r = find(evalClauses({ ...base, price: 130, sharesOutstanding: 1_000_000, pe: 200, pbr: 12, mktPe: 20, mktPbr: 2 }), '6')
    expect(r.gateText).toContain('量 ≥ 50,000張')
  })
  it('款二 gateText 固定「當日需收紅」', () => {
    const r = find(evalClauses({ ...base, c2: { window: 60, pct: 140, exempt: false } }), '2')
    expect(r.gateText).toBe('當日需收紅')
  })
})
