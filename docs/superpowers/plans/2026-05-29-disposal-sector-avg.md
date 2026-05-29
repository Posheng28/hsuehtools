# 處置面板：同類/全體均值差幅閘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓處置面板款一①②的「差幅 ≥ 20%」閘門同時依**全體均值**與**同類均值**判定，且兩個均值皆以「該市場每一檔個股累積漲幅等權平均、排除標的本身」自算（上市+上櫃同口徑），取代目前只有全體、且上櫃用櫃買指數加權的作法。

**Architecture:** 抽出共用資料層 `lib/disposal/marketData.ts`（全市場逐日個股漲跌% + 產業別 + 累積/等權平均工具），給 `market-avg` 與新 `sectoravg` 兩個 route 共用。`clauseEngine` 的差幅閘改成 `max(全體, 同類)+20`。`DisposalTool` 匯入個股時呼叫 `sectoravg`（用個股實際 6 日窗口），把全體/同類均值餵進引擎並在款一卡片顯示兩行。

**Tech Stack:** Next.js 16 App Router (route handlers)、TypeScript、vitest 4（`lib/**/*.test.ts`）、官方資料源 TWSE `MI_INDEX ALLBUT0999` / TPEx `afterTrading/dailyQuotes` / `t187ap03_L` / `mopsfin_t187ap03_O`。

**範圍外（另開計劃）：** 盤中即時卡片（7 時點即時重算）——需先偵察上櫃即時端點，且為獨立 UI 狀態機，留待 Phase B。

**已驗證黃金值（窗口 5/22~28，即預測 5/29 時）：** 國巨 2327（上市, 產業別 28）已知 5 日累積 = **27.36**；同類均值(28 類·排除國巨) = **6.15**；全體均值(排除國巨) = **2.22**。這三個值鎖死為回歸測試。

---

## File Structure

- **Create** `lib/disposal/marketData.ts` — 共用資料層：`fetchTwseDailyPct` / `fetchTpexDailyPct` / `fetchSectorMap` / `cumulativeMap` / `eqAvg` / `trunc2` / `Market`。
- **Create** `lib/disposal/__tests__/marketData.test.ts` — 合成 fixture 的單元測試。
- **Create** `lib/disposal/__tests__/golden.test.ts` — 真實 6 日 fixture 對拍國巨/同類/全體黃金值。
- **Create** `lib/disposal/__tests__/fixtures/` — 由 `.tmp_sec/` 精簡而來的 6 日 TWSE 收盤 + 產業別。
- **Modify** `app/api/market-avg/route.ts` — 改用共用層；上櫃改個股等權。
- **Create** `app/api/sectoravg/route.ts` — 給 code+market+win，回 targetCum / sectorAvg / marketAvg（皆排除標的）。
- **Modify** `lib/clauseEngine.ts` — `ClauseInput` 加 `sectorAvg6`；`c1`/`c3` 差幅閘改 `max(全體,同類)+20`。
- **Modify** `lib/clauseEngine.test.ts`（若不存在則 Create）— 差幅閘測試。
- **Modify** `components/DisposalTool.tsx` — 匯入時 fetch `sectoravg`、新 state、傳 `sectorAvg6`、款一卡片顯示兩行均值；`thresh()` 加同類項。
- **Modify** `docs/PROJECT_NOTES.md`、`~/.claude/refs/taiwan-finance-data.md` — 記錄上櫃改等權 + 新端點。

---

### Task 1: 共用資料層 `lib/disposal/marketData.ts`（純函式先行）

**Files:**
- Create: `lib/disposal/marketData.ts`
- Test: `lib/disposal/__tests__/marketData.test.ts`

- [ ] **Step 1: 寫失敗測試（純計算函式 `cumulativeMap` / `eqAvg`）**

