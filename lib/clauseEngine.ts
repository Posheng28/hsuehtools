// lib/clauseEngine.ts — 注意條件引擎（款一~六），純函式可單測。
// 量/股數單位一律「張」(1 張 = 1000 股)；UI 層負責 股→張 換算後傳入。
export type Market = 'TWSE' | 'TPEx'
type ClauseId = '1①' | '1②' | '2' | '3' | '4' | '5' | '6'

export type CondStatus = 'met' | 'possible' | 'safe' | 'assumed' | 'raised' // 已達/可能/無風險/假設/拉高門檻
export interface SubCond { label: string; threshold: string; current?: string; status: CondStatus; note?: string }
export interface CondGroup { title: string; threshold: string; status: CondStatus; subs: SubCond[] }
export interface ClauseResult {
  id: ClauseId
  name: string
  lawText: string
  fired: boolean
  first: boolean
  badge: 'safe' | 'possible' | 'fired'
  headerThreshold: string
  priceFloor: number | null   // 觸發所需收盤價下限；款二/六無價格門檻為 null
  gateText: string            // 單行摘要用：最關鍵剩餘門檻（缺口）
  groups: CondGroup[]
  exclusions?: { label: string; status: 'met' | 'unimpl' | 'na' }[]
  blocked?: boolean
}

const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }
const tickOf = (p: number) => p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5
const nextTick = (p: number) => { const t = tickOf(p); let k = Math.ceil(p / t) * t; if (k <= p + 1e-9) k += t; return +k.toFixed(2) }
const clTick   = (p: number) => { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2) }
const fmtLot = (n: number) => Math.round(n).toLocaleString('en-US')
// 由現價漲到 target 的百分比（target > cur 時為正）— 摘要行「再漲 X%」缺口
const upPct = (target: number, cur: number) => cur > 0 ? (target / cur - 1) * 100 : 0

const PCT = {
  TWSE: { c1a: 32, c1b: 25, c3: 25, gap: 50, c2: [100, 130, 160] as const, pe: 60, pbr: 6, c2dup: 25,
    volMult: 5, volWin: 60, volMagDiff: 4, volMinLot: 500, turnoverFloor: 0.1,
    turnover: 10, turnoverDiff: 5, brokerConc: 25, brokerBranchAdd: 1, brokerConcCap: 35, brokerMinLot: 500,
    c6Turnover: 5, c6MinLot: 3000, c6PbrMult: 4 },
  TPEx: { c1a: 30, c1b: 23, c3: 27, gap: 40, c2: [100, 140, 160] as const, pe: 65, pbr: 4, c2dup: 27,
    volMult: 5, volWin: 60, volMagDiff: 4, volMinLot: 300, turnoverFloor: 1,
    turnover: 5, turnoverDiff: 3, brokerConc: 20, brokerBranchAdd: 1, brokerConcCap: 30, brokerMinLot: 300,
    c6Turnover: 5, c6MinLot: 2000, c6PbrMult: 2 },
}

// 類股規定 PE 門檻：個股 PE 為負(虧損)或 ≥ 此倍數(上市60/上櫃65) → 差幅閘門「不採計同類均值」，僅看全體。
// （法規：本益比為負數或過高者，不適用同類股漲跌幅比較規定。）
export const SECTOR_PE_LIMIT: Record<Market, number> = { TWSE: PCT.TWSE.pe, TPEx: PCT.TPEx.pe }
export const sectorAppliesForPe = (market: Market, pe: number | null): boolean =>
  !(pe != null && (pe < 0 || pe >= PCT[market].pe))

export interface ClauseInput {
  market: Market
  prevClose: number
  sumKnown: number
  price: number
  spreadBase: number
  marketAvg6: number | null
  sectorAvg6: number | null
  c2: { window: number; pct: number; exempt: boolean } | null
  pe: number | null; pbr: number | null; mktPe: number | null; mktPbr: number | null
  dayVolume: number | null          // 當日/盤中累積量（張）
  avgVol60: number | null           // 近 60 日均量（張）
  sharesOutstanding: number | null  // 發行（張）
  c3Assume: boolean   // 款三「放大倍數與全體差≥4倍」假設成立
  c4Assume: boolean   // 款四「週轉率與全體差≥5%」假設成立
  c5Assume: boolean   // 款五 券商集中度（非公開）假設達標
  c6Assume: boolean   // 款六 項四（三選一，非公開）假設達標
}

