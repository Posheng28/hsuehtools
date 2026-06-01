# 盤中同類均值即時化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（本 session inline 執行）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 盤中讓差幅閘門的「同類均值」用同類成員即時價即時變動（計算日當日不再固定 0%）；全體維持 0%。

**Architecture:** 歷史層沿用 `/api/sectoravg`（每檔 5 完成日累積 `cums` + `sectorMap`，6h 快取）；新增 `live=1` 分支，於歷史層上加「MIS 批量抓同類成員即時 → 今日 live% → 併入該成員累積 → 等權平均」。計算邏輯全在純函式（單測），route 與 client 只接線。

**Tech Stack:** Next.js 16.2.6（App Router）、TypeScript strict、React 19、Tailwind 4、vitest 4。`npm run build` = CI gate（含 ESLint，未使用變數會擋）。Bash CWD 須 `cd "C:/Users/user/chart-overlay"`。

> ⚠️ **Git**：依使用者長期指示，**全程不 commit**；所有任務完成、測試/build 綠燈後**詢問**再提交。各任務不含 commit step。
> ⚠️ **測試慣例**：本 repo 只單測純函式，不測 route、不 mock fetch。故 fetch glue（`fetchSectorTodayPct`）、route、client 接線**不寫單測**，以 `npm run build` + dev server 整合驗證。
> ⚠️ Next.js 版本有破壞性改動；本輪未用新 framework API（只加 route 分支、純 TS、改 React 元件）。

**Spec:** `docs/superpowers/specs/2026-06-01-sector-avg-live-intraday-design.md`

---

## 檔案結構

| 檔案 | 職責 | 動作 |
|---|---|---|
| `lib/disposal/quote.ts` | MIS 回應解析（純） | 加 `parseMisQuoteRows` |
| `lib/disposal/marketData.ts` | 共用資料/數值 | `trunc2` 改 `export` |
| `lib/disposal/sectorLive.ts` | 同類 live 計算（純）+ MIS 批量抓取（glue） | **新檔** |
| `app/api/sectoravg/route.ts` | 同類均值 API | 加 `live=1` 分支 + 新回應欄位 |
| `components/DisposalTool.tsx` | UI 接線 | sectorAvg 取 live、輪詢重抓、明細文字 |
| `lib/disposal/__tests__/sectorLive.test.ts` | 純函式測試 | **新檔** |
| `lib/disposal/__tests__/quote.test.ts` | 既有測試 | 擴充 `parseMisQuoteRows` |

---

## Task 1: `parseMisQuoteRows`（解析 MIS 全部列）

**Files:**
- Modify: `lib/disposal/quote.ts`
- Test: `lib/disposal/__tests__/quote.test.ts`

- [ ] **Step 1: 寫失敗測試**（append 到 `quote.test.ts`，並把 import 改為 `import { parseMisQuote, parseMisQuoteRows, misExCh } from '@/lib/disposal/quote'`）

```ts
describe('parseMisQuoteRows', () => {
  it('解析多檔：tse/otc 混合、z 為 - 視為 null', () => {
    const json = { msgArray: [
      { c: '2327', z: '800.0', y: '780.0', ex: 'tse' },
      { c: '2330', z: '-',     y: '1000', ex: 'tse' },
      { c: '6488', z: '500',   y: '490',  ex: 'otc' },
    ] }
    expect(parseMisQuoteRows(json)).toEqual([
      { code: '2327', price: 800,  prevClose: 780,  market: 'TWSE' },
      { code: '2330', price: null, prevClose: 1000, market: 'TWSE' },
      { code: '6488', price: 500,  prevClose: 490,  market: 'TPEx' },
    ])
  })
  it('無 msgArray / 空 → []，無 c 的列跳過', () => {
    expect(parseMisQuoteRows(null)).toEqual([])
    expect(parseMisQuoteRows({})).toEqual([])
    expect(parseMisQuoteRows({ msgArray: [{ z: '1' }] })).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run lib/disposal/__tests__/quote.test.ts`
Expected: FAIL（`parseMisQuoteRows is not a function` / not exported）

- [ ] **Step 3: 實作**（加在 `quote.ts` 的 `parseMisQuote` 之後，複用既有 `num` 與 `MisRow`）