```ts
// lib/disposal/__tests__/marketData.test.ts
import { describe, it, expect } from 'vitest'
import { cumulativeMap, eqAvg } from '@/lib/disposal/marketData'

describe('cumulativeMap', () => {
  it('每檔逐日 trunc2 後相加，僅納入全期都有的代號', () => {
    // 2 天窗口；A 兩天都在，B 第二天缺 → B 不納入
    const snaps = [
      { '1111': 1.005, '2222': 3.0 },   // day1 raw daily%
      { '1111': 2.004, '2222': 1.0 },   // day2；2222 仍在
    ]
    // 1111: trunc2(1.005)=1.00 + trunc2(2.004)=2.00 → 3.00
    // 2222: trunc2(3.0)=3.00 + trunc2(1.0)=1.00 → 4.00
    const cum = cumulativeMap(snaps)
    expect(cum['1111']).toBeCloseTo(3.0, 6)
    expect(cum['2222']).toBeCloseTo(4.0, 6)
  })
  it('缺一天的代號被剔除', () => {
    const cum = cumulativeMap([{ A: 1 }, { B: 2 }])
    expect(Object.keys(cum)).toEqual([])
  })
})

describe('eqAvg', () => {
  const cums = { '1111': 10, '2222': 20, '3333': 30 }
  it('全體等權平均、可排除標的本身', () => {
    expect(eqAvg(cums).avg).toBeCloseTo(20, 6)             // (10+20+30)/3
    expect(eqAvg(cums, { exclude: '2222' }).avg).toBeCloseTo(20, 6) // (10+30)/2
    expect(eqAvg(cums, { exclude: '1111' }).avg).toBeCloseTo(25, 6) // (20+30)/2
  })
  it('依產業別篩選 + 排除自己', () => {
    const sectorMap = { '1111': '28', '2222': '28', '3333': '24' }
    const r = eqAvg(cums, { sectorMap, sector: '28', exclude: '1111' })
    expect(r.avg).toBeCloseTo(20, 6)  // 只剩 2222
    expect(r.n).toBe(1)
  })
  it('空集合回 null', () => {
    expect(eqAvg({}).avg).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run lib/disposal/__tests__/marketData.test.ts`
Expected: FAIL（找不到模組 `@/lib/disposal/marketData`）

- [ ] **Step 3: 實作 `lib/disposal/marketData.ts`**