const diffGate = (m: number | null, s: number | null): number => {
  const xs = [m, s].filter((x): x is number => x != null)
  // 兩者皆 null → 回 -Infinity，使 effCum(max(base, gate)) 退回純 base 門檻（載重邏輯，勿改）
  return xs.length ? Math.max(...xs) + 20 : -Infinity
}
const priceForCum = (prevClose: number, sumKnown: number, x: number) => prevClose * (1 + (x - sumKnown) / 100)
const cumAt = (inp: ClauseInput, p: number) => inp.sumKnown + trunc2(inp.prevClose > 0 ? (p - inp.prevClose) / inp.prevClose * 100 : 0)
const cumOf = (inp: ClauseInput) => cumAt(inp, inp.price)
// 類股規定不適用時（PE 為負/過高）→ 差幅閘門剔除同類均值，僅看全體（與 exC1/c4 的 PE 除外條件一致）
const effSector = (inp: ClauseInput): number | null => sectorAppliesForPe(inp.market, inp.pe) ? inp.sectorAvg6 : null
const effCum = (inp: ClauseInput, base: number) => Math.max(base, diffGate(inp.marketAvg6, effSector(inp)))
const t3Of   = (inp: ClauseInput) => nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, PCT[inp.market].c3)))

// 差幅閘門子列（顯示「門檻base%→eff%」拉高門檻）；同類是否計入依 PE 而定
function diffSub(inp: ClauseInput, base: number): SubCond {
  const eff = effCum(inp, base)
  const sectorOn = effSector(inp) != null
  return { label: '差幅', threshold: `門檻${base}%→${eff.toFixed(2)}%`, status: 'raised',
    note: sectorOn ? '需超出全體及同類均值 20% 以上' : '需超出全體均值 20% 以上（PE 異常，不適用類股規定）' }
}
// 漲跌幅（第一條件）群組 — 款三/四/五 共用
function priceGroup(inp: ClauseInput, t: number, base: number): CondGroup {
  const met = inp.price >= t
  return {
    title: '漲跌幅', threshold: `收盤 ≥ ${t}`, status: met ? 'met' : 'possible',
    subs: [
      { label: '6日累積漲跌', threshold: `≥ ${effCum(inp, base).toFixed(2)}%`, current: `${cumOf(inp).toFixed(2)}%`, status: met ? 'met' : 'possible' },
      diffSub(inp, base),
    ],
  }
}
function exC1(inp: ClauseInput): ClauseResult['exclusions'] {
  const m = PCT[inp.market]
  return [
    { label: 'IPO 無漲跌幅期間不計', status: 'unimpl' },
    { label: '除權息等非交易因素', status: 'unimpl' },
    { label: '收盤 < 5 元不適用', status: inp.price < 5 ? 'met' : 'na' },
    { label: '同類 < 5 種不適用類股規定', status: inp.sectorAvg6 == null ? 'met' : 'na' },
    { label: `PE 負或 ≥${m.pe}倍不適用類股規定`, status: (inp.pe != null && (inp.pe < 0 || inp.pe >= m.pe)) ? 'met' : 'na' },
    { label: '前一營業日溢/折價 ≤10%', status: 'unimpl' },
    { label: '認購售權證特例（普通股 N/A）', status: 'na' },
  ]
}

function c1(inp: ClauseInput): ClauseResult[] {
  const m = PCT[inp.market]
  const t1 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, m.c1a)))
  const t2 = Math.max(nextTick(priceForCum(inp.prevClose, inp.sumKnown, effCum(inp, m.c1b))), clTick(inp.spreadBase + m.gap))
  const f1 = inp.price >= t1, f2 = !f1 && inp.price >= t2
  const spread = inp.price - inp.spreadBase
  const r1: ClauseResult = {
    id: '1①', name: '累積漲跌幅異常', lawText: `6 日累積漲跌 > ${m.c1a}% 且差幅 ≥20%`,
    fired: f1, first: f1, badge: f1 ? 'fired' : 'safe',
    headerThreshold: `收盤 ≥ ${t1}`,
    priceFloor: t1, gateText: `收盤 ≥ ${t1}`,
    groups: [priceGroup(inp, t1, m.c1a)], exclusions: exC1(inp),
  }
  const r2: ClauseResult = {
    id: '1②', name: '累積漲跌幅異常（含起迄價差）', lawText: `6 日累積漲跌 > ${m.c1b}% 且差幅 ≥20% 且起迄價差 ≥ ${m.gap} 元`,
    fired: f2, first: f2, badge: f2 ? 'fired' : 'safe',
    headerThreshold: `收盤 ≥ ${t2}（含起迄價差 ≥ ${m.gap} 元）`,
    priceFloor: t2, gateText: `收盤 ≥ ${t2}（起迄價差 ≥ ${m.gap} 元）`,
    groups: [
      priceGroup(inp, t2, m.c1b),
      { title: '起迄價差', threshold: `≥ ${m.gap} 元`, status: spread >= m.gap ? 'met' : 'possible',
        subs: [{ label: '起迄價差', threshold: `≥ ${m.gap} 元`, current: `${spread.toFixed(2)} 元`, status: spread >= m.gap ? 'met' : 'possible' }] },
    ],
    exclusions: exC1(inp),
  }
  return [r1, r2]
}