```ts
export interface MisRowLite { code: string; price: number | null; prevClose: number | null; market: Market }

/** 解析 MIS getStockInfo 回應的「全部」列（批量查多檔用）。無 c 的列跳過。 */
export function parseMisQuoteRows(json: unknown): MisRowLite[] {
  const arr = (json as { msgArray?: MisRow[] } | null)?.msgArray
  if (!Array.isArray(arr)) return []
  const out: MisRowLite[] = []
  for (const r of arr) {
    const code = String(r?.c ?? '').trim()
    if (!code) continue
    out.push({
      code,
      price: num(r.z),
      prevClose: num(r.y),
      market: String(r.ex ?? '').trim().toLowerCase() === 'otc' ? 'TPEx' : 'TWSE',
    })
  }
  return out
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run lib/disposal/__tests__/quote.test.ts`
Expected: PASS（全部）

---

## Task 2: `trunc2` 匯出 + `misExChBatch` + `misRowsToTodayPct`

**Files:**
- Modify: `lib/disposal/marketData.ts:7`（`trunc2` 加 export）
- Create: `lib/disposal/sectorLive.ts`
- Test: `lib/disposal/__tests__/sectorLive.test.ts`（新檔）

- [ ] **Step 1: 寫失敗測試**（新檔 `sectorLive.test.ts`）

```ts
import { describe, it, expect } from 'vitest'
import { misExChBatch, misRowsToTodayPct } from '@/lib/disposal/sectorLive'

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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run lib/disposal/__tests__/sectorLive.test.ts`
Expected: FAIL（Cannot find package '@/lib/disposal/sectorLive'）

- [ ] **Step 3a: `marketData.ts` 匯出 trunc2**

把第 7 行
```ts
const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }
```
改為
```ts
export const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }
```

- [ ] **Step 3b: 建立 `sectorLive.ts`（先放這兩個純函式）**

```ts
// lib/disposal/sectorLive.ts
// 同類均值「盤中即時」計算：在歷史 5 日累積之上，加同類成員當日 live% 貢獻。
import { trunc2, type Market } from '@/lib/disposal/marketData'
import { misExCh, parseMisQuoteRows } from '@/lib/disposal/quote'

const CHUNK = 40

/** 代號每 CHUNK 檔一批，各批以 | 串成 MIS ex_ch 字串 */
export function misExChBatch(market: Market, codes: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < codes.length; i += CHUNK) {
    out.push(codes.slice(i, i + CHUNK).map(c => misExCh(market, c)).join('|'))
  }
  return out
}

/** MIS 解析列 → { code: 今日漲跌%(trunc2) }；price/prevClose 缺或 prevClose≤0 跳過 */
export function misRowsToTodayPct(
  rows: { code: string; price: number | null; prevClose: number | null }[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    if (r.price == null || r.prevClose == null || r.prevClose <= 0) continue
    out[r.code] = trunc2((r.price - r.prevClose) / r.prevClose * 100)
  }
  return out
}
```
（`parseMisQuoteRows` 雖此檔尚未用到，先 import 不會擋 build？會——ESLint `no-unused-vars`。故 import 行**暫時只引 `misExCh`**，待 Task 4 加 `fetchSectorTodayPct` 時再補 `parseMisQuoteRows`。本步驟 import 改為：`import { misExCh } from '@/lib/disposal/quote'`。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run lib/disposal/__tests__/sectorLive.test.ts`
Expected: PASS

---

## Task 3: `liveSectorAvg`（核心併入＋等權平均）

**Files:**
- Modify: `lib/disposal/sectorLive.ts`
- Test: `lib/disposal/__tests__/sectorLive.test.ts`

- [ ] **Step 1: 寫失敗測試**（append 到 `sectorLive.test.ts`，import 補 `liveSectorAvg`）

```ts
import { liveSectorAvg } from '@/lib/disposal/sectorLive'

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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run lib/disposal/__tests__/sectorLive.test.ts`
Expected: FAIL（`liveSectorAvg is not a function`）

- [ ] **Step 3: 實作**（加進 `sectorLive.ts`）

```ts
/** 同類 live 均值：members = sectorMap===sector 且 ∈cums 且 ≠exclude；
 *  liveCum=cums[m]+(todayPct[m]||0)；等權。回 { avg, n, todayAvg }（n=0→全 null）。 */
