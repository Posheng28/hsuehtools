'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { evalClauses, summarize, sectorAppliesForPe, SECTOR_PE_LIMIT, type ClauseResult } from '@/lib/clauseEngine'
import AttentionDetailPanel from '@/components/disposal/AttentionDetailPanel'

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface DayEntry   { baseDateStr: string; bp: number }
interface PastNotice { id: number; dateStr: string; level: 1 | 2 }
interface ImportStatus {
  loading:   boolean
  stockName?: string
  noticeCount?: number
  sources?: string[]
  disposalDate?: string   // auto-fetched last disposal start date
  error?: string
}
interface DisposalListItem {
  code: string; name: string; startDate: string; endDate?: string; source: 'TWSE' | 'TPEx'
}
interface Props { sidebarOpen: boolean; onCloseSidebar: () => void }

/* ── Constants ─────────────────────────────────────────────────────────────── */
const OFFSET = 6
// 每日漲跌% 取小數 2 位「無條件捨去(向零)」— 注意股累積漲幅的官方逐日進位法（與看盤工具一致）
const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }

/* ── 台股 tick（最小升降單位，依股價級距）─────────────────────────────────────── */
// <10:0.01　10~<50:0.05　50~<100:0.1　100~<500:0.5　500~<1000:1　≥1000:5
function tickOf(p: number): number {
  if (p < 10)   return 0.01
  if (p < 50)   return 0.05
  if (p < 100)  return 0.1
  if (p < 500)  return 0.5
  if (p < 1000) return 1
  return 5
}
const round2 = (v: number) => Math.round(v * 100) / 100
// 無條件捨去 / 進位 / 四捨五入 到該價位的 tick
const flTick   = (p: number) => { const t = tickOf(p); return round2(Math.floor(round2(p / t)) * t) }
const clTick   = (p: number) => { const t = tickOf(p); return round2(Math.ceil (round2(p / t)) * t) }
const snapTick = (p: number) => { const t = tickOf(p); return round2(Math.round(round2(p / t)) * t) }
// 剛好「超過」p 的第一個合法 tick 價（嚴格大於）
const nextTick = (p: number) => round2(flTick(p) + tickOf(p))
const lup  = (p: number) => flTick(p * 1.1)   // 漲停：×1.1 無條件捨去到 tick
const ldn  = (p: number) => clTick(p * 0.9)   // 跌停：×0.9 無條件進位到 tick
const fNum = (p: number) => {
  const r = round2(p)
  if (Number.isInteger(r))            return r.toFixed(0)
  if (Math.round(r * 10) === r * 10)  return r.toFixed(1)
  return r.toFixed(2)
}
const fmtISO  = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const fmtMMDD = (d: Date) => `${d.getMonth()+1}/${d.getDate()}`
const parseD  = (s: string) => new Date(s + 'T12:00:00')
const pctPos  = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100))

function addTD(dateStr: string, n: number): Date {
  const d = parseD(dateStr); let c = 0
  while (c < n) { d.setDate(d.getDate()+1); if (d.getDay()!==0 && d.getDay()!==6) c++ }
  return d
}
function subTD(dateStr: string, n: number): string {
  const d = parseD(dateStr); let c = 0
  while (c < n) { d.setDate(d.getDate()-1); if (d.getDay()!==0 && d.getDay()!==6) c++ }
  return fmtISO(d)
}
function tdBetween(a: string, b: string): string[] {
  const result: string[] = [], d = parseD(a), end = parseD(b)
  while (d <= end) {
    if (d.getDay()!==0 && d.getDay()!==6) result.push(fmtISO(new Date(d)))
    d.setDate(d.getDate()+1)
  }
  return result
}
// 把日期往回退到「最近的交易日」（週末 → 上週五）
function lastTD(dateStr: string): string {
  const d = parseD(dateStr)
  while (d.getDay()===0 || d.getDay()===6) d.setDate(d.getDate()-1)
  return fmtISO(d)
}
// 「下一個交易日」（嚴格往後找；週五/週末 → 下週一）— 預測目標日
function nextTD(dateStr: string): string {
  const d = parseD(dateStr)
  do { d.setDate(d.getDate()+1) } while (d.getDay()===0 || d.getDay()===6)
  return fmtISO(d)
}

const calcISO = (day: DayEntry) => fmtISO(addTD(day.baseDateStr, OFFSET))
const calcMD  = (day: DayEntry) => fmtMMDD(addTD(day.baseDateStr, OFFSET))
const baseMD  = (day: DayEntry) => fmtMMDD(parseD(day.baseDateStr))

// ── 注意門檻（第一款，6個營業日累積漲幅，依市場別）─────────────────────────────
// 款一①（純價格）：上市 超過32% / 上櫃 超過30%
// 款一②（價格+價差）：上市 超過25% 且起迄價差≥50元 / 上櫃 超過23% 且起迄價差≥40元
export type Market = 'TWSE' | 'TPEx'
// p3 = 款三（價量異常）的價格門檻：上市 超過25% / 上櫃 超過27%（量另計）
// 門檻為「累積漲跌百分比」(逐日漲跌%相加)，非收盤比值倍數。
const MARKET_PCT: Record<Market, { p1: number; p2: number; p3: number; gap: number }> = {
  TWSE: { p1: 32, p2: 25, p3: 25, gap: 50 },   // 款一①>32% 款一②>25%且價差≥50 款三>25%
  TPEx: { p1: 30, p2: 23, p3: 27, gap: 40 },   // 款一①>30% 款一②>23%且價差≥40 款三>27%
}
// 款一①② 合併：取較低門檻(先成立者)=真正會被注意的價；std=綁定標準；feasible=該價在當日漲停內可達(單日拖得到)
const mergeC1 = (t1: number, t2: number, limitUp: number): { price: number; std: '①' | '②'; feasible: boolean } => ({
  price: Math.min(t1, t2),
  std: t1 <= t2 ? '①' : '②',
  feasible: Math.min(t1, t2) <= limitUp + 1e-9,
})
// 累積漲幅採「逐日漲跌幅相加」(法規定義，非收盤/基準比值)。
// mAvgPct = 全體有價證券「已知部分」累積漲幅%（同樣相加，來自 /api/market-avg）。
// 達某累積漲幅% X 所需「計算日收盤」：sumKnown + (P/prevClose − 1)×100 = X
//   → P = prevClose × (1 + (X − sumKnown)/100)
//   sumKnown = 基準日→計算日前一交易日各日漲跌%相加（已知 5 間隔）；prevClose = 計算日前一交易日收盤。
// 差幅閘門：X 取「價格門檻%」與「全體均值+20%」較高者；mAvgPct=null 時退回純價格門檻。
// 款一②「起迄價差 ≥ gap 元」仍以收盤差計：價 ≥ 基準日收盤 bp + gap。
const thresh = (bp: number, prevClose: number, sumKnown: number, spreadBase: number, mkt: Market, mAvgPct?: number | null, sAvgPct?: number | null) => {
  const { p1, p2, p3, gap } = MARKET_PCT[mkt]
  const cands = [mAvgPct, sAvgPct].filter((x): x is number => x != null)
  const diffPct  = cands.length ? Math.max(...cands) + 20 : -Infinity   // 差幅閘門(全體/同類較高者+20%)
  const priceFor = (x: number) => prevClose * (1 + (x - sumKnown) / 100) // 達累積 x% 所需計算日收盤
  const t1 = nextTick(priceFor(Math.max(p1, diffPct)))
  const t2 = Math.max(nextTick(priceFor(Math.max(p2, diffPct))), clTick(spreadBase + gap))
  const t3 = nextTick(priceFor(Math.max(p3, diffPct)))
  return { t1, t2, t3 }
}

// ── 第二款（起迄兩營業日，長窗口倍漲）─────────────────────────────────────────
// 上市：30日>100% / 60日>130% / 90日>160%　上櫃：30日>100% / 60日>140% / 90日>160%
// 防重複豁免：最近30日內已依第一款公布注意，且最近6日累積漲幅 ≤ dupPct → 不適用
const CLAUSE2: Record<Market, { windows: [number, number][]; dupPct: number }> = {
  TWSE: { windows: [[30, 100], [60, 130], [90, 160]], dupPct: 25 },
  TPEx: { windows: [[30, 100], [60, 140], [90, 160]], dupPct: 27 },
}

interface Clause2Result {
  triggered: boolean
  window?:   number   // 觸發的窗口（30/60/90）
  pct?:      number   // 該窗口起迄漲幅 %
  sixDayPct?: number  // 最近6日累積漲幅 %
  exempt:    boolean  // 是否套用防重複豁免
}

/** 以實際匯入的歷史股價檢查第二款（差幅條件無資料，故為「價格面可能觸發」上限判斷） */
function checkClause2(
  history: { date: string; value: number }[],
  pastNotices: PastNotice[],
  mkt: Market,
): Clause2Result {
  const cfg = CLAUSE2[mkt]
  const n = history.length
  if (n < 31) return { triggered: false, exempt: false }
  const latest = history[n - 1].value

  let hit: { window: number; pct: number } | null = null
  for (const [w, thr] of cfg.windows) {           // 由短到長，取最先達標者
    if (n < w + 1) continue
    const start = history[n - w].value             // w 個營業日(含當日)的起點
    if (start <= 0) continue
    const pct = (latest - start) / start * 100
    if (pct > thr) { hit = { window: w, pct }; break }
  }
  if (!hit) return { triggered: false, exempt: false }

  // 防重複豁免
  const cutoff30 = history[Math.max(0, n - 30)].date
  const hasClause1 = pastNotices.some(p => p.level === 1 && p.dateStr >= cutoff30)
  let sixDayPct = Infinity
  if (n >= 6) {
    const s = history[n - 6].value
    if (s > 0) sixDayPct = (latest - s) / s * 100
  }
  const exempt = hasClause1 && sixDayPct <= cfg.dupPct
  return { triggered: true, window: hit.window, pct: hit.pct, sixDayPct, exempt }
}

/**
 * 「款二不豁免價」：計算日收盤達此價 → 6日累積漲幅「超過」dupPct（上市25%/上櫃27%）
 * → 防重複豁免失效，款二成立。回傳剛好超過該漲幅的第一個合法 tick 價。
 */
const clause2NoExemptPrice = (bp: number, mkt: Market) =>
  nextTick(bp * (1 + CLAUSE2[mkt].dupPct / 100))

function getDayBounds(idx: number, sp: (number|null)[], days: DayEntry[]) {
  let p = days[days.length-1]?.bp ?? 100
  for (let i = 0; i < idx; i++) { if (sp[i] === null) break; p = sp[i]! }
  return { minP: ldn(p), maxP: lup(p) }
}

function defaultDays(): DayEntry[] {
  const out: DayEntry[] = []; const d = new Date(); d.setDate(d.getDate()-1)
  while (out.length < 6) {
    if (d.getDay()!==0 && d.getDay()!==6)
      out.unshift({ baseDateStr: fmtISO(new Date(d)), bp: 100 })
    d.setDate(d.getDate()-1)
  }
  return out
}

/* ── Computation ───────────────────────────────────────────────────────────── */

/**
 * computeTriggers: 模擬是否觸發處置
 * baseReset: 最近一次處置生效日（30交易日內），若有則從此日起算，不追溯之前
 */