function c2(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  // c2.pct > 0 代表上游（DisposalTool.clause2ForEngine）已判定該視窗超過門檻；此處僅組裝顯示與 fired
  const hit = !!(inp.c2 && inp.c2.pct > 0 && !inp.c2.exempt)
  return {
    id: '2', name: '中長期漲跌異常',
    lawText: `30日 > ${m.c2[0]}% / 60日 > ${m.c2[1]}% / 90日 > ${m.c2[2]}%，且收盤須高於(漲)/低於(跌)當日開盤參考價`,
    // 顯示為「可能觸發」(badge=possible)：法規另需「收盤>開盤參考價」差幅條件，工具無開盤價無法驗證；
    // fired 仍為 hit，沙盤模擬計數（summarize 讀 fired）照算價格面達標日，不受此顯示調整影響。
    fired: hit, first: false, badge: hit ? 'possible' : 'safe',
    headerThreshold: inp.c2 ? `${inp.c2.window}日累積 ${inp.c2.pct.toFixed(1)}%${inp.c2.exempt ? '（防重複豁免）' : ''}` : '無中長期窗口資料',
    priceFloor: null, gateText: '當日需收紅',
    groups: inp.c2 ? [{
      title: '中長期窗口', threshold: `${inp.c2.window} 日 > 視窗門檻`, status: inp.c2.exempt ? 'safe' : 'possible',
      subs: [
        { label: `${inp.c2.window}日累積漲跌`, threshold: '> 視窗門檻', current: `${inp.c2.pct.toFixed(1)}%`, status: inp.c2.pct > 0 ? 'possible' : 'safe' },
        { label: '防重複豁免', threshold: `近30日已公布注意且 6 日累積 ≤ ${m.c2dup}% 則豁免`, status: inp.c2.exempt ? 'safe' : 'met', note: inp.c2.exempt ? '豁免成立 → 不適用' : '未豁免' },
      ],
    }] : [],
  }
}