export function liveSectorAvg(
  cums: Record<string, number>,
  sectorMap: Record<string, string>,
  sector: string,
  exclude: string,
  todayPct: Record<string, number>,
): { avg: number | null; n: number; todayAvg: number | null } {
  let sumLive = 0, sumToday = 0, n = 0
  for (const [c, base] of Object.entries(cums)) {
    if (c === exclude) continue
    if (sectorMap[c] !== sector) continue
    const t = todayPct[c] ?? 0
    sumLive += base + t
    sumToday += t
    n++
  }
  if (!n) return { avg: null, n: 0, todayAvg: null }
  return { avg: +(sumLive / n).toFixed(2), n, todayAvg: +(sumToday / n).toFixed(2) }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run lib/disposal/__tests__/sectorLive.test.ts`
Expected: PASS（全部）

---

## Task 4: `fetchSectorTodayPct`（MIS 批量 glue）+ route `live=1`

> glue + route，依 repo 慣例不單測，靠 build + dev server 驗證。

**Files:**
- Modify: `lib/disposal/sectorLive.ts`（加 `fetchSectorTodayPct`，import 補 `parseMisQuoteRows`）
- Modify: `app/api/sectoravg/route.ts`

- [ ] **Step 1: `sectorLive.ts` 加 fetch glue**

把頂部 import 改為：
```ts
import { misExCh, parseMisQuoteRows } from '@/lib/disposal/quote'
```
檔尾加：
```ts
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

/** 抓同類成員今日 live%：分批打 MIS getStockInfo → 解析 → todayPct map。
 *  任何一批失敗 → 該批成員缺漏（視同今日無資料），不整體拋錯。 */
export async function fetchSectorTodayPct(market: Market, codes: string[]): Promise<Record<string, number>> {
  if (!codes.length) return {}
  const out: Record<string, number> = {}
  for (const exCh of misExChBatch(market, codes)) {
    try {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/fibest.jsp' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      Object.assign(out, misRowsToTodayPct(parseMisQuoteRows(await res.json())))
    } catch { /* 該批略過 */ }
  }
  return out
}
```

- [ ] **Step 2: route 加 `live=1` 分支**

`app/api/sectoravg/route.ts` 頂部 import 加：
```ts
import { liveSectorAvg, fetchSectorTodayPct } from '@/lib/disposal/sectorLive'
```
把現有 return 前的區塊（第 28–36 行）改為：
```ts
  const sectorCode = sectorMap[code] ?? null
  const market_ = eqAvg(cums, { exclude: code })
  const sector_ = sectorCode ? eqAvg(cums, { sectorMap, sector: sectorCode, exclude: code }) : { avg: null, n: 0 }

  // 盤中即時：同類成員當日 live% 併入（全體仍 0%）。失敗則全 null，前端退回歷史值。
  let sectorAvgLive: number | null = null, sectorTodayAvg: number | null = null, sectorLiveN: number | null = null
  if (p.get('live') === '1' && sectorCode) {
    const members = Object.keys(cums).filter(c => sectorMap[c] === sectorCode && c !== code)
    const todayPct = await fetchSectorTodayPct(market, members)
    const r = liveSectorAvg(cums, sectorMap, sectorCode, code, todayPct)
    sectorAvgLive = r.avg; sectorTodayAvg = r.todayAvg; sectorLiveN = r.n
  }

  return NextResponse.json({
    targetCum: code in cums ? +cums[code].toFixed(2) : null,
    marketAvg: market_.avg, marketN: market_.n,
    sectorAvg: sector_.avg, sectorN: sector_.n,
    sectorAvgLive, sectorTodayAvg, sectorLiveN,
    sectorCode,
  })
```

- [ ] **Step 3: build 驗證**

Run: `npm run build`
Expected: 綠燈（無 TS/ESLint 錯；`parseMisQuoteRows` 此時已被 `fetchSectorTodayPct` 使用，無 unused）

- [ ] **Step 4: dev server 整合驗證（盤中才有 live 值）**

啟 dev server，對 `/api/sectoravg?market=TWSE&code=2327&win=<近5完成日YMD逗號分隔>&live=1` 取 JSON，確認回 `sectorAvgLive`／`sectorTodayAvg`／`sectorLiveN` 三欄；盤中時 `sectorAvgLive` 與 `sectorAvg`（歷史）不同、`sectorTodayAvg` 非 0。非盤中則 `sectorTodayAvg≈0`、`sectorAvgLive≈sectorAvg`。

---

## Task 5: DisposalTool 接線（取 live、輪詢重抓、明細文字）

> client glue，不單測；靠 build + preview 驗證。

**Files:**
- Modify: `components/DisposalTool.tsx`

- [ ] **Step 1: 擴充 `sectorAvg` state 型別**（line 363）

```ts
const [sectorAvg, setSectorAvg] = useState<{
  sectorAvg: number | null; marketAvg: number | null; sectorCode: string | null; targetCum: number | null
  sectorAvgLive?: number | null; sectorTodayAvg?: number | null; sectorLiveN?: number | null
} | null>(null)
```

- [ ] **Step 2: 加 `sectorReqRef` + `fetchSectorAvg` helper**（放在 `refreshLive` 定義之前，約 line 437 後）

```ts
// 同類均值請求參數鏡射（供盤中輪詢閉包重建 URL）
const sectorReqRef = useRef<{ market: Market; code: string; win: string } | null>(null)

// 取同類均值；live=true 時帶 &live=1。失敗回 null。
const fetchSectorAvg = useCallback(async (m: Market, c: string, win: string, live: boolean) => {
  try {
    const r = await fetch(`/api/sectoravg?market=${m}&code=${c}&win=${win}${live ? '&live=1' : ''}`)
    const d = await r.json()
    return d.error ? null : d
  } catch { return null }
}, [])
```

- [ ] **Step 3: `refreshLive` 內加同類即時重抓**（在 `finally` 之前，約 line 456）

於 `try` 區塊末（`setQuoteMeta({...})` 之後、`}` 之前）加：
```ts
      // 盤中：同類均值也用同類成員即時價重算（全體維持 0%）
      const sr = sectorReqRef.current
      if (sr) {
        const d = await fetchSectorAvg(sr.market, sr.code, sr.win, true)
        if (d) setSectorAvg(prev => prev
          ? { ...prev, sectorAvgLive: d.sectorAvgLive ?? null, sectorTodayAvg: d.sectorTodayAvg ?? null, sectorLiveN: d.sectorLiveN ?? null }
          : d)
      }