```ts
// lib/disposal/marketData.ts
import { getCached, setCached } from '@/lib/cache'

export type Market = 'TWSE' | 'TPEx'

/** 每日漲跌% 取小數 2 位無條件捨去(向零) — 注意股累積漲幅官方逐日進位法 */
export const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }

const idxNum = (s: unknown): number | null => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
const isOrd = (c: string) => /^[1-9]\d{3}$/.test(c)   // 普通股(排除 ETF/ETN/權證/債券/特別股)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

interface MiResp { tables?: { title?: string; data?: unknown[][] }[] }

/** 上市某日普通股 { code: 當日漲跌幅%(raw, 未trunc) }；失敗/非交易日回 null（含 3 次重試） */
export async function fetchTwseDailyPct(ymd: string): Promise<Record<string, number> | null> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const j = (await res.json()) as MiResp
        const t = (j.tables ?? []).find(x => String(x.title ?? '').includes('每日收盤行情'))
        if (t?.data?.length) {
          const out: Record<string, number> = {}
          for (const row of t.data) {
            const code = String(row[0]).trim(); if (!isOrd(code)) continue
            const close = idxNum(row[8]), mag = idxNum(row[10])   // row[8]=收盤 row[9]=方向(green=跌) row[10]=漲跌價差
            if (close === null || mag === null || close <= 0) continue
            const diff = mag * (String(row[9]).includes('green') ? -1 : 1), prev = close - diff
            if (prev <= 0) continue
            out[code] = (diff / prev) * 100
          }
          if (Object.keys(out).length) return out
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return null
}

/** 上櫃某日普通股 { code: 當日漲跌幅%(raw) }；dailyQuotes，漲跌欄已帶 +/− */
export async function fetchTpexDailyPct(ymd: string): Promise<Record<string, number> | null> {
  const roc = `${+ymd.slice(0, 4) - 1911}/${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${roc}&type=EW&response=json`
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const j = (await res.json()) as { tables?: { data?: unknown[][] }[] }
        const data = j.tables?.[0]?.data
        if (data?.length) {
          const out: Record<string, number> = {}
          for (const row of data) {
            const code = String(row[0]).trim(); if (!isOrd(code)) continue
            const close = idxNum(row[2]), diff = idxNum(row[3])   // col2=收盤 col3=漲跌(帶號)
            if (close === null || diff === null || close <= 0) continue
            const prev = close - diff
            if (prev <= 0) continue
            out[code] = (diff / prev) * 100
          }
          if (Object.keys(out).length) return out
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return null
}

/** 產業別對照 { code: 產業別碼 }；上市 t187ap03_L、上櫃 mopsfin_t187ap03_O。快取 24h */
export async function fetchSectorMap(market: Market): Promise<Record<string, string>> {
  const key = `sectormap:${market}`
  const cached = getCached(key); if (cached) return cached as Record<string, string>
  const out: Record<string, string> = {}
  try {
    if (market === 'TWSE') {
      const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', { headers: { 'User-Agent': UA } })
      if (res.ok) for (const r of (await res.json()) as Record<string, string>[]) {
        if (r['公司代號'] && r['產業別']) out[r['公司代號']] = r['產業別']
      }
    } else {
      const res = await fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', { headers: { 'User-Agent': UA } })
      if (res.ok) for (const r of (await res.json()) as Record<string, string>[]) {
        if (r.SecuritiesCompanyCode && r.SecuritiesIndustryCode) out[r.SecuritiesCompanyCode] = r.SecuritiesIndustryCode
      }
    }
  } catch { /* 回空 map */ }
  if (Object.keys(out).length) setCached(key, out, 24 * 60 * 60 * 1000)
  return out
}

/** 每檔個股累積% = 逐日 trunc2 後相加；只納入「全期 snapshot 都有」的代號 */
export function cumulativeMap(snaps: Record<string, number>[]): Record<string, number> {
  if (!snaps.length) return {}
  let codes = new Set(Object.keys(snaps[0]))
  for (let i = 1; i < snaps.length; i++) codes = new Set([...codes].filter(c => c in snaps[i]))
  const out: Record<string, number> = {}
  for (const c of codes) { let s = 0; for (const snap of snaps) s += trunc2(snap[c]); out[c] = s }
  return out
}

/** 等權(簡單)平均；可選依產業別篩 + 排除某 code。回 { avg, n } */
export function eqAvg(
  cums: Record<string, number>,
  opts: { sectorMap?: Record<string, string>; sector?: string; exclude?: string } = {},
): { avg: number | null; n: number } {
  const { sectorMap, sector, exclude } = opts
  let sum = 0, n = 0
  for (const [c, v] of Object.entries(cums)) {
    if (c === exclude) continue
    if (sector != null && sectorMap && sectorMap[c] !== sector) continue
    sum += v; n++
  }
  return { avg: n ? +(sum / n).toFixed(2) : null, n }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run lib/disposal/__tests__/marketData.test.ts`
Expected: PASS（5 個 it 全綠）

- [ ] **Step 5: Commit**

```bash
git add lib/disposal/marketData.ts lib/disposal/__tests__/marketData.test.ts
git commit -m "feat(disposal): 共用全市場個股漲跌%資料層(等權累積/產業別/上市櫃)"
```

---

### Task 2: 真實 6 日 fixture 對拍黃金值

**Files:**
- Create: `lib/disposal/__tests__/fixtures/twse_2026052{2,5,6,7,8}.json`（5 個檔，精簡後的 `tables[8].data`）
- Create: `lib/disposal/__tests__/fixtures/twse_sectormap.json`（{code: 產業別}）
- Create: `lib/disposal/__tests__/golden.test.ts`

> 窗口取 5/22,25,26,27,28（= 預測 5/29 時的「已知 5 日」5 個 interval-end），對拍 attstock 截圖：國巨 27.36 / 同類(28排國巨) 6.15 / 全體(排國巨) 2.22。

- [ ] **Step 1: 從 `.tmp_sec/` 產生精簡 fixture（只留 `[code, close, dirSign, diff]` 與產業別）**

Run（在 repo 根目錄；`.tmp_sec/` 內已有 `d_2026052X.json` 與 `t187.json`）:

```bash
mkdir -p lib/disposal/__tests__/fixtures
python - <<'PY'
import json, os
src='.tmp_sec'; dst='lib/disposal/__tests__/fixtures'
for ymd in ['20260522','20260525','20260526','20260527','20260528']:
    d=json.load(open(f'{src}/d_{ymd}.json',encoding='utf-8'))
    rows=d['tables'][8]['data']
    slim=[]
    for r in rows:
        c=r[0]
        if not (len(c)==4 and c.isdigit()): continue
        slim.append([c, r[8], -1 if 'green' in r[9] else 1, r[10]])  # [code, close, sign, magnitude]
    json.dump(slim, open(f'{dst}/twse_{ymd}.json','w',encoding='utf-8'), ensure_ascii=False)
smap={r['公司代號']:r['產業別'] for r in json.load(open(f'{src}/t187.json',encoding='utf-8'))}
json.dump(smap, open(f'{dst}/twse_sectormap.json','w',encoding='utf-8'), ensure_ascii=False)
print('done')
PY
```
Expected: 印出 `done`；`fixtures/` 下出現 6 個 json。

- [ ] **Step 2: 寫黃金值測試（用 fixture 重建 daily% 再算）**

```ts
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
```

- [ ] **Step 3: 跑測試確認通過**

Run: `npx vitest run lib/disposal/__tests__/golden.test.ts`
Expected: PASS（3 個 it 全綠：27.36 / 6.15 / 2.22）。若紅，先檢查 fixture row 欄位順序與 `toSnap`。

- [ ] **Step 4: 確認 tsconfig 允許 import json**

Run: `grep -n resolveJsonModule tsconfig.json`
Expected: 有 `"resolveJsonModule": true`。若無，加入 `compilerOptions` 後重跑 Step 3。

- [ ] **Step 5: Commit**

```bash
git add lib/disposal/__tests__/fixtures lib/disposal/__tests__/golden.test.ts
git commit -m "test(disposal): 真實6日fixture對拍國巨27.36/同類6.15/全體2.22黃金值"
```

---

### Task 3: `market-avg` route 改用共用層，上櫃改個股等權

**Files:**
- Modify: `app/api/market-avg/route.ts`

> 維持回傳格式 `{ twse:{avg}, tpex:{avg}, baseDate, lastClosedDate, knownIntervals }`（DisposalTool 依賴），只把資料來源換成共用層、上櫃改等權。交易日窗口仍用指數序列(TAIEX / tpex_index)決定。

- [ ] **Step 1: 改寫 route**

```ts
// app/api/market-avg/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { fetchTwseDailyPct, fetchTpexDailyPct, cumulativeMap, eqAvg } from '@/lib/disposal/marketData'

const WINDOW = 6
const pad = (n: number) => String(n).padStart(2, '0')
const toYMD = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const idxNum = (s: unknown): number | null => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
const rocToYMD = (roc: string) => { const m = roc.match(/(\d+)\/(\d+)\/(\d+)/); return m ? `${+m[1] + 1911}${pad(+m[2])}${pad(+m[3])}` : '' }
const UA = 'Mozilla/5.0'

/** 上櫃櫃買指數收盤 { YYYYMMDD: close }（僅用來定出上櫃交易日窗口） */
async function fetchTpexIndexDates(): Promise<string[]> {
  try {
    const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    return ((await res.json()) as { Date: string }[]).map(r => r.Date).filter(d => /^\d{8}$/.test(d))
  } catch { return [] }
}
/** 上市 TAIEX 交易日（抓指定月，回 YYYYMMDD 陣列），僅用來定窗口 */
async function fetchTwseIndexDates(ymd: string): Promise<string[]> {
  try {
    const res = await fetch(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${ymd}`, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const j = (await res.json()) as { data?: string[][] }
    return (j.data ?? []).map(r => rocToYMD(String(r[0]))).filter(Boolean)
  } catch { return [] }
}