function c3(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const volThresh = inp.avgVol60 != null ? m.volMult * inp.avgVol60 : null
  const volMet = inp.dayVolume != null && volThresh != null && inp.dayVolume >= volThresh
  const excluded = inp.dayVolume != null && inp.dayVolume < m.volMinLot
  const fired = priceMet && volMet && inp.c3Assume && !excluded
  const blocked = priceMet && volMet && !inp.c3Assume && !excluded
  const volGroup: CondGroup = {
    title: '量能', threshold: volThresh != null ? `量 ≥ ${m.volMult}×近${m.volWin}日均量 = ${fmtLot(volThresh)}張` : `量 ≥ ${m.volMult}×近${m.volWin}日均量`,
    status: volMet ? 'met' : 'possible',
    subs: [
      { label: '基本門檻', threshold: `${m.volMult} 倍`, status: volMet ? 'met' : 'possible',
        current: inp.dayVolume != null && volThresh != null ? `目前 ${fmtLot(inp.dayVolume)}張 / 門檻 ${fmtLot(volThresh)}張` : undefined },
      { label: `放大倍數與全體差 ≥ ${m.volMagDiff} 倍`, threshold: '次要條件', status: inp.c3Assume ? 'assumed' : 'safe', note: '全市場量均值未算，假設成立' },
      { label: `參考：近${m.volWin}日均量`, threshold: inp.avgVol60 != null ? `${fmtLot(inp.avgVol60)}張` : '—', status: 'met' },
    ],
  }
  return {
    id: '3', name: '漲跌異常 + 量能放大',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 當日量 ≥ ${m.volMult}×近${m.volWin}日均量（放大倍數與全體差 ≥ ${m.volMagDiff} 倍）`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: volThresh != null ? `收盤 ≥ ${t3} 且 量 ≥ ${fmtLot(volThresh)}張` : `收盤 ≥ ${t3} 且 量達標`,
    priceFloor: t3,
    gateText: priceMet
      ? (volThresh != null ? `量 ≥ ${fmtLot(volThresh)}張` : '量達標')
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
    groups: [priceGroup(inp, t3, m.c3), volGroup],
    exclusions: [
      { label: `當日量 < ${m.volMinLot}張 不適用`, status: excluded ? 'met' : 'na' },
      { label: `週轉率 < ${m.turnoverFloor}% 不適用`, status: 'unimpl' },
    ],
  }
}

function c4(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const turnoverLot = inp.sharesOutstanding != null ? (m.turnover / 100) * inp.sharesOutstanding : null
  const volMet = inp.dayVolume != null && turnoverLot != null && inp.dayVolume >= turnoverLot
  const fired = priceMet && volMet && inp.c4Assume
  const blocked = priceMet && volMet && !inp.c4Assume
  const curTurnover = inp.dayVolume != null && inp.sharesOutstanding != null && inp.sharesOutstanding > 0 ? inp.dayVolume / inp.sharesOutstanding * 100 : null
  const turnGroup: CondGroup = {
    title: '週轉率', threshold: turnoverLot != null ? `週轉率 ≥ ${m.turnover}%（≈ ${fmtLot(turnoverLot)}張）` : `週轉率 ≥ ${m.turnover}%`,
    status: volMet ? 'met' : 'possible',
    subs: [
      { label: '基本門檻', threshold: `≥ ${m.turnover}%`, status: volMet ? 'met' : 'possible',
        current: inp.dayVolume != null && turnoverLot != null ? `目前 ${fmtLot(inp.dayVolume)}張 / 門檻 ${fmtLot(turnoverLot)}張${curTurnover != null ? `（${curTurnover.toFixed(2)}%）` : ''}` : undefined },
      { label: `差幅條件（與全體差 ≥ ${m.turnoverDiff}%）`, threshold: '次要條件', status: inp.c4Assume ? 'assumed' : 'safe', note: '全市場週轉率均值未算，假設成立' },
      { label: '參考：發行張數', threshold: inp.sharesOutstanding != null ? `${fmtLot(inp.sharesOutstanding)}張` : '—', status: 'met' },
    ],
  }
  return {
    id: '4', name: '漲跌異常 + 高週轉',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 當日週轉率 ≥ ${m.turnover}%（與全體差 ≥ ${m.turnoverDiff}%）`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: turnoverLot != null ? `收盤 ≥ ${t3} 且 量 ≥ ${fmtLot(turnoverLot)}張` : `收盤 ≥ ${t3} 且 週轉率 ≥ ${m.turnover}%`,
    priceFloor: t3,
    gateText: priceMet
      ? (turnoverLot != null ? `量 ≥ ${fmtLot(turnoverLot)}張` : `週轉率 ≥ ${m.turnover}%`)
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
    groups: [priceGroup(inp, t3, m.c3), turnGroup],
    exclusions: [
      { label: '同類 < 5 種不適用', status: inp.sectorAvg6 == null ? 'met' : 'na' },
      { label: `PE 負或 ≥${m.pe}倍不適用`, status: (inp.pe != null && (inp.pe < 0 || inp.pe >= m.pe)) ? 'met' : 'na' },
    ],
  }
}

function c5(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market], t3 = t3Of(inp)
  const priceMet = inp.price >= t3
  const fired = priceMet && inp.c5Assume
  const blocked = priceMet && !inp.c5Assume
  return {
    id: '5', name: '漲跌異常 + 券商集中',
    lawText: `6 日累積漲跌 > ${m.c3}% 且差幅 ≥20% 且 單一券商受託買賣集中度 > ${m.brokerConc}%（每分支 +${m.brokerBranchAdd}%，上限 ${m.brokerConcCap}%）且 > ${m.brokerMinLot}張`,
    fired, first: false, blocked, badge: fired ? 'fired' : priceMet ? 'possible' : 'safe',
    headerThreshold: `收盤 ≥ ${t3}（且券商佔比 > ${m.brokerConc}%）`,
    priceFloor: t3,
    gateText: priceMet
      ? `券商佔比 > ${m.brokerConc}%`
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
    groups: [
      priceGroup(inp, t3, m.c3),
      { title: '券商集中', threshold: `集中度 > ${m.brokerConc}%（非公開）`, status: inp.c5Assume ? 'assumed' : 'safe',
        subs: [{ label: '券商分點集中度', threshold: `> ${m.brokerConc}% 且 > ${m.brokerMinLot}張`, status: inp.c5Assume ? 'assumed' : 'safe', note: '券商分點全量無公開 API，假設達標' }] },
    ],
  }
}