```
並把 `fetchSectorAvg` 加進 `refreshLive` 的 `useCallback` deps：`}, [fetchSectorAvg])`。

- [ ] **Step 4: 兩個 import 路徑改用 helper + 存 ref + 盤中帶 live**

doImport（約 line 516–522）與第二個匯入路徑（約 line 619–625）兩處的 sectoravg 區塊，各改為：
```ts
          // 同類/全體均值：近 6 日的「最近 5 個 interval 日」作窗口；盤中帶 live
          {
            const winStr = all.slice(-5).map(d => d.date.replace(/-/g, '')).join(',')
            sectorReqRef.current = { market: json.market, code, win: winStr }
            setSectorAvg(null)
            fetchSectorAvg(json.market, code, winStr, inTwMarketHours())
              .then(d => { if (d) setSectorAvg(d) })
          }
```

- [ ] **Step 5: `sAvgPct` 取 live 優先**（line 754）

```ts
const sAvgPct = sectorAvg?.sectorAvgLive ?? sectorAvg?.sectorAvg ?? null
```

- [ ] **Step 6: 差幅閘門明細顯示即時當日%**（約 line 1346 標題 + line 1353 同類列）

標題行（1346）把「當日（第 6 間隔）以 0% 計」改為：
```tsx
              近 6 日{marketAvg.baseDate && marketAvg.lastClosedDate ? `（${marketAvg.baseDate.slice(4, 6)}/${marketAvg.baseDate.slice(6)}→${marketAvg.lastClosedDate.slice(4, 6)}/${marketAvg.lastClosedDate.slice(6)}）` : ''}・已知 5 間隔；全體當日以 0% 計{sectorAvg?.sectorTodayAvg != null ? '，同類當日以即時價計' : '，同類當日以 0% 計'}