function computeTriggers(
  notices: { first: boolean; any: boolean }[],
  days: DayEntry[],
  pastNotices: PastNotice[],
  baseReset?: string,
) {
  const N = notices.length

  // 依 baseReset 過濾過去注意
  const filtPN = baseReset
    ? pastNotices.filter(p => p.dateStr >= baseReset)
    : pastNotices

  // 計算進入模擬前的連續 streak
  const nm0 = new Map(filtPN.map(p => [p.dateStr, p.level as 0|1|2]))
  const prior: (0|1|2)[] = []
  if (days.length) {
    const dd = parseD(calcISO(days[0]))
    for (let i = 0; i < 30; i++) {
      dd.setDate(dd.getDate()-1)
      while (dd.getDay()===0||dd.getDay()===6) dd.setDate(dd.getDate()-1)
      const ds = fmtISO(new Date(dd))
      if (baseReset && ds < baseReset) break
      const lv = nm0.get(ds) ?? 0
      if (!lv) break
      prior.unshift(lv as 0|1|2)
    }
  }

  const all = [...prior.map(l => ({ first: l === 1, any: l >= 1 })), ...notices]
  const pL = prior.length
  let c1 = 0, ca = 0, t1 = -1, t2 = -1
  for (let i = 0; i < all.length; i++) {
    const isFirst = all[i].first
    const isAny   = all[i].any
    c1 = isFirst ? c1 + 1 : 0
    ca = isAny   ? ca + 1 : 0
    const si = i - pL
    if (si >= 0) { if (t1<0 && c1>=3) t1=si; if (t2<0 && ca>=5) t2=si }
  }

  // 10日 / 30日 視窗
  const nm = new Map<string, boolean>(filtPN.map(p => [p.dateStr, true]))
  let t3 = -1, t4 = -1, lc10 = 0, lc30 = 0
  for (let i = 0; i < N; i++) {
    if (notices[i].any) nm.set(calcISO(days[i]), true)
    const lat = calcISO(days[i])
    const c10 = tdBetween(subTD(lat, 9), lat)
      .filter(d => (!baseReset || d >= baseReset) && nm.get(d) === true).length
    const c30 = tdBetween(subTD(lat, 29), lat)
      .filter(d => (!baseReset || d >= baseReset) && nm.get(d) === true).length
    lc10 = c10; lc30 = c30
    if (t3<0 && c10>=6)  t3 = i
    if (t4<0 && c30>=12) t4 = i
  }

  const cands = [
    { i: t1, r: '三連第一款' }, { i: t2, r: '五連注意' },
    { i: t3, r: '10日內6次' }, { i: t4, r: '30日內12次' },
  ].filter(x => x.i >= 0).sort((a, b) => a.i - b.i)
  const f = cands[0] || null
  return { disposed: !!f, trigIdx: f?.i ?? -1, trigReason: f?.r ?? '', c1, ca, lc10, lc30 }
}

/**
 * getRules: 計算「已確定」規則進度（用於底部計數卡）
 * 只計入真實注意紀錄（不含沙盤模擬），窗口結尾固定為最近交易日 ref。
 * resetDate: 處置生效日（confirmed），自此日起算。
 */
function getRules(
  pastNotices: PastNotice[],
  ref: string,
  resetDate?: string,
) {
  const filtPN = resetDate ? pastNotices.filter(p => p.dateStr >= resetDate) : pastNotices
  const nm = new Map(filtPN.map(p => [p.dateStr, p.level as 1 | 2]))

  // 連續 streak：從 ref「前一交易日」(=最近完成日) 往回逐個交易日（僅確定注意）
  // ref=預測日(下一交易日，盤中未收盤)，本身無確定注意，故從其前一交易日起算，不會被空的預測日打斷
  // 第一款 = level 1（歷史 level 2 = 款二～八，不計入規則①）
  let c1 = 0, ca = 0
  {
    let brokeC1 = false, brokeCa = false
    const d = parseD(ref)
    do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
    for (let i = 0; i < 60 && !(brokeC1 && brokeCa); i++) {
      const ds = fmtISO(d)
      if (resetDate && ds < resetDate) break
      const lv = nm.get(ds) ?? 0
      if (!brokeCa) { if (lv > 0)  ca++; else brokeCa = true }
      if (!brokeC1) { if (lv === 1) c1++; else brokeC1 = true }
      do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
    }
  }

  // 窗口範圍 + 窗口內確定注意日期；count = 窗口內確定注意數
  const mkWin = (n: number) => {
    let from = subTD(ref, n - 1)
    if (resetDate && from < resetDate) from = resetDate
    const confirmed = filtPN
      .filter(p => p.dateStr >= from && p.dateStr <= ref)
      .map(p => p.dateStr)
      .sort()
    return { from, to: ref, confirmed, count: confirmed.length }
  }
  const windows = { r1: mkWin(3), r2: mkWin(5), r3: mkWin(10), r4: mkWin(30) }

  return { c1, ca, c10: windows.r3.count, c30: windows.r4.count, maxC30: 12, ref, windows }
}

// 盤中（台灣時間 < 14:00）丟掉「今天」那根未定案的即時價，只用已收盤資料；收盤定案後(≥14:00)才納入
function dropUnclosedToday<T extends { date: string }>(arr: T[]): T[] {
  const tw = new Date(Date.now() + 8 * 3600 * 1000) // UTC+8 牆鐘
  const twToday = tw.toISOString().slice(0, 10)
  if (arr.length && arr[arr.length - 1].date === twToday && tw.getUTCHours() < 14) return arr.slice(0, -1)
  return arr
}

// 台股盤中時段（台灣平日 09:00–13:35；收盤 13:30 + 緩衝）→ 是否自動輪詢即時報價
function inTwMarketHours(): boolean {
  const tw = new Date(Date.now() + 8 * 3600 * 1000) // UTC+8 牆鐘
  const day = tw.getUTCDay()                          // 0=日 6=六
  if (day === 0 || day === 6) return false
  const mins = tw.getUTCHours() * 60 + tw.getUTCMinutes()
  return mins >= 9 * 60 && mins <= 13 * 60 + 35
}