function c6(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const peHit  = inp.pe  != null && (inp.pe < 0 || (inp.pe >= m.pe && (inp.mktPe == null || inp.pe > inp.mktPe * 2)))
  const pbrHit = inp.pbr != null && inp.pbr >= m.pbr && (inp.mktPbr == null || inp.pbr > inp.mktPbr * 2)
  const c6VolLot = inp.sharesOutstanding != null ? Math.max((m.c6Turnover / 100) * inp.sharesOutstanding, m.c6MinLot) : null
  const turn3Met = inp.dayVolume != null && c6VolLot != null && inp.dayVolume >= c6VolLot
  const priceHit = peHit && pbrHit && turn3Met
  const fired = priceHit && inp.c6Assume
  const blocked = priceHit && !inp.c6Assume
  return {
    id: '6', name: '本益比 / 股價淨值比異常',
    lawText: `當日同時：PE 負或 ≥${m.pe}倍(且>全體×2)、PBR ≥${m.pbr}倍(且>全體×2)、週轉率 ≥${m.c6Turnover}% 且量 ≥${m.c6MinLot}張、四項之一(產業PBR×${m.c6PbrMult}/券商或投資人集中)`,
    fired, first: false, blocked, badge: fired ? 'fired' : (peHit && pbrHit) ? 'possible' : 'safe',
    headerThreshold: (peHit && pbrHit) ? `PE ${inp.pe?.toFixed(1) ?? '—'} / PBR ${inp.pbr?.toFixed(2) ?? '—'} 等四項` : '不會觸發',
    priceFloor: null,
    gateText: c6VolLot != null ? `量 ≥ ${fmtLot(c6VolLot)}張` : `量 ≥ ${m.c6MinLot}張`,
    groups: [
      { title: '項一 本益比', threshold: `PE 負 或 ≥${m.pe}倍且 >全體×2`, status: peHit ? 'met' : 'safe',
        subs: [{ label: 'PE', threshold: `<0 或 ≥${m.pe}（>全體均值×2）`, current: inp.pe != null ? inp.pe.toFixed(1) : '—', status: peHit ? 'met' : 'safe', note: inp.mktPe != null ? `全體中位數 ${inp.mktPe.toFixed(1)}` : undefined }] },
      { title: '項二 股價淨值比', threshold: `PBR ≥${m.pbr}倍且 >全體×2`, status: pbrHit ? 'met' : 'safe',
        subs: [{ label: 'PBR', threshold: `≥${m.pbr}（>全體均值×2）`, current: inp.pbr != null ? inp.pbr.toFixed(2) : '—', status: pbrHit ? 'met' : 'safe', note: inp.mktPbr != null ? `全體中位數 ${inp.mktPbr.toFixed(2)}` : undefined }] },
      { title: '項三 週轉率 + 量', threshold: c6VolLot != null ? `週轉率 ≥${m.c6Turnover}% 且 量 ≥ ${fmtLot(c6VolLot)}張` : `週轉率 ≥${m.c6Turnover}% 且 量 ≥${m.c6MinLot}張`, status: turn3Met ? 'met' : 'possible',
        subs: [{ label: '量', threshold: c6VolLot != null ? `≥ ${fmtLot(c6VolLot)}張` : `≥ ${m.c6MinLot}張`, current: inp.dayVolume != null ? `${fmtLot(inp.dayVolume)}張` : undefined, status: turn3Met ? 'met' : 'possible' }] },
      { title: '項四 三選一', threshold: `產業PBR×${m.c6PbrMult} / 券商或投資人集中 ≥10% 且 ≥1億`, status: inp.c6Assume ? 'assumed' : 'safe',
        subs: [{ label: '三選一', threshold: '多為非公開 / 缺產業PBR', status: inp.c6Assume ? 'assumed' : 'safe', note: '假設達標' }] },
    ],
    exclusions: [
      { label: 'IPO 無漲跌幅期間不計', status: 'unimpl' },
      { label: '非普通股不適用（本工具僅普通股）', status: 'na' },
      { label: '鉅額交易扣除（項三 / 項四(2)(3)）', status: 'unimpl' },
    ],
  }
}

export function evalClauses(inp: ClauseInput): ClauseResult[] {
  return [...c1(inp), c2(inp), c3(inp), c4(inp), c5(inp), c6(inp)]
}
export function summarize(rs: ClauseResult[]): { first: boolean; any: boolean } {
  return { first: rs.some(r => r.first && r.fired), any: rs.some(r => r.fired) }
}