/** 取 ≤ endYMD 的最近 WINDOW 個交易日(升冪)的「interval 部分」= slice(1) (5 日) */
function intervalDays(allDates: string[], endYMD: string): string[] {
  const win = [...new Set(allDates)].filter(d => d <= endYMD).sort().slice(-WINDOW)
  return win.slice(1)   // 5 個 interval-end 日
}

/** 抓多日個股漲跌%並等權累積平均（全市場，不排除） */
async function eqAvgOverDays(days: string[], fetcher: (d: string) => Promise<Record<string, number> | null>): Promise<number | null> {
  if (days.length < 1) return null
  const snaps: Record<string, number>[] = []
  for (const d of days) { const s = await fetcher(d); if (!s) return null; snaps.push(s) }
  return eqAvg(cumulativeMap(snaps)).avg
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const bust = params.get('bust') === '1'
  const dateParam = params.get('date')
  const endYMD = dateParam && /^\d{8}$/.test(dateParam) ? dateParam : toYMD(new Date())

  const cacheKey = `market-avg:eq:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  const prevMonthYMD = toYMD(new Date(+endYMD.slice(0, 4), +endYMD.slice(4, 6) - 2, 15))
  const [tpexDates, twA, twB] = await Promise.all([
    fetchTpexIndexDates(), fetchTwseIndexDates(endYMD), fetchTwseIndexDates(prevMonthYMD),
  ])
  const twDates = [...twB, ...twA]
  const twIv = intervalDays(twDates, endYMD)
  const tpIv = intervalDays(tpexDates, endYMD)

  const [twAvg, tpAvg] = await Promise.all([
    eqAvgOverDays(twIv, fetchTwseDailyPct),
    eqAvgOverDays(tpIv, fetchTpexDailyPct),
  ])

  const lastClosed = twIv.at(-1) ?? tpIv.at(-1) ?? endYMD
  const baseDate = (twDates.filter(d => d <= endYMD).sort().slice(-WINDOW)[0]) ?? ''
  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值：上市/上櫃皆=普通股逐日漲跌%(2位無條件捨去)相加再等權平均；當日(下一交易日)以0%計',
    twse: { avg: twAvg }, tpex: { avg: tpAvg },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
```

- [ ] **Step 2: 型別/lint 檢查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i market-avg`
Expected: 無輸出（market-avg 無型別錯誤）。

- [ ] **Step 3: 冒煙測試（需網路；dev server 起著）**

Run: `npm run dev`（背景），另開 `curl -s "http://localhost:3000/api/market-avg?date=20260529&bust=1"`
Expected: JSON 含 `twse.avg`、`tpex.avg` 皆為數字（非 null）；`note` 顯示「上市/上櫃皆…等權平均」。

- [ ] **Step 4: Commit**

```bash
git add app/api/market-avg/route.ts
git commit -m "refactor(market-avg): 改用共用資料層，上櫃全體均值改個股等權(同上市口徑)"
```

---

### Task 4: 新 route `app/api/sectoravg/route.ts`

**Files:**
- Create: `app/api/sectoravg/route.ts`

> 輸入 `?market=TWSE&code=2327&win=20260525,20260526,20260527,20260528,20260529`（win = 5 個 interval-end 日，= DisposalTool 的 `days.slice(1)` 各日 YMD）。回傳 `{ targetCum, sectorAvg, marketAvg, sectorCode, sectorN, marketN }`，sectorAvg/marketAvg 皆**排除標的本身**。快取 per market:win。

- [ ] **Step 1: 實作 route**

```ts
// app/api/sectoravg/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { fetchTwseDailyPct, fetchTpexDailyPct, fetchSectorMap, cumulativeMap, eqAvg, type Market } from '@/lib/disposal/marketData'

export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const market = (p.get('market') === 'TPEx' ? 'TPEx' : 'TWSE') as Market
  const code = (p.get('code') ?? '').trim()
  const win = (p.get('win') ?? '').split(',').map(s => s.trim()).filter(s => /^\d{8}$/.test(s))
  if (!code || win.length < 1) return NextResponse.json({ error: 'need code & win' }, { status: 400 })

  const cacheKey = `sectoravg:${market}:${win.join('-')}`
  let cached = getCached(cacheKey) as { cums: Record<string, number>; sectorMap: Record<string, string> } | undefined
  if (p.get('bust') === '1') cached = undefined

  let cums: Record<string, number>, sectorMap: Record<string, string>
  if (cached) { cums = cached.cums; sectorMap = cached.sectorMap }
  else {
    const fetcher = market === 'TWSE' ? fetchTwseDailyPct : fetchTpexDailyPct
    const snaps: Record<string, number>[] = []
    for (const d of win) { const s = await fetcher(d); if (!s) return NextResponse.json({ error: `fetch fail ${d}` }, { status: 200 }) ; snaps.push(s) }
    cums = cumulativeMap(snaps)
    sectorMap = await fetchSectorMap(market)
    setCached(cacheKey, { cums, sectorMap }, 6 * 60 * 60 * 1000)
  }

  const sectorCode = sectorMap[code] ?? null
  const market_ = eqAvg(cums, { exclude: code })
  const sector_ = sectorCode ? eqAvg(cums, { sectorMap, sector: sectorCode, exclude: code }) : { avg: null, n: 0 }
  return NextResponse.json({
    targetCum: code in cums ? +cums[code].toFixed(2) : null,
    marketAvg: market_.avg, marketN: market_.n,
    sectorAvg: sector_.avg, sectorN: sector_.n,
    sectorCode,
  })
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i sectoravg`
Expected: 無輸出。

- [ ] **Step 3: 冒煙測試（dev server 起著，需網路）**

Run: `curl -s "http://localhost:3000/api/sectoravg?market=TWSE&code=2327&win=20260522,20260525,20260526,20260527,20260528"`
Expected: `targetCum≈27.36`、`sectorAvg≈6.15`（sectorCode "28"）、`marketAvg≈2.22`。**這是對拍 attstock 的線上驗證。**

- [ ] **Step 4: Commit**

```bash
git add app/api/sectoravg/route.ts
git commit -m "feat(sectoravg): 個股同類/全體等權均值(排除標的)route，對拍attstock"
```

---

### Task 5: `clauseEngine` 差幅閘加同類項

**Files:**
- Modify: `lib/clauseEngine.ts`
- Test: `lib/clauseEngine.test.ts`（若無則 Create）

> 差幅閘改 `max(全體, 同類)+20`（款一①②、款三同步）。法規：累積漲幅須同時超過全體與同類均值 20% → 取較高的均值當綁定。

- [ ] **Step 1: 寫失敗測試**

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: FAIL（`sectorAvg6` 不在 `ClauseInput` 型別 → TS 編譯錯 / 測試紅）

- [ ] **Step 3: 改 `lib/clauseEngine.ts`**

在 `ClauseInput` 介面 `marketAvg6: number | null` 之後加一行：

```ts
  sectorAvg6: number | null
```

新增共用 helper（放在 `priceForCum` 附近）：

```ts
const diffGate = (marketAvg6: number | null, sectorAvg6: number | null): number => {
  const xs = [marketAvg6, sectorAvg6].filter((x): x is number => x != null)
  return xs.length ? Math.max(...xs) + 20 : -Infinity
}
```

把 `c1` 內：

```ts
  const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity
```
改為：
```ts
  const diff = diffGate(inp.marketAvg6, inp.sectorAvg6)
```

把 `c3` 內同一行 `const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity` 改為：
```ts
  const diff = diffGate(inp.marketAvg6, inp.sectorAvg6)
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: PASS（3 個 it 全綠）

- [ ] **Step 5: Commit**

```bash
git add lib/clauseEngine.ts lib/clauseEngine.test.ts
git commit -m "feat(clauseEngine): 款一/款三差幅閘改 max(全體,同類)+20"
```

---

### Task 6: `DisposalTool` 接線 — 匯入時抓 sectoravg、餵引擎、款一卡片顯示兩行均值

**Files:**
- Modify: `components/DisposalTool.tsx`

- [ ] **Step 1: 新增 state（在 `marketAvg` state 宣告之後，約 line 359 後）**

```tsx
  // 同類/全體均值（匯入個股後，用個股實際 6 日窗口自算；排除標的本身）
  const [sectorAvg, setSectorAvg] = useState<{ sectorAvg: number | null; marketAvg: number | null; sectorCode: string | null; targetCum: number | null } | null>(null)
```

- [ ] **Step 2: 匯入成功後抓 sectoravg（在 `doImport` 與 `importFromList` 兩處的「款十二：借券」fetch 區塊後各加一段）**

`doImport`（約 line 461 後，`}` 關閉借券區塊之前的同層）插入：

```tsx
          // 同類/全體均值：用近 6 日的「最近 5 個 interval 日」(= days.slice(1)) 作窗口
          {
            const winYMDs = all.slice(-5).map(d => d.date.replace(/-/g, ''))
            setSectorAvg(null)
            fetch(`/api/sectoravg?market=${json.market}&code=${code}&win=${winYMDs.join(',')}`)
              .then(r => r.json()).then(d => { if (!d.error) setSectorAvg(d) }).catch(() => setSectorAvg(null))
          }
```

在 `importFromList`（約 line 555 後）插入相同片段。

- [ ] **Step 3: 把 sectorAvg6 餵進引擎與 thresh**

改 `mAvgPct` 衍生（約 line 682）下方，新增：

```tsx
  // 同類均值%（當前市場別；匯入後才有）。窗口與 mAvgPct 對齊：皆為近6日的5個interval
  const sAvgPct = sectorAvg?.sectorAvg ?? null
  // 匯入個股後，全體均值改用 sectoravg 回傳值(同窗口、排除自己)；未匯入時用 mount 載入的 marketAvg
  const mAvgEff = sectorAvg?.marketAvg ?? mAvgPct
```

`evalCard`（約 line 717）的 `marketAvg6: mAvgPct,` 改為兩行：

```tsx
    marketAvg6: mAvgEff,
    sectorAvg6: sAvgPct,
```

- [ ] **Step 4: `thresh()` 加同類項**

改 `thresh` 簽名與 diff（約 line 113-115）。簽名加 `sAvgPct`：

```ts
const thresh = (bp: number, prevClose: number, sumKnown: number, spreadBase: number, mkt: Market, mAvgPct?: number | null, sAvgPct?: number | null) => {
  const { p1, p2, p3, gap } = MARKET_PCT[mkt]
  const cands = [mAvgPct, sAvgPct].filter((x): x is number => x != null)
  const diffPct = cands.length ? Math.max(...cands) + 20 : -Infinity
```

近 6 日表格呼叫處（約 line 881）改為：
```tsx
                const { t1, t2 } = thresh(d.bp, prevCloseOf(i), knownSumOf(i), spreadBaseOf(i), market, mAvgEff, sAvgPct)
```

- [ ] **Step 5: 款一卡片顯示「全體均值 / 同類均值」兩行（找款一① render 區，在 944-1659 段）**

Run 先定位：`grep -n "全體均值\|差幅\|marketAvg\|款一\|1①" components/DisposalTool.tsx`

在款一卡片（卡 0）展開區，緊接累積漲幅顯示處插入兩行（沿用既有 class 風格）：

```tsx
{i === 0 && (
  <div className="mt-1 space-y-0.5 text-xs">
    <p className="text-gray-400">全體均值 <span className={(mAvgEff ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}>{mAvgEff != null ? `${mAvgEff > 0 ? '+' : ''}${mAvgEff.toFixed(2)}%` : '—'}</span>
      {sectorAvg?.targetCum != null && mAvgEff != null && <span className="text-gray-500 ml-1.5">差幅 {(sectorAvg.targetCum - mAvgEff).toFixed(1)}%（需≥20%）</span>}</p>
    <p className="text-gray-400">同類均值 <span className={(sAvgPct ?? 0) >= 0 ? 'text-red-400' : 'text-green-400'}>{sAvgPct != null ? `${sAvgPct > 0 ? '+' : ''}${sAvgPct.toFixed(2)}%` : '—'}</span>
      {sectorAvg?.targetCum != null && sAvgPct != null && <span className="text-gray-500 ml-1.5">差幅 {(sectorAvg.targetCum - sAvgPct).toFixed(1)}%</span>}
      {sectorAvg?.sectorCode && <span className="text-gray-600 ml-1">（類{sectorAvg.sectorCode}）</span>}</p>
  </div>
)}
```
> 實作時對齊該卡片實際 JSX 結構與縮排；此片段邏輯固定（兩行、紅綠號、差幅=targetCum−均值），位置放在卡 0 累積漲幅下方。

- [ ] **Step 6: 型別檢查 + build**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i disposaltool`
Expected: 無輸出。
Run: `npm run build`
Expected: build 成功（`/api/sectoravg` 出現在 route 清單）。

- [ ] **Step 7: 手動冒煙（dev server）**

Run: 開面板，匯入 `2327`（國巨, 上市）。
Expected: 款一卡片出現「全體均值 +X%」「同類均值 +X%（類28）」兩行；差幅數字合理；近 6 日表格 t1/t2 在同類均值高時被拉高。

- [ ] **Step 8: Commit**

```bash
git add components/DisposalTool.tsx
git commit -m "feat(disposal): 款一接同類差幅閘，卡片顯示全體/同類均值兩行"
```

---

### Task 7: 移除非處置資料（殖利率/股利殘留）

**Files:**
- Modify（視掃描結果）: `app/api/peratio/route.ts`、`components/DisposalTool.tsx`

- [ ] **Step 1: 掃描殘留**

Run: `grep -rn "殖利\|股利\|dividend\|yield\|Yield" app/api/peratio/route.ts components/DisposalTool.tsx lib/clauseEngine.ts`
Expected: 列出所有殘留處（可能為 0）。

- [ ] **Step 2: 移除**

對每個命中：若是 peratio route 回傳欄位 → 從回傳物件與 parse 移除；若是 DisposalTool 顯示 → 刪該 JSX/state。逐處刪除（無命中則跳過本 Task）。

- [ ] **Step 3: 型別檢查 + 測試**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "peratio|disposaltool"` → 無輸出
Run: `npx vitest run` → 全綠

- [ ] **Step 4: Commit（若有變更）**

```bash
git add -A && git commit -m "chore(disposal): 移除與處置無關的殖利率/股利欄位"
```

---

### Task 8: 全測試 + build + 文檔

**Files:**
- Modify: `docs/PROJECT_NOTES.md`、`C:\Users\user\.claude\refs\taiwan-finance-data.md`

- [ ] **Step 1: 全測試 + build**

Run: `npx vitest run`
Expected: 全綠（含 marketData / golden / clauseEngine）。
Run: `npm run build`
Expected: 成功。

- [ ] **Step 2: 更新 PROJECT_NOTES.md**

在處置引擎段落補：「款一①②差幅閘 = max(全體, 同類)+20；全體/同類均值皆自算個股等權累積、排除標的本身；上市/上櫃同口徑（上櫃已自櫃買指數改等權）。新端點 `/api/sectoravg?market&code&win`；共用層 `lib/disposal/marketData.ts`。」

- [ ] **Step 3: 更新 refs/taiwan-finance-data.md**

把舊註記「上櫃全體=櫃買指數加權」更新為：「2026/05/29 起改為上市/上櫃同口徑——全體/同類均值皆個股等權累積(排除標的)；對拍 attstock 新版：國巨27.36/同類6.15/全體2.22。」記錄 TPEx 產業別端點 `mopsfin_t187ap03_O`、dailyQuotes 欄位(col0/2/3)。

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_NOTES.md
git commit -m "docs: 記錄同類差幅閘 + 上櫃改等權 + sectoravg 端點"
```

- [ ] **Step 5: 清理暫存**

Run: `rm -rf .tmp_sec`（fixture 已複製進 `lib/disposal/__tests__/fixtures/`）

---

## Self-Review

- **Spec coverage：** ①自算等權同類/全體均值(上市+上櫃)→Task 1/3/4；②接進款一①②差幅→Task 5/6；④移除殖利率→Task 7。③盤中即時卡片→明列為 Phase B（範圍外）。
- **Type consistency：** `Market`、`cumulativeMap`/`eqAvg`/`fetchTwseDailyPct`/`fetchTpexDailyPct`/`fetchSectorMap` 命名於 Task 1 定義，Task 3/4 沿用一致；`ClauseInput.sectorAvg6` 於 Task 5 定義並於 Task 6 `evalCard` 提供；`thresh` 新增 `sAvgPct` 參數於 Task 6 兩處呼叫皆更新。
- **無 placeholder：** 各步皆附完整程式碼/指令/預期輸出。Task 6 Step 5 的 JSX 位置需對齊實檔結構（已標註），邏輯片段完整。
- **黃金值鎖定：** 27.36 / 6.15 / 2.22（窗口 5/22~28）於 Task 2 固化為回歸測試。

## 注意（Phase B 前置）

盤中即時卡片需先偵察：上櫃即時行情端點；MIS 個股即時 `getStockInfo.jsp`（帶 Referer）批次抓 7 時點。屬獨立 UI 狀態機與排程，另開計劃。