/* ── Component ─────────────────────────────────────────────────────────────── */
export default function DisposalTool({ sidebarOpen, onCloseSidebar }: Props) {
  const today      = fmtISO(new Date())
  // 盤中（台股 13:30 收盤、~14:00 資料定案前）今天尚未完成 → 最近完成交易日要排除今天
  const tdClosed   = new Date().getHours() >= 14
  const todayTD    = lastTD(tdClosed ? today : fmtISO(new Date(Date.now() - 86400000)))
  const predictDay = nextTD(todayTD)      // 下一個交易日 = 預測目標日（盤中即「今天」的收盤），規則窗口結尾

  /* ── State ── */
  const [days,        setDays]        = useState<DayEntry[]>(defaultDays)
  const [simPrices,   setSimPrices]   = useState<(number|null)[]>(() => defaultDays().map(() => null))
  // 數字輸入框編輯中的原始字串（key=日索引），離開欄位才校正
  const [editStr,     setEditStr]     = useState<Record<number, string>>({})
  const [pastNotices, setPastNotices] = useState<PastNotice[]>([])
  const nextId = useRef(1)

  // 最近一次處置生效日（可手動覆蓋 or 自動匯入）
  const [lastDisposalDate, setLastDisposalDate] = useState('')

  // 市場別（決定注意門檻 %）：上市 TWSE 32/25，上櫃 TPEx 30/23
  const [market, setMarket] = useState<Market>('TWSE')

  // 完整歷史股價（供第二款 30/60/90 日窗口計算）
  const [priceHistory, setPriceHistory] = useState<{ date: string; value: number }[]>([])

  // 全體有價證券「已知部分」累積漲幅%（款一差幅 ≥ 20% 判定用），分上市/上櫃
  const [marketAvg, setMarketAvg] = useState<{
    TWSE: number | null; TPEx: number | null; baseDate?: string; lastClosedDate?: string
  }>({ TWSE: null, TPEx: null })
  // 同類/全體均值（匯入個股後，用個股實際 6 日窗口自算；排除標的本身）
  const [sectorAvg, setSectorAvg] = useState<{ sectorAvg: number | null; marketAvg: number | null; sectorCode: string | null; targetCum: number | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    // 失敗或上市/上櫃任一 avg 為 null（暫時性，如全市場資料被限流）時重試，避免卡在「載入中」
    const load = async (attempt = 0) => {
      try {
        // 帶個股最近收盤日 → 全體均值窗口與個股同步（避免盤中/延遲落後一個交易日）
        const dateYMD = todayTD.replace(/-/g, '')
        const r = await fetch(`/api/market-avg?date=${dateYMD}${attempt ? '&bust=1' : ''}`)
        const d = await r.json()
        if (cancelled) return
        if (!d.error) {
          setMarketAvg({ TWSE: d.twse?.avg ?? null, TPEx: d.tpex?.avg ?? null, baseDate: d.baseDate, lastClosedDate: d.lastClosedDate })
          if ((d.twse?.avg != null && d.tpex?.avg != null) || attempt >= 4) return // 都有值或試夠了
        }
      } catch { /* 重試 */ }
      if (!cancelled && attempt < 4) setTimeout(() => load(attempt + 1), 4000) // 4 秒後重試（最多 5 次）
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 款三：最近 60 日均量（股）
  const [avg60Vol, setAvg60Vol] = useState<number | null>(null)
  // 發行股數（股，raw）；計算日(盤中)累積量與即時價
  const [sharesOutstanding, setSharesOutstanding] = useState<number | null>(null)
  const [dayVolume, setDayVolume] = useState<number | null>(null)   // 計算日盤中累積量（股）
  const [livePrice, setLivePrice] = useState<number | null>(null)   // 計算日盤中即時價
  // 盤中自動刷新（/api/quote）：已匯入代號 + 最近一次報價 meta + 手動刷新中
  const [importedCode, setImportedCode] = useState('')
  const [quoteMeta, setQuoteMeta] = useState<{ at: number; source: 'mis' | 'yahoo'; time?: string; prevClose: number | null; open: number | null } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  // 款六：PE/PBR 資料
  const [peData, setPeData] = useState<{ pe:number|null; pbr:number|null; mktPe:number|null; mktPbr:number|null }|null>(null)

  // 殘差「次要條件假設成立」開關：款三/四 預設開（絕對門檻必綁定），款五/六 預設關（整段非公開）
  const [c3Assume, setC3Assume] = useState(true)
  const [c4Assume, setC4Assume] = useState(true)
  const [c5Assume, setC5Assume] = useState(false)
  const [clause6Assume, setClause6Assume] = useState(false)

  const [queryCode,    setQueryCode]    = useState('')
  const [importStatus, setImportStatus] = useState<ImportStatus>({ loading: false })

  // 全市場處置列表
  const [disposalList,        setDisposalList]        = useState<DisposalListItem[]>([])
  const [disposalListLoading, setDisposalListLoading] = useState(false)
  const [disposalListErr,     setDisposalListErr]     = useState('')
  const [disposalListLoaded,  setDisposalListLoaded]  = useState(false)
  const [showDisposalModal,   setShowDisposalModal]   = useState(false)
  const [showHelpModal,       setShowHelpModal]       = useState(false)

  /* ── Drag refs ── */
  const dragRef    = useRef<{ idx: number; min: number; max: number; rect: DOMRect } | null>(null)
  const sliderRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const spRef      = useRef(simPrices)
  const daysRef    = useRef(days)
  useEffect(() => { spRef.current   = simPrices }, [simPrices])
  useEffect(() => { daysRef.current = days       }, [days])

  useEffect(() => {
    setSimPrices(prev => {
      if (prev.length === days.length) return prev
      return days.map((_, i) => prev[i] ?? null)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length])

  /* ── 盤中即時報價自動刷新（/api/quote → MIS，失敗退回 Yahoo）──────────────────── */
  // 用 ref 鏡射最新值，避免 setInterval 閉包抓到過期 state
  const importedCodeRef = useRef(importedCode); importedCodeRef.current = importedCode
  const marketRef       = useRef<Market>(market); marketRef.current = market

  const refreshLive = useCallback(async (manual = false) => {
    const code = importedCodeRef.current
    if (!code) return
    if (manual) setQuoteLoading(true)
    try {
      const r = await fetch(`/api/quote?market=${marketRef.current}&code=${encodeURIComponent(code)}`, { cache: 'no-store' })
      const q = await r.json()
      if (r.ok && !q.error) {
        if (typeof q.price === 'number')     setLivePrice(q.price)       // 即時成交價
        if (typeof q.volShares === 'number') setDayVolume(q.volShares)   // 累計量（股）
        setQuoteMeta({
          at: Date.now(),
          source: q.source === 'yahoo' ? 'yahoo' : 'mis',
          time: typeof q.time === 'string' ? q.time : undefined,
          prevClose: typeof q.prevClose === 'number' ? q.prevClose : null,
          open: typeof q.open === 'number' ? q.open : null,
        })
      }
    } catch { /* 靜默：保留前一次值 */ }
    finally { if (manual) setQuoteLoading(false) }
  }, [])
  const refreshLiveRef = useRef(refreshLive); refreshLiveRef.current = refreshLive

  // 平日盤中每 30 秒輪詢一次；非盤中（收盤後/週末/未匯入）不打 API
  useEffect(() => {
    const timer = setInterval(() => { if (inTwMarketHours()) refreshLiveRef.current() }, 30000)
    return () => clearInterval(timer)
  }, [])
  // 匯入成功 / 切換標的後，若正值盤中立即抓一次即時價
  useEffect(() => {
    if (importedCode && inTwMarketHours()) refreshLiveRef.current()
  }, [importedCode])

  /* ── One-click import ────────────────────────────────────────────────────── */
  const doImport = async () => {
    const code = queryCode.trim()
    if (!code) return
    setImportStatus({ loading: true })
    setQuoteMeta(null)   // 換股 → 清掉上一檔的即時報價 meta

    try {
      const [stockRes, noticeRes, disposalRes] = await Promise.allSettled([
        fetch(`/api/stocks?ticker=${encodeURIComponent(code)}&range=1Y&bust=1`),
        fetch(`/api/notices?code=${encodeURIComponent(code)}`),
        fetch(`/api/disposal?code=${encodeURIComponent(code)}`),
      ])

      // ── Stock prices ──
      let stockOk = false
      if (stockRes.status === 'fulfilled' && stockRes.value.ok) {
        const json = await stockRes.value.json()
        if (json.market === 'TWSE' || json.market === 'TPEx') setMarket(json.market)
        if (json.data?.length > 0) {
          const raw = json.data as { date: string; value: number; volume?: number }[]
          const all = dropUnclosedToday(raw)
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          // 計算日(predictDay)盤中：從原始資料(未丟今天那根)取該日 volume(累積量,股)/value(即時價)
          {
            const bar = raw.find(b => b.date === predictDay)
            setDayVolume(typeof bar?.volume === 'number' ? bar.volume : null)
            setLivePrice(typeof bar?.value === 'number' ? bar.value : null)
          }
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({
            baseDateStr: d.date,
            bp: Math.round(d.value * 10) / 10,
          }))
          setDays(newDays)
          setSimPrices(newDays.map(() => null))
          stockOk = true
          setImportedCode(code)   // 啟用盤中即時輪詢
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款四/六：抓發行股數（股）
          fetch(`/api/shares?market=${json.market}&code=${code}`).then(r=>r.json()).then(d=>setSharesOutstanding(d.shares ?? null)).catch(()=>setSharesOutstanding(null))
          // 同類/全體均值：用近 6 日的「最近 5 個 interval 日」(= days.slice(1)) 作窗口
          {
            const winYMDs = all.slice(-5).map(d => d.date.replace(/-/g, ''))
            setSectorAvg(null)
            fetch(`/api/sectoravg?market=${json.market}&code=${code}&win=${winYMDs.join(',')}`)
              .then(r => r.json()).then(d => { if (!d.error) setSectorAvg(d) }).catch(() => setSectorAvg(null))
          }
        }
      }
      if (!stockOk) {
        setImportStatus({ loading: false, error: `找不到「${code}」的股價資料（請確認代碼是否正確）` })
        return
      }

      // ── Past notices ──
      let noticeCount = 0, stockName = '', sources: string[] = []
      if (noticeRes.status === 'fulfilled' && noticeRes.value.ok) {
        const json = await noticeRes.value.json()
        if (!json.error && Array.isArray(json.records)) {
          noticeCount = json.records.length
          stockName   = json.stockName || code
          sources     = json.sources   || []
          setPastNotices(json.records.map((r: { dateStr: string; level: 1|2 }) => ({
            id: nextId.current++, dateStr: r.dateStr, level: r.level,
          })))
        }
      }

      // ── Disposal date (auto-fill if within 30 TD) ──
      let disposalDate = ''
      if (disposalRes.status === 'fulfilled' && disposalRes.value.ok) {
        const json = await disposalRes.value.json()
        if (json.latest?.dateStr) {
          const cutoff = subTD(todayTD, 29)
          if (json.latest.dateStr >= cutoff) {
            disposalDate = json.latest.dateStr
            setLastDisposalDate(disposalDate)
          } else {
            // disposal existed but older than 30 TD → clear
            setLastDisposalDate('')
          }
        } else {
          setLastDisposalDate('')
        }
      }

      setImportStatus({ loading: false, stockName, noticeCount, sources, disposalDate })
    } catch (e) {
      setImportStatus({ loading: false, error: e instanceof Error ? e.message : '匯入失敗' })
    }
  }

  /* ── Disposal list fetch ─────────────────────────────────────────────────── */
  const fetchDisposalList = async () => {
    setShowDisposalModal(true)
    setDisposalListLoading(true)
    setDisposalListErr('')
    try {
      const res  = await fetch('/api/disposal-list')
      const json = await res.json()
      if (json.error) { setDisposalListErr(json.error); setDisposalList([]) }
      else { setDisposalList(json.records ?? []); setDisposalListLoaded(true) }
    } catch (e) {
      setDisposalListErr(e instanceof Error ? e.message : '查詢失敗')
    } finally {
      setDisposalListLoading(false)
    }
  }

  const importFromList = async (code: string) => {
    setShowDisposalModal(false)
    setQueryCode(code)
    setImportStatus({ loading: true })
    setQuoteMeta(null)   // 換股 → 清掉上一檔的即時報價 meta
    try {
      const [stockRes, noticeRes, disposalRes] = await Promise.allSettled([
        fetch(`/api/stocks?ticker=${encodeURIComponent(code)}&range=1Y&bust=1`),
        fetch(`/api/notices?code=${encodeURIComponent(code)}`),
        fetch(`/api/disposal?code=${encodeURIComponent(code)}`),
      ])
      let stockOk = false
      if (stockRes.status === 'fulfilled' && stockRes.value.ok) {
        const json = await stockRes.value.json()
        if (json.market === 'TWSE' || json.market === 'TPEx') setMarket(json.market)
        if (json.data?.length > 0) {
          const raw = json.data as { date: string; value: number; volume?: number }[]
          const all = dropUnclosedToday(raw)
          setPriceHistory(all)
          // 款三：最近 60 日均量（股）。當日為變數，用已知歷史日均量當基準
          const vols = all.slice(-60).map(d => d.volume).filter((v): v is number => typeof v === 'number' && v > 0)
          setAvg60Vol(vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null)
          {
            const bar = raw.find(b => b.date === predictDay)
            setDayVolume(typeof bar?.volume === 'number' ? bar.volume : null)
            setLivePrice(typeof bar?.value === 'number' ? bar.value : null)
          }
          const recent = all.slice(-6)
          const newDays: DayEntry[] = recent.map(d => ({ baseDateStr: d.date, bp: Math.round(d.value * 10) / 10 }))
          setDays(newDays); setSimPrices(newDays.map(() => null)); stockOk = true; setImportedCode(code)
          // 款六：抓 PE/PBR
          fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
          // 款四/六：抓發行股數（股）
          fetch(`/api/shares?market=${json.market}&code=${code}`).then(r=>r.json()).then(d=>setSharesOutstanding(d.shares ?? null)).catch(()=>setSharesOutstanding(null))
          // 同類/全體均值：用近 6 日的「最近 5 個 interval 日」(= days.slice(1)) 作窗口
          {
            const winYMDs = all.slice(-5).map(d => d.date.replace(/-/g, ''))
            setSectorAvg(null)
            fetch(`/api/sectoravg?market=${json.market}&code=${code}&win=${winYMDs.join(',')}`)
              .then(r => r.json()).then(d => { if (!d.error) setSectorAvg(d) }).catch(() => setSectorAvg(null))
          }
        }
      }
      if (!stockOk) { setImportStatus({ loading: false, error: `找不到「${code}」的股價資料` }); return }

      let noticeCount = 0, stockName = '', sources: string[] = []
      if (noticeRes.status === 'fulfilled' && noticeRes.value.ok) {
        const json = await noticeRes.value.json()
        if (!json.error && Array.isArray(json.records)) {
          noticeCount = json.records.length; stockName = json.stockName || code; sources = json.sources || []
          setPastNotices(json.records.map((r: { dateStr: string; level: 1|2 }) => ({ id: nextId.current++, dateStr: r.dateStr, level: r.level })))
        }
      }
      let disposalDate = ''
      if (disposalRes.status === 'fulfilled' && disposalRes.value.ok) {
        const json = await disposalRes.value.json()
        if (json.latest?.dateStr) {
          const cutoff = subTD(todayTD, 29)
          if (json.latest.dateStr >= cutoff) { disposalDate = json.latest.dateStr; setLastDisposalDate(disposalDate) }
          else setLastDisposalDate('')
        } else setLastDisposalDate('')
      }
      setImportStatus({ loading: false, stockName, noticeCount, sources, disposalDate })
    } catch (e) {
      setImportStatus({ loading: false, error: e instanceof Error ? e.message : '匯入失敗' })
    }
  }

  /* ── Drag ────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const move = (cx: number) => {
      if (!dragRef.current) return
      const { idx, min, max, rect } = dragRef.current
      const pct = Math.max(0, Math.min(1, (cx - rect.left) / rect.width))
      const val = snapTick(min + pct * (max - min))
      setSimPrices(prev => { const n = [...prev]; n[idx] = val; return n })
    }
    const end = () => {
      if (!dragRef.current) return
      const { idx } = dragRef.current; dragRef.current = null
      setSimPrices(prev => {
        const n = [...prev], ds = daysRef.current
        for (let j = idx+1; j < n.length; j++) {
          if (n[j] === null) break
          const { minP, maxP } = getDayBounds(j, n, ds)
          n[j] = Math.max(minP, Math.min(maxP, n[j]!))
        }
        return n
      })
    }
    const mm = (e: MouseEvent) => move(e.clientX)
    const tm = (e: TouchEvent) => { if (dragRef.current) { move(e.touches[0].clientX); e.preventDefault() } }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup',   end)
    document.addEventListener('touchmove', tm, { passive: false })
    document.addEventListener('touchend',  end)
    return () => {
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup',   end)
      document.removeEventListener('touchmove', tm)
      document.removeEventListener('touchend',  end)
    }
  }, [])

  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent, idx: number) => {
    e.preventDefault()
    const el = sliderRefs.current.get(idx); if (!el) return
    const { minP: min, maxP: max } = getDayBounds(idx, spRef.current, daysRef.current)
    dragRef.current = { idx, min, max, rect: el.getBoundingClientRect() }
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX
    const pct = Math.max(0, Math.min(1, (cx - el.getBoundingClientRect().left) / el.getBoundingClientRect().width))
    const val = snapTick(min + pct * (max - min))
    setSimPrices(prev => { const n = [...prev]; n[idx] = val; return n })
  }, [])

  /* ── Other handlers ──────────────────────────────────────────────────────── */
  const addDay = () => {
    const last = days[days.length-1]
    setDays(prev => [...prev, { baseDateStr: fmtISO(addTD(last.baseDateStr, 1)), bp: last.bp }])
    setSimPrices(prev => [...prev, null])
  }
  const removeLastDay = () => {
    if (days.length <= 1) return
    setDays(prev => prev.slice(0, -1))
    setSimPrices(prev => prev.slice(0, -1))
  }
  const resetSim = () => setSimPrices(days.map(() => null))

  // 打字時自由輸入（存原始字串），離開欄位(blur)才校正到 tick 並夾在漲跌停內
  const onNumFocus = (idx: number) => {
    const v = spRef.current[idx]
    setEditStr(prev => ({ ...prev, [idx]: v === null ? '' : fNum(v) }))
  }
  const onNumChange = (idx: number, raw: string) => {
    setEditStr(prev => ({ ...prev, [idx]: raw }))
  }
  const onNumBlur = (idx: number) => {
    const raw = editStr[idx]
    setEditStr(prev => { const n = { ...prev }; delete n[idx]; return n })
    if (raw === undefined || raw.trim() === '') return
    const parsed = parseFloat(raw)
    if (isNaN(parsed)) return
    setSimPrices(prev => {
      const n = [...prev], ds = daysRef.current
      const { minP, maxP } = getDayBounds(idx, n, ds)
      n[idx] = Math.max(minP, Math.min(maxP, snapTick(parsed)))
      // 重新夾住後續已設定的日子（前一日變動會改變漲跌停範圍）
      for (let j = idx+1; j < n.length; j++) {
        if (n[j] === null) break
        const b = getDayBounds(j, n, ds)
        n[j] = Math.max(b.minP, Math.min(b.maxP, n[j]!))
      }
      return n
    })
  }

  const addPN    = () => setPastNotices(prev => [...prev, { id: nextId.current++, dateStr: today, level: 1 }])
  const removePN = (id: number) => setPastNotices(prev => prev.filter(p => p.id !== id))
  const updatePN = (id: number, field: 'date' | 'level', val: string) =>
    setPastNotices(prev => prev.map(p => p.id !== id ? p : {
      ...p,
      dateStr: field === 'date'  ? val : p.dateStr,
      level:   field === 'level' ? parseInt(val) as 1|2 : p.level,
    }))

  /* ── Derived ─────────────────────────────────────────────────────────────── */
  const startPrice = days[days.length-1]?.bp ?? 100
  const mAvgPct = marketAvg[market]   // 當前市場別的全體已知累積漲幅%（null=未載入→純價格門檻）
  // 同類均值%（當前市場別；匯入後才有）。窗口與 mAvgPct 對齊：皆為近6日的5個interval
  const sAvgPct = sectorAvg?.sectorAvg ?? null
  // 匯入個股後，全體均值改用 sectoravg 回傳值(同窗口、排除自己)；未匯入時用 mount 載入的 marketAvg
  const mAvgEff = sectorAvg?.marketAvg ?? mAvgPct
  // 類股規定排除：個股 PE 為負(虧損)或 ≥ 門檻倍(上市60/上櫃65) → 差幅閘門「不採計同類均值」，僅看全體。
  // 用個股現值 PE(peData.pe) 判定；漲幅異常情境下更高價只會使 PE 更高，與引擎逐卡 pePredict 同向。
  const peExcludesSector = !sectorAppliesForPe(market, peData?.pe ?? null)
  const sAvgGate = peExcludesSector ? null : sAvgPct   // 進入差幅閘門計算用（排除時剔除同類）

  // 統一收盤時間軸：近 n 日實際收盤(各卡基準) ++ 模擬未來價(各卡計算日)；null→沿用前一日(持平)
  // 卡 i：基準=closePath[i]、計算日(預測)=closePath[i+OFFSET]、計算日前一日=closePath[i+OFFSET-1]
  const closePath: number[] = days.map(d => d.bp)
  for (let k = 0; k < simPrices.length; k++)
    closePath.push(simPrices[k] ?? closePath[closePath.length - 1] ?? startPrice)
  // 已知累積漲幅(各日漲跌%『取2位無條件捨去(向零)』後相加，基準日→計算日前一日，OFFSET-1=5 個間隔)
  const knownSumOf = (i: number) => {
    let s = 0
    for (let k = i; k < i + OFFSET - 1; k++) {
      const a = closePath[k], b = closePath[k + 1]
      if (a != null && b != null && a > 0) s += trunc2((b / a - 1) * 100)
    }
    return s
  }
  // 計算日前一交易日收盤（卡 0 = 最近實際收盤；卡 i>0 = 前一卡模擬價）
  const prevCloseOf = (i: number) =>
    closePath[i + OFFSET - 1] ?? closePath[closePath.length - 1] ?? startPrice
  // 起迄價差基準 = 6 日窗口「第一天」收盤（= 基準日的下一交易日；對齊 attstock 的 startPrice）
  const spreadBaseOf = (i: number) => closePath[i + 1] ?? closePath[i] ?? startPrice

  // 第二款（以實際匯入歷史股價判斷，含防重複豁免）
  const clause2 = checkClause2(priceHistory, pastNotices, market)

  // 款二橋接：把既有 checkClause2 結果轉成引擎輸入
  const clause2ForEngine = () =>
    clause2.triggered ? { window: clause2.window!, pct: clause2.pct!, exempt: clause2.exempt } : null

  // 款六：PE/PBR 依預測股價等比例縮放（最近收盤的 PE/PBR × 預測價/最近收盤）
  const lastClose = priceHistory.at(-1)?.value ?? startPrice
  const pePredict  = (price: number) => peData?.pe  != null && lastClose > 0 ? peData.pe  * price / lastClose : null
  const pbrPredict = (price: number) => peData?.pbr != null && lastClose > 0 ? peData.pbr * price / lastClose : null

  // 組裝單卡引擎輸入並評估（量/股數 股→張；款三~六僅卡 0=計算日有意義）
  const evalCard = (i: number, price: number): ClauseResult[] => evalClauses({
    market, prevClose: prevCloseOf(i), sumKnown: knownSumOf(i), price,
    spreadBase: spreadBaseOf(i),
    marketAvg6: mAvgEff,
    sectorAvg6: sAvgPct,
    c2: i === 0 ? clause2ForEngine() : null,
    pe: i === 0 ? pePredict(price) : null, pbr: i === 0 ? pbrPredict(price) : null,
    mktPe: peData?.mktPe ?? null, mktPbr: peData?.mktPbr ?? null,
    dayVolume:         i === 0 && dayVolume != null ? dayVolume / 1000 : null,                 // 股→張
    avgVol60:          i === 0 && avg60Vol != null ? avg60Vol / 1000 : null,                   // 股→張
    sharesOutstanding: i === 0 && sharesOutstanding != null ? sharesOutstanding / 1000 : null, // 股→張
    c3Assume: i === 0 && c3Assume,
    c4Assume: i === 0 && c4Assume,
    c5Assume: i === 0 && c5Assume,
    c6Assume: i === 0 && clause6Assume,
  })

  // 處置生效日是否在最近30個交易日內？（以最近交易日為基準）
  const tdCutoff30 = subTD(todayTD, 29)
  const baseReset: string | undefined =
    lastDisposalDate && lastDisposalDate >= tdCutoff30 ? lastDisposalDate : undefined

  // 模擬注意序列
  const notices: { first: boolean; any: boolean }[] = []
  for (let i = 0; i < days.length; i++) {
    if (simPrices[i] === null) break
    notices.push(summarize(evalCard(i, simPrices[i]!)))
  }

  // 模擬是否觸發處置（以 baseReset 為起算）— 用於下方「此路徑安全/觸發」結果列
  const simResult = notices.length > 0 ? computeTriggers(notices, days, pastNotices, baseReset) : null

  // 規則計數：只算「已確定」注意，窗口結尾 = 下一個交易日(預測目標)，起算用確定處置日 baseReset
  const rules = getRules(pastNotices, predictDay, baseReset)

  // 過濾後的注意記錄（sidebar 顯示用）
  // 只顯示「正在被計數」的那個窗口：有處置→從處置日起，沒有→最近30交易日
  const displayCutoff = baseReset ?? tdCutoff30
  const filteredNotices = pastNotices.filter(p => p.dateStr >= displayCutoff)

  /* ── Panel ───────────────────────────────────────────────────────────────── */
  const panel = (
    <div className="space-y-7 p-5">

      {/* ── 一鍵匯入 ── */}
      <section>
        <p className="text-sm font-bold text-gray-200 uppercase tracking-wider mb-2">📥 一鍵匯入</p>
        <p className="text-xs text-gray-500 mb-3">輸入股號，自動載入近 6 日收盤價與注意紀錄</p>
        <div className="flex gap-2">
          <input
            type="text" value={queryCode}
            placeholder="如 3581、6683…"
            onChange={e => setQueryCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doImport() }}
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500 min-w-0"
          />
          <button
            onClick={doImport}
            disabled={importStatus.loading || !queryCode.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 whitespace-nowrap transition-colors"
          >
            {importStatus.loading ? '載入中…' : '匯入'}
          </button>
        </div>

        {importStatus.loading && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span className="animate-spin">⏳</span> 抓取股價、注意紀錄、處置紀錄中…
          </div>
        )}
        {importStatus.error && (
          <div className="mt-2 p-2.5 bg-red-950/40 border border-red-700 rounded-lg text-xs text-red-300">
            ❌ {importStatus.error}
          </div>
        )}
        {!importStatus.loading && !importStatus.error && importStatus.stockName && (
          <div className="mt-2 p-3 bg-green-950/30 border border-green-700 rounded-lg text-xs space-y-1">
            <p className="text-green-300 font-semibold text-sm">
              ✅ {importStatus.stockName}（{queryCode.toUpperCase()}）
            </p>
            <p className="text-gray-400">📈 近 {days.length} 個交易日收盤價已載入</p>
            <p className="text-gray-400">
              🔔 注意紀錄：
              {importStatus.noticeCount === 0
                ? <span className="text-gray-500"> 查無</span>
                : <span className="text-yellow-400 font-semibold"> {importStatus.noticeCount} 筆</span>
              }
              {importStatus.sources && importStatus.sources.length > 0 && (
                <span className="text-gray-600 ml-1">（{importStatus.sources.join('+')}）</span>
              )}
            </p>
            {importStatus.disposalDate
              ? <p className="text-orange-300">🚨 最近處置：<b>{importStatus.disposalDate}</b> 起（已自動填入）</p>
              : <p className="text-gray-500">⚙️ 30日內查無處置紀錄，計算全部有效注意</p>
            }
          </div>
        )}
      </section>

      {/* ── 最近處置日 ── */}
      <section>
        <p className="text-sm font-bold text-gray-200 uppercase tracking-wider mb-2">🚨 最近處置生效日</p>
        <p className="text-xs text-gray-500 mb-3 leading-relaxed">
          若30交易日內有處置 → 從此日起歸零計算注意次數<br/>
          若超過30交易日或留空 → 視為未處置，滾動計算
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="date" value={lastDisposalDate}
            onChange={e => setLastDisposalDate(e.target.value)}
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-orange-500"
            style={{ colorScheme: 'dark' }}
          />
          {lastDisposalDate && (
            <button
              onClick={() => setLastDisposalDate('')}
              className="text-gray-500 hover:text-red-400 text-sm px-2 transition-colors"
              title="清除"
            >✕</button>
          )}
        </div>

        {/* 狀態說明 */}
        {baseReset ? (
          <div className="mt-2 p-2 bg-orange-950/30 border border-orange-700 rounded-lg text-xs">
            <p className="text-orange-300 font-semibold">🔄 從 {baseReset} 起算</p>
            <p className="text-gray-400 mt-0.5">
              此後注意記錄：
              <span className="text-yellow-400 font-semibold"> {filteredNotices.length} 筆</span>
              （{baseReset} ～ {today}）
            </p>
          </div>
        ) : lastDisposalDate && lastDisposalDate < tdCutoff30 ? (
          <div className="mt-2 p-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400">
            ℹ️ 處置日已超過 30 個交易日，視同未處置
          </div>
        ) : (
          <div className="mt-2 p-2 bg-gray-800/50 border border-gray-700/50 rounded-lg text-xs text-gray-500">
            ℹ️ 未設定 → 滾動計算最近 30 日內所有有效注意
          </div>
        )}
      </section>

      {/* ── 注意細節條件（取代近 6 日收盤價表格）── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">📋 近 6 日 / 計算日</p>
          <div className="flex gap-1.5">
            <button onClick={addDay}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors">＋</button>
            <button onClick={removeLastDay} disabled={days.length <= 1}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 disabled:opacity-40 transition-colors">－</button>
            <button onClick={resetSim}
              className="text-sm px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 border border-gray-700 transition-colors">重設</button>
          </div>
        </div>
        {days.length > 0 && (
          <AttentionDetailPanel
            results={evalCard(0, simPrices[0] ?? livePrice ?? startPrice)}
            calcDateLabel={calcMD(days[0])}
            statusLabel={!tdClosed && dayVolume != null ? '盤中即時' : '預估'}
            assume={{ c3: c3Assume, c4: c4Assume, c5: c5Assume, c6: clause6Assume }}
            onToggleAssume={k => {
              if (k === 'c3') setC3Assume(v => !v)
              else if (k === 'c4') setC4Assume(v => !v)
              else if (k === 'c5') setC5Assume(v => !v)
              else setClause6Assume(v => !v)
            }}
          />
        )}
      </section>

      {/* ── 過去注意記錄 ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">
            📅 正在計數的注意記錄
          </p>
          <button onClick={addPN}
            className="text-sm px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors">
            ＋ 新增
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          {baseReset
            ? <>從處置日 <b className="text-orange-300">{baseReset}</b> 後起算的記錄</>
            : <>最近 30 交易日（{tdCutoff30.slice(5)} ～ {todayTD.slice(5)}）內的記錄</>
          }
        </p>
        {filteredNotices.length === 0 ? (
          <p className="text-xs text-gray-600">
            {baseReset ? `${baseReset} 後無注意記錄` : '此窗口內查無注意記錄'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {[...filteredNotices].sort((a, b) => a.dateStr.localeCompare(b.dateStr)).map(pn => (
              <div key={pn.id} className="flex items-center gap-1.5">
                <input type="date" value={pn.dateStr}
                  onChange={e => updatePN(pn.id, 'date', e.target.value)}
                  className="flex-1 min-w-0 bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-blue-500"
                  style={{ colorScheme: 'dark' }} />
                <select value={pn.level} onChange={e => updatePN(pn.id, 'level', e.target.value)}
                  className="bg-gray-800 text-gray-300 text-xs rounded px-1.5 py-1 border border-gray-700 focus:outline-none">
                  <option value="1">第一款</option>
                  <option value="2">其他款(二~八)</option>
                </select>
                <button onClick={() => removePN(pn.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors px-1 text-base leading-none">✕</button>
              </div>
            ))}
          </div>
        )}
        {/* 窗口外的記錄數量（不計入） */}
        {pastNotices.filter(p => p.dateStr < displayCutoff).length > 0 && (
          <p className="mt-1.5 text-xs text-gray-700">
            + {pastNotices.filter(p => p.dateStr < displayCutoff).length} 筆窗口外記錄（不計入）
          </p>
        )}
      </section>
    </div>
  )

  /* ── Sim grid ────────────────────────────────────────────────────────────── */
  const grid = (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {days.map((d, i) => {
        const prevClose0      = prevCloseOf(i)
        const sumKnown        = knownSumOf(i)
        const { t1, t2 }      = thresh(d.bp, prevClose0, sumKnown, spreadBaseOf(i), market, mAvgEff, sAvgGate)
        const { minP, maxP }  = getDayBounds(i, simPrices, days)
        const chosen          = simPrices[i]
        const prevUnset       = i > 0 && simPrices[i-1] === null
        const isUnset         = chosen === null
        const dispPrice       = isUnset ? (i === 0 ? startPrice : (simPrices[i-1] ?? startPrice)) : chosen
        const rs              = isUnset ? [] : evalCard(i, chosen!)
        const firedFirst      = rs.some(r => (r.id === '1①' || r.id === '1②') && r.fired)
        const firedAny        = rs.some(r => r.fired)
        // 累積漲幅(逐日相加) = 已知 5 間隔相加 + 計算日當日漲跌%（同樣逐日 2 位無條件捨去）
        const pctChg          = (sumKnown + (prevClose0 > 0 ? trunc2((dispPrice - prevClose0) / prevClose0 * 100) : 0)).toFixed(2)
        // 日內漲幅 = 對比昨日收盤（即前一張卡的價格）
        const prevClose       = i === 0 ? startPrice : (simPrices[i-1] ?? startPrice)
        const dod             = (dispPrice - prevClose) / prevClose * 100
        const dodAbs          = dispPrice - prevClose
        const dodArrow        = dod > 0 ? '▲' : dod < 0 ? '▼' : ''
        const dodColor        = '#9ca3af'  // 中性灰（避免與卡片紅/綠的「注意/安全」語意撞色，漲跌方向用 ▲▼ 表示）
        const isTriggered     = simResult?.disposed && simResult.trigIdx === i

        const borderCls = isTriggered ? 'border-red-600 bg-red-950/30'
          : isUnset      ? 'border-gray-700 opacity-70'
          : firedFirst   ? 'border-red-500 bg-red-950/20'      // 款一①② 皆紅（第一款）
          : firedAny     ? 'border-orange-500 bg-orange-950/20' // 其他注意款（款二/三/六/十一/十二…）
          :                'border-green-600 bg-green-950/10'
        const col = isUnset ? '#6b7280' : firedFirst ? '#f87171' : firedAny ? '#fb923c' : '#4ade80'
        const pd  = pctPos(t2, minP, maxP)
        const p1  = pctPos(t1, minP, maxP)
        const thumbPct = pctPos(isUnset ? snapTick((minP+maxP)/2) : chosen!, minP, maxP)

        return (
          <div key={i} className={`border-2 rounded-xl p-3 flex flex-col gap-1.5 transition-colors ${borderCls}`}>
            <div className="text-sm font-bold text-gray-100">{calcMD(d)}</div>
            <div className="text-xs text-gray-500">基準 {fNum(d.bp)}（{baseMD(d)}）</div>

            <div className="flex gap-1 flex-wrap">
              {(() => {
                const c1 = mergeC1(t1, t2, maxP)
                return (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${c1.feasible ? 'bg-red-950/60 text-red-400 border-red-800/60' : 'bg-gray-800/60 text-gray-500 border-gray-700'}`}>
                    注意≥{fNum(c1.price)} <span className="opacity-70">標{c1.std}{!c1.feasible && ' 漲停外'}</span>
                  </span>
                )
              })()}
              <span title={`達此價→6日漲幅破 ${CLAUSE2[market].dupPct}%→款二防重複豁免失效`}
                className="text-xs px-1.5 py-0.5 rounded bg-yellow-950/60 text-yellow-500 border border-yellow-800/60">
                款二解豁≥{fNum(clause2NoExemptPrice(d.bp, market))}
              </span>
            </div>

            <div className="flex items-baseline gap-1.5">
              <input
                type="number"
                value={editStr[i] !== undefined ? editStr[i] : (isUnset ? fNum(dispPrice) : fNum(chosen!))}
                step={tickOf(dispPrice)} min={minP} max={maxP} disabled={prevUnset}
                onFocus={() => onNumFocus(i)}
                onChange={e => onNumChange(i, e.target.value)}
                onBlur={() => onNumBlur(i)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="flex-1 min-w-0 text-right text-2xl font-extrabold bg-transparent border-b-2 border-transparent focus:outline-none focus:border-blue-500 focus:bg-blue-950/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                style={{ color: col }}
              />
              {!isUnset && (
                <span className="shrink-0 text-xs font-bold leading-tight" style={{ color: dodColor }}>
                  {dodArrow}{fNum(Math.abs(dodAbs))} ({Math.abs(dod).toFixed(2)}%)
                </span>
              )}
            </div>

            <div className="text-xs font-medium" style={{ color: col }}>
              {isUnset ? '' : `累積 ${parseFloat(pctChg) > 0 ? '+' : ''}${pctChg}%`}
            </div>

            {i === 0 && (
              <details className="mt-1 text-xs border-l-2 border-gray-700 pl-2">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-300 select-none">差幅閘門（{peExcludesSector ? '僅全體 ≥20%・PE 異常排除同類' : '須全體＆同類皆 ≥20%'}）</summary>
                <div className="space-y-0.5 mt-1">
                {[
                  { label: `全體${market === 'TWSE' ? '上市' : '上櫃'}`, avg: mAvgEff, excluded: false },
                  { label: `同類${sectorAvg?.sectorCode ?? ''}`, avg: sAvgPct, excluded: peExcludesSector },
                ].map(({ label, avg, excluded }) => {
                  const d = sectorAvg?.targetCum != null && avg != null ? sectorAvg.targetCum - avg : null
                  return (
                    <p key={label} className={`flex items-center gap-1.5 ${excluded ? 'opacity-50' : ''}`}>
                      <span className="text-gray-400 w-14">{label}</span>
                      <span className={`w-16 text-right ${excluded ? 'text-gray-500 line-through' : (avg ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>{avg != null ? `${avg > 0 ? '+' : ''}${avg.toFixed(2)}%` : '—'}</span>
                      {excluded ? <span className="text-sky-400">不適用</span> : d != null && (
                        <span className={d >= 20 ? 'text-amber-400' : 'text-gray-500'}>差幅 {d.toFixed(1)}% {d >= 20 ? '✓' : '✗'}</span>
                      )}
                    </p>
                  )
                })}
                </div>
              </details>
            )}

            <div className="min-h-[22px] flex items-center gap-1.5 flex-wrap">
              {isUnset ? <span className="text-xs text-gray-600">未設定</span> : (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full border
                  ${firedFirst ? 'bg-red-900/50 text-red-300 border-red-700'
                  : firedAny  ? 'bg-orange-900/50 text-orange-300 border-orange-700'
                  :              'bg-green-900/50 text-green-300 border-green-700'}`}>
                  {firedFirst
                    ? '🔴 第一款'
                    : firedAny
                    ? `🟠 注意(款${rs.filter(r => r.fired).map(r => r.id).join('/')})`
                    : '🟢 無注意'}
                </span>
              )}
              {isTriggered && <span className="text-xs text-red-400 font-bold">⚠️ 觸發</span>}
            </div>

            {/* Slider */}
            <div
              ref={el => { if (el) sliderRefs.current.set(i, el); else sliderRefs.current.delete(i) }}
              className={`relative h-10 mt-1 rounded select-none touch-none
                ${prevUnset ? 'opacity-30 pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
              onMouseDown={e => startDrag(e, i)} onTouchStart={e => startDrag(e, i)}
            >
              {/* 綠/紅界線 = 款一①② 取較低者(先成立者) = 注意觸發價 */}
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2.5 rounded-full pointer-events-none"
                style={{ background: `linear-gradient(to right,#22c55e ${Math.min(pd, p1)}%,#ef4444 ${Math.min(pd, p1)}%,#ef4444 100%)` }} />
              {/* 注意觸發線（款一①② 較低者） */}
              <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-6 rounded pointer-events-none"
                style={{ left: `${Math.min(pd, p1)}%`, background: '#ef4444' }} />
              <div className="absolute pointer-events-none text-[10px] text-red-400 font-semibold whitespace-nowrap"
                style={{ left: `${Math.min(pd, p1)}%`, top: 'calc(50% + 10px)', transform: 'translateX(-50%)' }}>注意{fNum(Math.min(t1, t2))}</div>
              <div className="absolute top-1/2 w-6 h-6 rounded-full bg-white border-[3px] border-blue-400 pointer-events-none shadow-lg -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${thumbPct}%` }} />
            </div>

            <div className="flex justify-between text-xs mt-4">
              <span className="text-green-500">↓跌停 {fNum(minP)}</span>
              <span className="text-red-400">漲停↑ {fNum(maxP)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )

  /* ── Rules status ─────────────────────────────────────────────────────────── */
  const rulesGrid = (
    <div className="space-y-2 mt-3">
      <div className="text-sm text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>📊 以下為「已確定注意紀錄」的處置進度（不含沙盤模擬），窗口結尾 = 下一個交易日 <b className="text-gray-200">{rules.ref.slice(5)}</b>（預測目標）</span>
      </div>
      {baseReset && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-orange-950/40 border border-orange-700 rounded-lg text-sm text-orange-300">
          <span className="text-base">🔄</span>
          <span>從 <b>{baseReset}</b> 起算（處置生效日）</span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: '規則①', desc: '連3日第一款',  cur: rules.c1,  max: 3,  win: rules.windows.r1, consec: true },
          { label: '規則②', desc: '連5日任意注意', cur: rules.ca,  max: 5,  win: rules.windows.r2, consec: true },
          { label: '規則③', desc: '10日內≥6次',  cur: rules.c10, max: 6,  win: rules.windows.r3, consec: false },
          { label: '規則④', desc: '30日內≥12次', cur: rules.c30, max: 12, win: rules.windows.r4, consec: false },
        ]).map(r => {
          const done  = r.cur >= r.max
          const close = !done && r.cur >= r.max - 1
          const col   = done ? 'text-red-400' : close ? 'text-yellow-400' : 'text-green-400'
          const bg    = done ? 'bg-red-950/40 border-red-700'
            : close ? 'bg-yellow-950/40 border-yellow-700'
            : 'bg-green-950/20 border-green-800'
          const md = (s: string) => fmtMMDD(parseD(s))
          return (
            <div key={r.label} className={`border rounded-xl p-3 text-center ${bg}`}>
              <div className="text-xs text-blue-400 font-bold mb-0.5">{r.label}</div>
              <div className="text-xs text-gray-500 mb-1">{r.desc}</div>
              <div className={`text-2xl font-extrabold ${col}`}>
                {r.cur}<span className="text-sm text-gray-500 font-normal"> / {r.max}</span>
              </div>
              <div className={`text-xs font-semibold mt-0.5 ${col}`}>
                {done ? '❌ 觸發' : close ? '⚠️ 警告' : '✓ 安全'}
              </div>
              <details className="mt-1.5 pt-1.5 border-t border-gray-700/50">
                <summary className="cursor-pointer text-[10px] text-gray-500 hover:text-gray-300 select-none">明細</summary>
                {r.consec ? (
                  // 連續規則：連續計數，中間任一(已完成)交易日無注意即歸零
                  <div className="text-[10px] text-gray-500 mt-1">
                    連續計數·中斷即歸零（截至 {md(rules.ref)} 前一完成交易日）
                  </div>
                ) : (
                  // 窗口規則：數窗口內筆數
                  <>
                    <div className="text-[10px] text-gray-500 mt-1">
                      窗口 {md(r.win.from)}~{md(r.win.to)}
                    </div>
                    <div className="text-[10px] mt-0.5">
                      {r.win.confirmed.length > 0
                        ? <span className="text-yellow-500">已含 {r.win.confirmed.length} 確定：{r.win.confirmed.map(md).join('、')}</span>
                        : <span className="text-gray-600">無確定注意</span>}
                    </div>
                  </>
                )}
              </details>
            </div>
          )
        })}
      </div>
    </div>
  )

  /* ── 答案卡（hero）：答案優先，細節收進 <details> ─────────────────────────────── */
  const heroCard = (() => {
    const focusDay = days[0]
    if (!focusDay) return null
    const prevClose0  = prevCloseOf(0)
    const sumKnown    = knownSumOf(0)
    const spreadBase0 = spreadBaseOf(0)
    const { t1, t2 }  = thresh(focusDay.bp, prevClose0, sumKnown, spreadBase0, market, mAvgEff, sAvgGate)
    const { maxP }    = getDayBounds(0, simPrices, days)
    const c1          = mergeC1(t1, t2, maxP)
    const chosen0     = simPrices[0]
    const simulated   = chosen0 != null
    const curPrice    = simulated ? chosen0! : prevClose0
    const { p1, p2, gap } = MARKET_PCT[market]
    const gateVals    = [mAvgEff, sAvgGate].filter((x): x is number => x != null)
    const gate        = gateVals.length ? Math.max(...gateVals) + 20 : null
    const eff1        = gate != null ? Math.max(p1, gate) : p1
    const eff2        = gate != null ? Math.max(p2, gate) : p2
    const cum         = sumKnown + (prevClose0 > 0 ? trunc2((curPrice - prevClose0) / prevClose0 * 100) : 0)
    const spread      = curPrice - spreadBase0
    const toNotice    = c1.price - curPrice
    const stockName   = importStatus.stockName
    const mktLabel    = market === 'TWSE' ? '上市' : '上櫃'

    // 「卡在哪一條」：款一①(漲幅) 與 款一②(起迄價差) 擇一顯示——
    // 取「注意門檻較低（觸發價較低＝最容易先被注意）」的那一條；即使另一條未達，
    // 仍可能因這條先被注意。與上方答案的注意線一致（c1.std = argmin(①門檻價, ②門檻價)）。
    const rowC1a = { id: '款一①', desc: '6 日累積漲幅',
      cur: `${cum > 0 ? '+' : ''}${cum.toFixed(2)}%`, need: `${eff1.toFixed(2)}%`,
      remain: cum >= eff1 - 1e-9 ? null : `還差 ${(eff1 - cum).toFixed(2)}%`,
      trig: t1, fired: cum >= eff1 - 1e-9 }
    const rowC1b = { id: '款一②', desc: `起迄價差（另需累積 ≥ ${eff2.toFixed(0)}%）`,
      cur: `${fNum(spread)} 元`, need: `${gap} 元`,
      remain: spread >= gap - 1e-9 ? null : `還差 ${fNum(gap - spread)} 元`,
      trig: t2, fired: curPrice >= t2 - 1e-9 }
    const rows = [c1.std === '①' ? rowC1a : rowC1b]

    const distChips: [string, number, number][] = [
      ['①連3日第一款', rules.c1, 3], ['②連5日注意', rules.ca, 5],
      ['③10日6次', rules.c10, 6], ['④30日12次', rules.c30, 12],
    ]

    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
        {/* 識別 + 計算日 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {stockName && <span className="text-base font-bold text-gray-100">{stockName}{queryCode ? `（${queryCode.toUpperCase()}）` : ''}</span>}
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${market === 'TWSE' ? 'bg-blue-950 text-blue-400 border border-blue-800' : 'bg-purple-950 text-purple-400 border border-purple-800'}`}>
            {mktLabel} {market === 'TWSE' ? '32/25%' : '30/23%'}
          </span>
          <span className="text-gray-200 font-bold">📅 {calcMD(focusDay)} 計算日</span>
          <span className="text-gray-500 text-sm">基準 {baseMD(focusDay)} / {fNum(focusDay.bp)}</span>
          {/* 盤中即時報價狀態 + 立即刷新 */}
          <div className="ml-auto flex items-center gap-2">
            {quoteMeta && (
              <span className="text-[11px] text-gray-400 whitespace-nowrap">
                <span className={quoteMeta.source === 'mis' ? 'text-emerald-400' : 'text-amber-400'}>
                  {quoteMeta.source === 'mis' ? '盤中即時' : '延遲報價'}
                </span>
                <span className="text-gray-600"> · {quoteMeta.source === 'mis' && quoteMeta.time ? quoteMeta.time : new Date(quoteMeta.at).toLocaleTimeString('zh-TW', { hour12: false })} 更新</span>
              </span>
            )}
            <button
              onClick={() => refreshLive(true)}
              disabled={quoteLoading || !importedCode}
              title="立即抓取證交所 MIS 即時報價（失敗退回 Yahoo）"
              className="text-[11px] px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 disabled:opacity-40 transition-colors">
              {quoteLoading ? '刷新中…' : '🔄 立即刷新'}
            </button>
          </div>
        </div>

        {/* 答案：現價 → 注意線 */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-gray-800 pt-3">
          <span className="text-gray-400 text-sm">{simulated ? '模擬現價' : '最近收盤'}</span>
          <span className="text-2xl font-extrabold text-gray-100">{fNum(curPrice)}</span>
          <span className="text-gray-600 text-xl">→</span>
          <span className="text-gray-400 text-sm">⚠️ 注意線</span>
          <span className={`text-2xl font-extrabold ${c1.feasible ? 'text-red-400' : 'text-gray-500'}`}>{fNum(c1.price)}</span>
          <span className="text-xs text-gray-500">款一{c1.std}</span>
          {toNotice > 1e-9
            ? <span className="text-amber-400 text-sm font-semibold">離現價 +{fNum(toNotice)} 元</span>
            : <span className="text-red-400 text-sm font-semibold">已突破注意線</span>}
          {!c1.feasible && <span className="text-xs text-gray-500">（漲停 {fNum(maxP)} 外，單日拖不到）</span>}
        </div>

        {/* 為什麼是這條注意線：款一①/② 取較低者 + 款二為獨立維度 */}
        <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-800 pt-3">
          注意線取
          <b className="text-gray-300"> 款一①</b>（漲到 {fNum(t1)}，使 6 日累積漲幅達 {eff1.toFixed(0)}%）與
          <b className="text-gray-300"> 款一②</b>（漲到 {fNum(t2)}，使起迄價差達 {gap} 元且累積≥{eff2.toFixed(0)}%）
          <b> 兩者較低者</b> → 款一{c1.std} <b className="text-red-300">{fNum(c1.price)}</b> 會先被列注意。
          <span className="block mt-0.5 text-gray-600">
            款二是<b className="text-gray-400">另一條獨立</b>的線：30/60/90 日長期漲幅達 100%+ 就可能被注意，<b className="text-gray-400">與今日這 6 日窗口的價格無關</b>。
          </span>
        </p>

        {/* 卡在哪一條 */}
        <div className="space-y-1 border-t border-gray-800 pt-3">
          <div className="text-xs text-gray-500 mb-1">卡在哪一條（距現價由近到遠）</div>
          {rows.map((r, idx) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className={`font-semibold w-16 ${r.fired ? 'text-red-400' : 'text-gray-200'}`}>{r.id}</span>
              <span className="text-gray-400 flex-1 min-w-[8rem]">{r.desc}</span>
              <span className="font-mono text-gray-300">{r.cur}<span className="text-gray-600"> / {r.need}</span></span>
              {r.remain
                ? <span className="text-amber-400 text-xs whitespace-nowrap">{r.remain}</span>
                : <span className="text-red-400 text-xs whitespace-nowrap">已達</span>}
              <span className="text-gray-500 text-xs whitespace-nowrap">觸發 ≥ {fNum(r.trig)}</span>
              {idx === 0 && !r.fired && <span className="text-amber-400 text-xs">◀ 最近</span>}
            </div>
          ))}
          {clause2.triggered && (
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className={`font-semibold w-16 ${clause2.exempt ? 'text-sky-400' : 'text-yellow-400'}`}>款二</span>
              <span className="text-gray-400 flex-1 min-w-[8rem]">長期起迄倍漲（不同維度）</span>
              <span className="font-mono text-gray-300">{clause2.window}日 {clause2.pct?.toFixed(1)}%</span>
              <span className={`text-xs whitespace-nowrap ${clause2.exempt ? 'text-sky-400' : 'text-yellow-400'}`}>{clause2.exempt ? '已豁免' : '可能觸發'}</span>
              {!clause2.exempt && <span className="text-[11px] text-gray-500 whitespace-nowrap">· 另需當日收紅</span>}
            </div>
          )}
        </div>

        {/* 處置距離 */}
        <div className="flex flex-wrap gap-2 border-t border-gray-800 pt-3">
          {distChips.map(([label, cur, max]) => {
            const done = cur >= max, close = !done && cur >= max - 1
            const col = done ? 'text-red-300 border-red-700 bg-red-950/40'
              : close ? 'text-yellow-300 border-yellow-700 bg-yellow-950/30'
              : 'text-gray-400 border-gray-700 bg-gray-800/40'
            return (
              <span key={label} className={`text-xs px-2 py-1 rounded-lg border ${col}`}>
                {label} <b className="font-mono">{cur}/{max}</b>
              </span>
            )
          })}
        </div>

        {/* 差幅閘門明細（預設收合） */}
        <details className="border-t border-gray-800 pt-2">
          <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-200 select-none">
            📊 差幅閘門明細（款一①②・款三共用判定基底）
          </summary>
          <div className="mt-2 space-y-1 border-l-2 border-gray-700 pl-3">
            <div className="text-xs text-gray-500">
              近 6 日{marketAvg.baseDate && marketAvg.lastClosedDate ? `（${marketAvg.baseDate.slice(4, 6)}/${marketAvg.baseDate.slice(6)}→${marketAvg.lastClosedDate.slice(4, 6)}/${marketAvg.lastClosedDate.slice(6)}）` : ''}・已知 5 間隔，當日（第 6 間隔）以 0% 計
            </div>
            {(mAvgEff != null || sAvgPct != null) ? (() => {
              const hi    = gateVals.length ? Math.max(...gateVals) : null
              const peVal = peData?.pe ?? null
              const detailRows = [
                { label: `全體${mktLabel}均值`, v: mAvgEff, excluded: false },
                { label: `同類均值${sectorAvg?.sectorCode ? `（類${sectorAvg.sectorCode}）` : ''}`, v: sAvgPct, excluded: peExcludesSector },
              ]
              return (
                <>
                  {detailRows.map(({ label, v, excluded }) => (
                    <div key={label} className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className={`w-32 ${excluded ? 'text-gray-500 line-through' : 'text-gray-400'}`}>{label}</span>
                      {v != null ? (
                        excluded ? (
                          <>
                            <b className="w-16 text-right text-gray-500 line-through">{v > 0 ? '+' : ''}{v.toFixed(2)}%</b>
                            <span className="text-xs text-sky-400">
                              PE {peVal != null ? peVal.toFixed(1) : '—'} {peVal != null && peVal < 0 ? '為負' : `≥ ${SECTOR_PE_LIMIT[market]}`} → 不適用類股規定
                            </span>
                          </>
                        ) : (
                          <>
                            <b className={`w-16 text-right ${v >= 0 ? 'text-red-400' : 'text-green-400'}`}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</b>
                            <span className="text-gray-600">＋20%＝</span>
                            <b className="text-orange-300">{(v + 20).toFixed(2)}%</b>
                            {v === hi && <span className="text-xs text-orange-400">← 取較高者為門檻</span>}
                          </>
                        )
                      ) : <span className="text-gray-500 text-xs animate-pulse">載入中…</span>}
                    </div>
                  ))}
                  <div className="border-t border-gray-800/60 pt-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="text-gray-300">⇒ 差幅閘門下限</span>
                      {gate != null ? <b className="text-orange-300 text-base">{gate.toFixed(2)}%</b> : <span className="text-gray-500 text-xs animate-pulse">載入中…</span>}
                      <span className="text-xs text-gray-500">（個股 6 日累積漲幅須對{peExcludesSector ? '全體' : '全體＆同類'}均值 ≥ 20%）</span>
                    </div>
                    {gate != null && (() => {
                      const { p1: q1, p2: q2, p3: q3, gap: qg } = MARKET_PCT[market]
                      const e1 = Math.max(q1, gate), e2 = Math.max(q2, gate), e3 = Math.max(q3, gate)
                      const binding = gate > Math.min(q1, q2, q3)
                      return (
                        <div className="text-xs text-gray-500 leading-relaxed">
                          <span className="text-gray-400">實際注意門檻 ＝ max(各款基本漲幅%, 閘門 {gate.toFixed(2)}%)：</span>
                          {' '}款一①<b className="text-gray-300">{e1.toFixed(2)}%</b>・款一②<b className="text-gray-300">{e2.toFixed(2)}%</b>+起迄價差≥{qg}元・款三<b className="text-gray-300">{e3.toFixed(2)}%</b>
                          {binding
                            ? <span className="text-orange-400 block">　↑ 閘門已高於部分款別基本%，成為其實際門檻</span>
                            : <span className="block">　↑ 閘門 {gate.toFixed(2)}% 低於各款基本%，<b className="text-gray-400">目前不具拘束力</b>；故「累積漲幅超過閘門」≠ 會被注意——仍須達上方注意線價格才成立</span>}
                        </div>
                      )
                    })()}
                  </div>
                </>
              )
            })() : (
              <span className="text-gray-500 text-sm animate-pulse">全體均值載入中…</span>
            )}
          </div>
        </details>
      </div>
    )
  })()

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={onCloseSidebar} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-[30rem] max-w-[90vw] bg-gray-900 border-r border-gray-800 overflow-y-auto
        transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0 lg:shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-center justify-between z-10">
          <p className="text-sm font-bold text-gray-200 uppercase tracking-wider">注意 / 處置推演</p>
          <button onClick={onCloseSidebar} className="lg:hidden text-gray-500 hover:text-gray-200 text-xl leading-none">✕</button>
        </div>
        {panel}
      </aside>

      {/* Main */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="p-4 space-y-4">

          {/* ── 全市場處置中股票（觸發列）── */}
          <div className="rounded-xl border border-gray-700 bg-gray-900 flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-200">🚨 處置中股票</span>
              <span className="text-xs text-gray-500">（上市＋上櫃，近 90 天，點股號可直接匯入）</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchDisposalList}
                disabled={disposalListLoading}
                className="text-xs px-3 py-1 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold transition-colors"
              >
                {disposalListLoading ? '查詢中…' : '查詢清單'}
              </button>
              <button
                onClick={() => setShowHelpModal(true)}
                className="text-xs px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold transition-colors"
              >
                📖 規則說明
              </button>
            </div>
          </div>

          {/* 答案卡（hero）：答案優先，差幅閘門明細收進 details */}
          {heroCard}

          {/* ── 第二款狀態（依實際歷史股價，常駐顯示）── */}
          {priceHistory.length >= 31 && (() => {
            const trig = clause2.triggered
            const state = !trig ? 'clear' : clause2.exempt ? 'exempt' : 'hit'
            const box = state === 'hit'   ? 'bg-yellow-950/50 border-yellow-500'
                      : state === 'exempt'? 'bg-sky-950/40 border-sky-600'
                      :                      'bg-green-950/30 border-green-700'
            const icon  = state === 'hit' ? '🟡' : state === 'exempt' ? '🛡️' : '✅'
            const title = state === 'hit' ? '第二款：可能觸發！'
                        : state === 'exempt' ? '第二款：已豁免（防重複）'
                        : '第二款：未觸發'
            const titleCol = state === 'hit' ? 'text-yellow-300' : state === 'exempt' ? 'text-sky-300' : 'text-green-300'
            // 盤中即時：收紅與否（收盤 > 當日開盤參考價≈前一營業日收盤＝MIS 昨收）——款二同日方向條件
            const refClose = quoteMeta?.prevClose ?? null
            const redKnown = livePrice != null && refClose != null
            const isRed    = redKnown && livePrice! > refClose!
            return (
              <div className={`p-4 rounded-xl border-2 ${box}`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className={`font-bold text-base ${titleCol}`}>{icon} {title}</span>
                  {trig && (
                    <span className="text-sm text-gray-300">
                      最近 <b className="text-yellow-300">{clause2.window}</b> 營業日起迄漲幅
                      <b className="text-yellow-300"> {clause2.pct?.toFixed(1)}%</b>
                      <span className="text-gray-500"> （門檻 {CLAUSE2[market].windows.find(w => w[0] === clause2.window)?.[1]}%）</span>
                    </span>
                  )}
                </div>
                <div className="text-sm mt-2">
                  {state === 'hit' && (
                    <>
                      <div className="mb-1.5 text-gray-300">
                        另須<b className="text-yellow-200">當日收紅</b>（收盤價 &gt; 當日開盤參考價≈前一營業日收盤）才成立。
                        {redKnown
                          ? <span className="block mt-0.5">
                              盤中即時 <b className="text-gray-100">{fNum(livePrice!)}</b> {isRed ? '＞' : '≤'} 昨收 <b className="text-gray-300">{fNum(refClose!)}</b> →{' '}
                              {isRed
                                ? <b className="text-yellow-300">目前收紅，方向符合（款二可能觸發）</b>
                                : <b className="text-green-300">目前收黑，若收盤維持則款二今日不觸發</b>}
                            </span>
                          : <span className="block mt-0.5 text-gray-500">（盤中即時價未取得；盤中按「🔄 立即刷新」或收盤後可判定收紅與否）</span>}
                      </div>
                      <details className="text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-200 select-none">為什麼第二款獨立？防重複豁免判定</summary>
                      <div className="space-y-1 mt-1.5">
                        <div>※ 第二款是「長期起迄倍漲」維度（{clause2.window} 營業日起點 → 最近收盤的漲幅），與款一/三的「6 日累積漲幅」<b>不同維度</b>，且差幅條件無法用歷史回推，故獨立判斷、此為價格面上限。</div>
                        <div className="text-amber-300/90">
                          🛡️ 防重複豁免規則：最近 30 日內已依第一款公布注意，<b>且</b>最近 6 日起迄漲幅 ≤ {CLAUSE2[market].dupPct}%（{market === 'TWSE' ? '上市' : '上櫃'}）→ 第二款不適用。
                          {clause2.sixDayPct != null && isFinite(clause2.sixDayPct)
                            ? <> 本檔最近 6 日起迄漲幅 <b>{clause2.sixDayPct.toFixed(1)}%</b>{clause2.sixDayPct > CLAUSE2[market].dupPct
                                ? <> &gt; {CLAUSE2[market].dupPct}% → <b className="text-yellow-300">不符豁免</b>，第二款仍成立。</>
                                : <> ≤ {CLAUSE2[market].dupPct}%，惟 30 日內無第一款注意 → <b className="text-yellow-300">不符豁免</b>，第二款仍成立。</>}</>
                            : <> → 豁免條件未全部滿足，第二款仍成立。</>}
                        </div>
                      </div>
                    </details>
                    </>
                  )}
                  {state === 'exempt' && (
                    <span className="text-sky-200">
                      豁免理由：30 日內已有第一款注意，且最近 6 日累積漲幅 <b>{clause2.sixDayPct?.toFixed(1)}%</b> ≤ {CLAUSE2[market].dupPct}%（{market === 'TWSE' ? '上市' : '上櫃'}）
                    </span>
                  )}
                  {state === 'clear' && (
                    <span className="text-gray-400">30/60/90 日起迄漲幅皆未達倍漲門檻</span>
                  )}
                </div>
              </div>
            )
          })()}

          <div>
            <h2 className="text-base font-bold text-gray-200 mb-1">🎮 互動沙盤 — 拖拉股價滑桿模擬走勢</h2>
            <p className="text-sm text-gray-400">
              <span className="text-red-400 font-semibold">🔴 第一款</span>（款一①純價格／款一②價格+起迄價差，取先成立者）
              <span className="mx-1 text-orange-400 font-semibold">🟠 款三</span>（價量異常，僅首張卡）
              <span className="mx-1 text-green-400 font-semibold">🟢 無注意</span>
              <span className="ml-1 text-gray-500">款一連3日即處置；款三計入連5日/10日6次/30日12次</span>
            </p>
          </div>

          {grid}

          {/* Result bar */}
          {notices.length > 0 && simResult && (
            simResult.disposed ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-950/40 border border-red-700">
                <span className="text-xl mt-0.5">❌</span>
                <div>
                  <p className="font-bold text-red-300">觸發處置！</p>
                  <p className="text-sm text-red-400 mt-0.5">
                    於 {calcMD(days[simResult.trigIdx])} 確認（{simResult.trigReason}），
                    {simResult.trigIdx < days.length-1
                      ? calcMD(days[simResult.trigIdx+1])
                      : '下個交易日'} 起限制交易
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-green-950/30 border border-green-700">
                <span className="text-xl mt-0.5">✅</span>
                <div>
                  <p className="font-bold text-green-300">此路徑安全</p>
                  <p className="text-sm text-green-400/80 mt-0.5">
                    連續第一款：{simResult.c1} 天　連續注意：{simResult.ca} 天
                    10日窗口：{simResult.lc10}/6　30日窗口：{simResult.lc30}/12
                  </p>
                </div>
              </div>
            )
          )}

          {notices.length === 0 && (
            <div className="text-center py-6 text-gray-600 text-sm">
              ← 左側輸入股號「一鍵匯入」，再拖拉滑桿開始模擬
            </div>
          )}

          {rulesGrid}

          <p className="text-xs text-gray-700 pb-2">
            資料來源：台灣證券交易所 TWSE + 證券櫃買中心 TPEx 官方 API（FL007225、FL007226）
          </p>
        </div>
      </div>

      {/* ── 規則說明 彈出視窗 ── */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowHelpModal(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
              <span className="text-base font-bold text-gray-100">📖 注意 / 處置 規則說明</span>
              <button onClick={() => setShowHelpModal(false)}
                className="text-gray-400 hover:text-gray-100 text-2xl leading-none px-1 transition-colors">✕</button>
            </div>

            <div className="overflow-y-auto px-5 py-4 space-y-5 text-sm text-gray-300 leading-relaxed">

              {/* 第一款 */}
              <section>
                <h3 className="text-red-400 font-bold mb-1.5">🔴 第一款 — 6 個營業日累積漲幅</h3>
                <p className="text-xs text-gray-500 mb-2">計算日收盤 vs 基準日收盤（基準日 = 計算日往前 6 個交易日）。款一①、款一② 皆屬第一款。</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-gray-800">
                    <thead>
                      <tr className="bg-gray-800/60 text-gray-400">
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800">款項</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-blue-400">上市 TWSE</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-purple-400">上櫃 TPEx</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800/60">
                        <td className="px-2 py-1.5 text-red-300 font-semibold">款一①<br/><span className="text-gray-500 font-normal">純價格</span></td>
                        <td className="px-2 py-1.5">累積漲幅 <b>超過 32%</b></td>
                        <td className="px-2 py-1.5">累積漲幅 <b>超過 30%</b></td>
                      </tr>
                      <tr>
                        <td className="px-2 py-1.5 text-red-300 font-semibold">款一②<br/><span className="text-gray-500 font-normal">價格+價差</span></td>
                        <td className="px-2 py-1.5"><b>超過 25%</b> 且<br/>起迄價差 ≥ <b>50 元</b></td>
                        <td className="px-2 py-1.5"><b>超過 23%</b> 且<br/>起迄價差 ≥ <b>40 元</b></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">＋ 法規另要求「漲幅與全體<b>及</b>同類差幅<b>均</b> ≥ 20%」。本工具<b className="text-orange-300/90">已納入全體差幅</b>（門檻自動取「價格門檻」與「全體+20%」較高者，當日全體漲幅以 0% 計）；<b>同類差幅仍無產業資料、未驗證</b>，故結果為估計。款一①② 都計入「連 3 日第一款 → 處置」。</p>
              </section>

              {/* 第二款 */}
              <section className="border-t border-gray-800 pt-4">
                <h3 className="text-yellow-400 font-bold mb-1.5">🟡 第二款 — 起迄兩營業日（長窗口倍漲）</h3>
                <p className="text-xs text-gray-500 mb-2">最近 30 / 60 / 90 個營業日的起迄漲幅，達門檻即可能成立（與第一款不同維度）。</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-gray-800">
                    <thead>
                      <tr className="bg-gray-800/60 text-gray-400">
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800">窗口</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-blue-400">上市</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-purple-400">上櫃</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800/60"><td className="px-2 py-1.5">30 日</td><td className="px-2 py-1.5">&gt; 100%</td><td className="px-2 py-1.5">&gt; 100%</td></tr>
                      <tr className="border-b border-gray-800/60"><td className="px-2 py-1.5">60 日</td><td className="px-2 py-1.5">&gt; 130%</td><td className="px-2 py-1.5">&gt; 140%</td></tr>
                      <tr><td className="px-2 py-1.5">90 日</td><td className="px-2 py-1.5">&gt; 160%</td><td className="px-2 py-1.5">&gt; 160%</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-sky-300/90 mt-2">
                  🛡️ <b>防重複豁免</b>：最近 30 日內已依第一款公布注意，且最近 <b>6 日累積漲幅 ≤ 25%（上市）/ 27%（上櫃）</b> → 第二款不適用。
                </p>
                <p className="text-xs text-gray-500 mt-1">表格「款二不豁免≥」= 計算日收盤達此價，6 日漲幅就超過 25%/27%，豁免失效、第二款成立。</p>
              </section>

              {/* 第三款 */}
              <section className="border-t border-gray-800 pt-4">
                <h3 className="text-orange-400 font-bold mb-1.5">🟠 第三款 — 價量同時異常</h3>
                <p className="text-xs text-gray-500 mb-2">當日須<b>同時</b>達「6 日累積漲幅」與「當日成交量放大」兩條件。</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-gray-800">
                    <thead>
                      <tr className="bg-gray-800/60 text-gray-400">
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800">條件</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-blue-400">上市</th>
                        <th className="text-left px-2 py-1.5 font-normal border-b border-gray-800 text-purple-400">上櫃</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800/60"><td className="px-2 py-1.5">① 6 日累積漲幅</td><td className="px-2 py-1.5"><b>超過 25%</b></td><td className="px-2 py-1.5"><b>超過 27%</b></td></tr>
                      <tr><td className="px-2 py-1.5">② 當日量 / 60 日均量</td><td className="px-2 py-1.5"><b>≥ 5 倍</b></td><td className="px-2 py-1.5"><b>≥ 5 倍</b></td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">＋ 同樣要求「漲幅與全體<b>及</b>同類差幅<b>均</b> ≥ 20%」（已納入全體；同類未驗證）。第三款<b>不</b>計入規則①（連 3 日第一款），但計入規則②③④。</p>
                <p className="text-xs text-amber-400/80 mt-1">⚠️ 量為當日變數無法預測 → 工具<b>僅在最近一日（下一交易日）那張卡</b>顯示款三的價格門檻與「量上限 = 5×60日均量」，並提供「假設當日量達標」開關來推演。法規另有「放大倍數與全體差 ≥ 4 倍」「週轉率/本益比除外」因資料不足未納入。</p>
              </section>

              {/* 處置規則 */}
              <section className="border-t border-gray-800 pt-4">
                <h3 className="text-orange-400 font-bold mb-1.5">⚖️ 處置規則（FL007225）</h3>
                <div className="text-xs text-gray-400 space-y-1 pl-1">
                  <div>規則①：連續 <b className="text-gray-200">3</b> 個營業日經第一款公布 → 處置</div>
                  <div>規則②：連續 <b className="text-gray-200">5</b> 個營業日經第一款～第八款公布 → 處置</div>
                  <div>規則③：最近 <b className="text-gray-200">10</b> 日內有 <b className="text-gray-200">6</b> 日經第一款～第八款公布 → 處置</div>
                  <div>規則④：最近 <b className="text-gray-200">30</b> 日內有 <b className="text-gray-200">12</b> 日經第一款～第八款公布 → 處置</div>
                </div>
                <p className="text-xs text-gray-500 mt-2">被處置後，注意次數從處置生效日<b>重新起算</b>（本工具自動帶入最近一次處置日）。</p>
              </section>

              {/* 其他 */}
              <section className="border-t border-gray-800 pt-4">
                <h3 className="text-gray-300 font-bold mb-1.5">⚙️ 計算細節</h3>
                <div className="text-xs text-gray-500 space-y-1 pl-1">
                  <div>• 漲停 = 前收 ×1.1 無條件捨去到 tick；跌停 = ×0.9 無條件進位</div>
                  <div>• tick 依股價：&lt;10→0.01、10~50→0.05、50~100→0.1、100~500→0.5、500~1000→1、≥1000→5</div>
                  <div>• 「超過 X%」採嚴格大於，門檻取剛好超過該漲幅的第一個合法 tick 價</div>
                  <div>• 窗口以「交易日」計（自動跳過週末），結束日為最近交易日</div>
                  <div>• 資料來源：TWSE + TPEx 官方 API（注意/處置公告、股價）</div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ── 處置中股票 彈出視窗 ── */}
      {showDisposalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowDisposalModal(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-gray-100">🚨 處置中股票</span>
                <span className="text-xs text-gray-500">上市＋上櫃，近 90 天</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchDisposalList}
                  disabled={disposalListLoading}
                  className="text-xs px-2.5 py-1 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold transition-colors"
                >
                  {disposalListLoading ? '查詢中…' : '🔄 重新整理'}
                </button>
                <button
                  onClick={() => setShowDisposalModal(false)}
                  className="text-gray-400 hover:text-gray-100 text-2xl leading-none px-1 transition-colors"
                  title="關閉"
                >✕</button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto">
              {disposalListLoading && (
                <p className="text-sm text-gray-500 px-5 py-6 animate-pulse">⏳ 查詢 TWSE + TPEx 處置公告中…</p>
              )}
              {disposalListErr && (
                <p className="text-sm text-red-400 px-5 py-6">❌ {disposalListErr}</p>
              )}
              {disposalListLoaded && !disposalListLoading && (
                disposalList.length === 0 ? (
                  <p className="text-sm text-gray-500 px-5 py-6">查無近期處置紀錄</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-900">
                      <tr className="text-gray-500 border-b border-gray-800">
                        <th className="text-left px-4 py-2 font-normal">代號</th>
                        <th className="text-left px-2 py-2 font-normal">名稱</th>
                        <th className="text-left px-2 py-2 font-normal">生效日</th>
                        <th className="text-left px-2 py-2 font-normal">終止日</th>
                        <th className="text-left px-2 py-2 font-normal">來源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disposalList.map((r, i) => (
                        <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors">
                          <td className="px-4 py-2">
                            <button
                              onClick={() => importFromList(r.code)}
                              disabled={importStatus.loading}
                              className="font-bold text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50 transition-colors"
                              title={`匯入 ${r.code}`}
                            >
                              {r.code}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-gray-300">{r.name}</td>
                          <td className="px-2 py-2 text-orange-300">{r.startDate.slice(5)}</td>
                          <td className="px-2 py-2 text-gray-400">{r.endDate ? r.endDate.slice(5) : '—'}</td>
                          <td className="px-2 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              r.source === 'TWSE' ? 'bg-blue-950 text-blue-400 border border-blue-800' : 'bg-purple-950 text-purple-400 border border-purple-800'
                            }`}>{r.source}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>

            {/* Footer */}
            {disposalListLoaded && disposalList.length > 0 && (
              <div className="px-5 py-2 border-t border-gray-800 text-xs text-gray-600 shrink-0">
                共 {disposalList.length} 筆　點股號可直接匯入分析
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
