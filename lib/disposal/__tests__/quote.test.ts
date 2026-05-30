// lib/disposal/__tests__/quote.test.ts
import { describe, it, expect } from 'vitest'
import { parseMisQuote, misExCh } from '@/lib/disposal/quote'

// 真實 MIS getStockInfo 回應節錄（2026-05-29 盤後快照；2330 上市、6488 上櫃）
const MIS_FIXTURE = {
  msgArray: [
    { '@': '2330.tw', tv: '50967', v: '85969', o: '2340.0000', h: '2375.0000', l: '2330.0000', u: '2520.0000', w: '2070.0000', y: '2295.0000', z: '2355.0000', d: '20260529', t: '13:30:00', c: '2330', n: '台積電', ex: 'tse' },
    { '@': '6488.tw', v: '10755', o: '1015.0000', h: '1015.0000', l: '990.0000', u: '1015.0000', w: '835.0000', y: '927.0000', z: '1015.0000', d: '20260529', t: '13:30:00', c: '6488', n: '環球晶', ex: 'otc' },
  ],
  rtcode: '0000',
  userDelay: 5000,
  rtmessage: 'OK',
  queryTime: { sysDate: '20260530' },
}

describe('parseMisQuote', () => {
  it('解析上市台積電 2330（z/o/y/h/l/u/w、量張×1000＝股、日期格式化）', () => {
    const q = parseMisQuote(MIS_FIXTURE, '2330')
    expect(q).not.toBeNull()
    expect(q!.source).toBe('mis')
    expect(q!.market).toBe('TWSE')
    expect(q!.code).toBe('2330')
    expect(q!.name).toBe('台積電')
    expect(q!.price).toBe(2355)       // z 最新成交價
    expect(q!.open).toBe(2340)        // o 當日開盤
    expect(q!.high).toBe(2375)
    expect(q!.low).toBe(2330)
    expect(q!.prevClose).toBe(2295)   // y 昨收
    expect(q!.limitUp).toBe(2520)     // u 漲停
    expect(q!.limitDown).toBe(2070)   // w 跌停
    expect(q!.volShares).toBe(85969000)  // 85969 張 × 1000 = 股
    expect(q!.date).toBe('2026-05-29')
    expect(q!.time).toBe('13:30:00')
  })

  it('解析上櫃環球晶 6488（ex=otc → TPEx；量張×1000）', () => {
    const q = parseMisQuote(MIS_FIXTURE, '6488')
    expect(q!.market).toBe('TPEx')
    expect(q!.price).toBe(1015)
    expect(q!.prevClose).toBe(927)
    expect(q!.volShares).toBe(10755000)
  })

  it('查無代號回 null', () => {
    expect(parseMisQuote(MIS_FIXTURE, '9999')).toBeNull()
  })

  it('z 為「-」(尚無成交) → price=null 但其餘欄位仍解析', () => {
    const noTrade = { msgArray: [{ c: '1234', ex: 'tse', z: '-', o: '100.0000', y: '99.0000', v: '0', d: '20260530', t: '09:00:05', n: '測試' }] }
    const q = parseMisQuote(noTrade, '1234')
    expect(q!.price).toBeNull()
    expect(q!.open).toBe(100)
    expect(q!.prevClose).toBe(99)
    expect(q!.volShares).toBe(0)
  })

  it('msgArray 缺失/空/非物件回 null', () => {
    expect(parseMisQuote({ rtcode: '5001', rtmessage: 'no data' }, '2330')).toBeNull()
    expect(parseMisQuote({ msgArray: [] }, '2330')).toBeNull()
    expect(parseMisQuote(null, '2330')).toBeNull()
  })
})

describe('misExCh', () => {
  it('上市→tse_、上櫃→otc_', () => {
    expect(misExCh('TWSE', '2330')).toBe('tse_2330.tw')
    expect(misExCh('TPEx', '6488')).toBe('otc_6488.tw')
  })
})