```
同類列 label（1353）改為帶即時當日%：
```tsx
                { label: `同類均值${sectorAvg?.sectorCode ? `（類${sectorAvg.sectorCode}）` : ''}${sectorAvg?.sectorTodayAvg != null ? `・當日即時 ${sectorAvg.sectorTodayAvg > 0 ? '+' : ''}${sectorAvg.sectorTodayAvg}%` : ''}`, v: sAvgPct, excluded: peExcludesSector },
```

- [ ] **Step 7: build 驗證**

Run: `npm run build`
Expected: 綠燈（注意 `fetchSectorAvg`/`sectorReqRef` 皆有用到，無 unused；型別相容）

- [ ] **Step 8: preview 整合驗證**

dev server 匯入 2327（盤中）→ 確認：(a) 差幅閘門明細同類列出現「當日即時 +X%」且數字隨刷新變動；(b) 「立即刷新」後同類值更新；(c) 注意線「只能再漲 +X%」隨同類即時值變動；(d) 非盤中匯入時同類列回「當日以 0% 計」、值＝歷史。截圖佐證。

---

## Task 6: 全測試 + build + 文檔 + 詢問 commit

**Files:**
- Modify: `docs/PROJECT_NOTES.md`
- Modify: `~/.claude/refs/taiwan-finance-data.md`（repo 外）

- [ ] **Step 1: 全套件 + build**

Run: `npx vitest run` → Expected: 全綠（原 120 + 新增 parseMisQuoteRows/misExChBatch/misRowsToTodayPct/liveSectorAvg 約 8 筆）
Run: `npm run build` → Expected: 綠燈

- [ ] **Step 2: 更新 `docs/PROJECT_NOTES.md`**

在「差幅閘門」相關段落補一條：同類均值盤中以 `/api/sectoravg?live=1` 用同類成員 MIS 即時價即時化（計算日當日不再固定 0%）；全體仍 0%；無即時成員當 0% 留在平均內；MIS 失敗退回歷史值。純函式：`lib/disposal/sectorLive.ts`（`liveSectorAvg`/`misExChBatch`/`misRowsToTodayPct`/`fetchSectorTodayPct`）+ `quote.ts` 的 `parseMisQuoteRows`。

- [ ] **Step 3: 更新 `~/.claude/refs/taiwan-finance-data.md`**

在注意/處置段補：MIS `getStockInfo.jsp` 的 `ex_ch` 可用 `|` 一次查多檔（每批約 40），回 `msgArray` 多列；可用來做「同類成員盤中即時累積漲幅」估計（昨收 `y`、現價 `z`）。

- [ ] **Step 4: 詢問使用者是否 commit + push**

列出變更檔案，等使用者指示再提交（trailer `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`）。

---

## Self-Review（對照 spec）

- **Spec §2 計算** → Task 3 `liveSectorAvg`（含排除、無 live 當 0%、n 一致、todayAvg）✓；trunc2 今日% → Task 2 `misRowsToTodayPct` ✓
- **Spec §3.1 純函式** → Task 1（`parseMisQuoteRows`）、Task 2（`misExChBatch`）、Task 3（`liveSectorAvg`）✓
- **Spec §3.1 `fetchSectorTodayPct`** → Task 4 ✓
- **Spec §3.2 route live=1 + 新欄位** → Task 4 ✓
- **Spec §3.3 前端接線（ref/輪詢/sAvgPct）** → Task 5 ✓
- **Spec §4 邊界**（MIS 失敗、盤前、y≤0、n=0、全體 0%）→ Task 3/4 程式碼 + Task 5 `??` 退回 ✓
- **Spec §5 UI** → Task 5 Step 6 ✓
- **Spec §6 測試** → Task 1/2/3 ✓（route/glue 依 repo 慣例整合驗證）
- **型別一致**：`liveSectorAvg` 回 `{avg,n,todayAvg}`（Task 3）↔ route 取用（Task 4）↔ 回應欄位 `sectorAvgLive/sectorTodayAvg/sectorLiveN`（Task 4）↔ state 型別 + `sAvgPct`（Task 5）一致 ✓
- **No placeholders**：各步驟皆具完整程式碼/指令 ✓
