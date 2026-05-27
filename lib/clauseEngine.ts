export type Market = 'TWSE' | 'TPEx'
export type ClauseId = '1①' | '1②' | '2' | '3' | '6' | '11' | '12'
export interface ClauseResult { id: ClauseId; fired: boolean; first: boolean; detail: string; blocked?: boolean }

const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }

const tickOf = (p: number) => p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5
const nextTick = (p: number) => { const t = tickOf(p); let k = Math.ceil(p / t) * t; if (k <= p + 1e-9) k += t; return +k.toFixed(2) }
const clTick   = (p: number) => { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2) }

const PCT = {
  TWSE: { c1a: 32, c1b: 25, c3: 25, gap: 50, c2: [100, 130, 160] as const, sbl11: 100, sblStep: 500, sblAdd: 25, pe: 60, pbr: 6, sblRate: 12, sblAmp: 5, c2dup: 25 },
  TPEx: { c1a: 30, c1b: 23, c3: 27, gap: 40, c2: [100, 140, 160] as const, sbl11: 70,  sblStep: 300, sblAdd: 15, pe: 65, pbr: 4, sblRate: 9,  sblAmp: 4, c2dup: 27 },
}

export interface ClauseInput {
  market: Market
  prevClose: number
  sumKnown: number
  price: number
  spreadBase: number
  marketAvg6: number | null
  c2: { window: number; pct: number; exempt: boolean } | null
  volMet: boolean
  pe: number | null; pbr: number | null; mktPe: number | null; mktPbr: number | null
  c6Assume: boolean
  sblRate: number | null; sblAmp: number | null
  c12Assume: boolean
}

const priceForCum = (prevClose: number, sumKnown: number, x: number) => prevClose * (1 + (x - sumKnown) / 100)
const cumOf = (inp: ClauseInput) => inp.sumKnown + trunc2(inp.prevClose > 0 ? (inp.price - inp.prevClose) / inp.prevClose * 100 : 0)

export function gap11(market: Market, price: number): number {
  const m = PCT[market]
  return m.sbl11 + Math.floor(price / m.sblStep) * m.sblAdd
}

function c1(inp: ClauseInput): ClauseResult[] {
  const m = PCT[inp.market]
  const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity
  const t1 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c1a, diff)))
  const t2 = Math.max(nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c1b, diff))), clTick(inp.spreadBase + m.gap))
  const cum = cumOf(inp)
  const f1 = inp.price >= t1, f2 = !f1 && inp.price >= t2
  return [
    { id: '1①', fired: f1, first: f1, detail: `累積${cum.toFixed(2)}% ≥門檻${t1}` },
    { id: '1②', fired: f2, first: f2, detail: `累積${cum.toFixed(2)}%+價差 ≥門檻${t2}` },
  ]
}
function c2(inp: ClauseInput): ClauseResult {
  const hit = inp.c2 && inp.c2.pct > 0 && !inp.c2.exempt
  return { id: '2', fired: !!hit, first: false, detail: inp.c2 ? `${inp.c2.window}日 ${inp.c2.pct.toFixed(1)}%${inp.c2.exempt ? '(豁免)' : ''}` : '無資料' }
}
function c3(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity
  const t3 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c3, diff)))
  const fired = inp.volMet && inp.price >= t3
  return { id: '3', fired, first: false, detail: `價≥${t3} 且當日量達標` }
}
function c11(inp: ClauseInput): ClauseResult {
  const g = gap11(inp.market, inp.price)
  const spread = inp.price - inp.spreadBase
  const fired = spread >= g
  return { id: '11', fired, first: false, detail: `起迄價差 ${spread.toFixed(2)} ≥${g}元` }
}
function c6(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const peHit  = inp.pe  != null && inp.pe  >= m.pe  && (inp.mktPe  == null || inp.pe  > inp.mktPe  * 2)
  const pbrHit = inp.pbr != null && inp.pbr >= m.pbr && (inp.mktPbr == null || inp.pbr > inp.mktPbr * 2)
  const priceHit = peHit || pbrHit
  const fired = priceHit && inp.c6Assume
  return { id: '6', fired, first: false, blocked: !inp.c6Assume && priceHit, detail: `PE${inp.pe?.toFixed(1) ?? '—'}/PBR${inp.pbr?.toFixed(2) ?? '—'} ${priceHit ? '達標(需當日週轉/券商)' : '未達'}` }
}
function c12(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const rateHit = inp.sblRate != null && inp.sblRate > m.sblRate
  const ampHit  = inp.sblAmp  != null && inp.sblAmp  >= m.sblAmp
  const known = rateHit && ampHit
  const fired = known && inp.c12Assume
  return { id: '12', fired, first: false, blocked: known && !inp.c12Assume, detail: `借券率${inp.sblRate?.toFixed(2) ?? '—'}% 放大${inp.sblAmp?.toFixed(1) ?? '—'}×` }
}

export function evalClauses(inp: ClauseInput): ClauseResult[] {
  return [...c1(inp), c2(inp), c3(inp), c6(inp), c11(inp), c12(inp)]
}
export function summarize(rs: ClauseResult[]): { first: boolean; any: boolean } {
  return { first: rs.some(r => r.first && r.fired), any: rs.some(r => r.fired) }
}
