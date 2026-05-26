# 全體均值改用加權指數 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `market-avg` 的「全體均值」從『全市場個股逐日截斷相加後等權平均(4.92)』改成『官方發行量加權指數(TAIEX/櫃買指數)的逐日漲跌%相加(9.98)』，對齊 attstock。

**Architecture:** `market-avg` 不再逐檔抓全市場股價，改抓兩個官方指數日收盤序列，取與個股相同的 6 日窗口(5 間隔)、逐日漲跌%相加（全精度）當全體均值。DisposalTool 另修一個次要點：款一②「起迄價差」基準改用 6 日窗口第一天收盤。

**Tech Stack:** Next.js 16 App Router, TypeScript；資料源：TWSE `MI_5MINS_HIST`(TAIEX 月 OHLC)、TPEx OpenAPI `tpex_index`(櫃買指數日收盤)。無既有測試框架 → 以 Node 驗證腳本 + 本機 dev server 預覽當驗證。

---

## 已確認資料源（實測）

- **上櫃 櫃買指數**：`GET https://www.tpex.org.tw/openapi/v1/tpex_index`
  回 JSON array：`[{"Date":"20260526","Open":"437.65","High":"...","Low":"...","Close":"439.30","Change":"4.31"}, ...]`，**Date=西元YYYYMMDD**、`Close`=收盤指數字串。涵蓋最近約一個月(~17 交易日)，無 date 參數。
- **上市 TAIEX(發行量加權股價指數)**：`GET https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=YYYYMMDD`
  回 `{fields:[日期,開盤,最高,最低,收盤], data:[["115/05/04","39,228.39","40,755.52","39,228.39","40,705.14"], ...]}`。
  **ROC 日期**(民國)、`data[i][4]`=收盤指數(含千分位逗號)。`date` 指定的「該月」全月。
- 驗證數字（窗口 5/19→5/26，櫃買指數）：收盤 398.18→439.30，逐日%相加(全精度)=**9.98**，截斷相加=9.97，比值=10.33。attstock `marketAvg=9.98` → 採**全精度相加**。

## File Structure

- **Modify `app/api/market-avg/route.ts`**：核心改寫。新增指數抓取與純函式 `sumDailyPct`，GET 改用指數算全體均值；移除逐檔股價抓取與 marketStore 用法。
- **Modify `components/DisposalTool.tsx`**：新增 `spreadBaseOf(i)`，`thresh` 的「起迄價差」基準改用窗口第一天。
- **Maybe delete `lib/marketStore.ts`**：若僅被 market-avg 使用則刪除（Task 3 先 grep 確認）。

---

## Task 1: 指數抓取 + 純累積函式（market-avg）

**Files:**
- Modify: `app/api/market-avg/route.ts`
- Verify script (暫存，驗證後刪): `scripts/verify-index.mjs`

- [ ] **Step 1: 寫驗證腳本（先失敗）** — 建 `scripts/verify-index.mjs`，直接複製即將實作的純函式並對真實指數對拍。

```js
// scripts/verify-index.mjs
const trunc2 = (x) => Math.trunc(x * 100) / 100;
// 逐日漲跌%相加（全精度）。closes 為「基準日→最近收盤日」共 6 個收盤（升冪），回傳 5 間隔相加%
function sumDailyPct(closes) {
  let s = 0;
  for (let i = 1; i < closes.length; i++) s += (closes[i] / closes[i - 1] - 1) * 100;
  return s;
}
async function tpexCloses() {
  const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const d = await r.json();
  return Object.fromEntries(d.map(x => [x.Date, parseFloat(String(x.Close).replace(/,/g, ''))]));
}
const m = await tpexCloses();
const days = ['20260519','20260520','20260521','20260522','20260525','20260526'];
const closes = days.map(x => m[x]);
const avg = sumDailyPct(closes);
console.log('tpex 全體均值 =', avg.toFixed(2), '(expect 9.98)');
if (Math.abs(avg - 9.98) > 0.05) { console.error('FAIL'); process.exit(1); }
console.log('PASS');
```

- [ ] **Step 2: 跑腳本確認可對拍**

Run: `node scripts/verify-index.mjs`
Expected: `tpex 全體均值 = 9.98 (expect 9.98)` 然後 `PASS`（證明資料源+演算法正確）。

- [ ] **Step 3: 在 route.ts 實作純函式與兩個指數抓取器**（取代後續會用到的工具）。在 `avgCumulative` 上方插入：

```ts
// 逐日漲跌%相加（全精度）。closes 升冪(基準→最近收盤)，回傳 (closes.length-1) 個間隔相加%
function sumDailyPct(closes: number[]): number {
  let s = 0
  for (let i = 1; i < closes.length; i++) s += (closes[i] / closes[i - 1] - 1) * 100
  return s
}
const idxNum = (s: unknown): number | null => {
  const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n
}
const rocToYMD = (roc: string) => {
  const m = roc.match(/(\d+)\/(\d+)\/(\d+)/); if (!m) return ''
  return `${+m[1] + 1911}${pad(+m[2])}${pad(+m[3])}`
}
/** 上櫃櫃買指數收盤 { YYYYMMDD: close }（OpenAPI，最近約一個月） */
async function fetchTpexIndex(): Promise<Record<string, number>> {
  try {
    const res = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_index', { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const arr = (await res.json()) as { Date: string; Close: string }[]
    const out: Record<string, number> = {}
    for (const r of arr) { const c = idxNum(r.Close); if (/^\d{8}$/.test(r.Date) && c) out[r.Date] = c }
    return out
  } catch { return {} }
}
/** 上市 TAIEX 收盤 { YYYYMMDD: close }，抓指定月份(YYYYMMDD)；自動含整月 */
async function fetchTwseIndexMonth(ymd: string): Promise<Record<string, number>> {
  try {
    const res = await fetch(`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date=${ymd}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return {}
    const j = (await res.json()) as { data?: string[][] }
    const out: Record<string, number> = {}
    for (const row of j.data ?? []) { const d = rocToYMD(String(row[0])); const c = idxNum(row[4]); if (d && c) out[d] = c }
    return out
  } catch { return {} }
}
```

- [ ] **Step 4: 跑型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（新函式未被呼叫亦可通過）。

- [ ] **Step 5: Commit**

```bash
git add app/api/market-avg/route.ts
git commit -m "feat(market-avg): add index fetchers + sumDailyPct (not wired yet)"
```

---

## Task 2: GET 改用指數算全體均值

**Files:**
- Modify: `app/api/market-avg/route.ts`（GET 主體）

- [ ] **Step 1: 改寫 GET**，用指數序列取窗口、算全體均值。將現有 GET 內「逐日walk + 抓全市場snapshot + avgCumulative」整段替換為：

```ts
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const bust = params.get('bust') === '1'
  const dateParam = params.get('date')
  const endYMD = dateParam && /^\d{8}$/.test(dateParam) ? dateParam : toYMD(new Date())

  // 取兩市場指數收盤序列（TAIEX 抓 endMonth + 前一月以防跨月；櫃買指數 OpenAPI 給近一個月）
  const prevMonthYMD = toYMD(new Date(+endYMD.slice(0,4), +endYMD.slice(4,6) - 2, 15))
  const [tpexIdx, twseA, twseB] = await Promise.all([
    bust ? fetchTpexIndex() : fetchTpexIndex(),
    fetchTwseIndexMonth(endYMD),
    fetchTwseIndexMonth(prevMonthYMD),
  ])
  const twseIdx = { ...twseB, ...twseA }

  // 取 ≤ endYMD 的最近 WINDOW 個交易日收盤（升冪）
  const pickWindow = (idx: Record<string, number>): { days: string[]; closes: number[] } => {
    const ds = Object.keys(idx).filter(d => d <= endYMD).sort().slice(-WINDOW)
    return { days: ds, closes: ds.map(d => idx[d]) }
  }
  const tpW = pickWindow(tpexIdx)
  const twW = pickWindow(twseIdx)

  const mkResult = (w: { days: string[]; closes: number[] }) =>
    w.closes.length === WINDOW
      ? { avg: +sumDailyPct(w.closes).toFixed(2), baseDate: w.days[0], lastClosedDate: w.days[WINDOW - 1] }
      : null

  const tp = mkResult(tpW)
  const tw = mkResult(twW)
  const lastClosed = tw?.lastClosedDate ?? tp?.lastClosedDate ?? endYMD
  const baseDate   = tw?.baseDate ?? tp?.baseDate ?? ''

  const cacheKey = `market-avg:idx:${endYMD}`
  if (!bust) { const c = getCached(cacheKey); if (c) return NextResponse.json({ ...(c as object), cached: true }) }

  const result = {
    knownIntervals: WINDOW - 1,
    baseDate, lastClosedDate: lastClosed,
    note: '全體均值 = 發行量加權指數(上市TAIEX/上櫃櫃買指數)逐日漲跌%相加(全精度)；當日(下一交易日)以0%計',
    twse: tw ? { avg: tw.avg } : { avg: null },
    tpex: tp ? { avg: tp.avg } : { avg: null },
  }
  setCached(cacheKey, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
```

- [ ] **Step 2: 移除不再使用的 import**（若 Task 3 尚未刪 marketStore，先保留 import 但 GET 不呼叫；移除 `loadSnapshot/saveSnapshot/pruneExcept` 的 import 改在 Task 3 處理）。型別檢查：

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 3: 啟動/重用 dev server 驗證**

Run: `curl -s "http://localhost:3000/api/market-avg?date=20260526&bust=1"`
Expected: JSON 含 `"tpex":{"avg":9.98}`、`"baseDate":"20260519"`、`"lastClosedDate":"20260526"`、`twse.avg` 為 TAIEX 對應值（數字非 null）。

- [ ] **Step 4: Commit**

```bash
git add app/api/market-avg/route.ts
git commit -m "feat(market-avg): compute 全體均值 from weighted index daily-sum"
```

---

## Task 3: 移除全市場逐檔抓取的死碼

**Files:**
- Modify/clean: `app/api/market-avg/route.ts`
- Maybe delete: `lib/marketStore.ts`

- [ ] **Step 1: 確認 marketStore 是否還有其他使用者**

Run: `grep -rn "marketStore\|loadSnapshot\|saveSnapshot\|pruneExcept" app lib components`
Expected: 只剩 `market-avg/route.ts`（若有其他檔，保留 marketStore，僅移除 market-avg 內用法）。

- [ ] **Step 2: 刪除 route.ts 內死碼**：移除 `fetchTWSE`、`fetchTPEx`（逐檔版）、`avgCumulative`、`isOrdinary`、`WINDOW` 以外用不到的常數、以及 `import ... marketStore`。保留 `WINDOW`、`pad/toYMD/toSlash`(toSlash若沒用到也刪)、`getCached/setCached`。

- [ ] **Step 3: 若 Step 1 顯示 marketStore 無其他使用者 → 刪檔**

```bash
git rm lib/marketStore.ts
```

- [ ] **Step 4: 型別檢查 + 重新驗證 API 未壞**

Run: `npx tsc --noEmit && curl -s "http://localhost:3000/api/market-avg?date=20260526&bust=1"`
Expected: 無型別錯誤；`tpex.avg=9.98` 依舊。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(market-avg): drop per-stock snapshot machinery (index-based now)"
```

---

## Task 4: 起迄價差基準改用窗口第一天（DisposalTool）

**Files:**
- Modify: `components/DisposalTool.tsx`

- [ ] **Step 1: 新增 `spreadBaseOf` helper**，放在 `prevCloseOf` 定義之後：

```ts
// 起迄價差基準 = 6 日窗口「第一天」收盤（= 基準日的下一交易日；attstock 的 startPrice）
const spreadBaseOf = (i: number) => closePath[i + 1] ?? closePath[i] ?? startPrice
```

- [ ] **Step 2: 改 `thresh` 簽章與價差項**：`thresh` 改收 `spreadBase`，價差用它。

於 `thresh` 定義：

```ts
const thresh = (bp: number, prevClose: number, sumKnown: number, spreadBase: number, mkt: Market, mAvgPct?: number | null) => {
  const { p1, p2, p3, gap } = MARKET_PCT[mkt]
  const diffPct  = mAvgPct != null ? mAvgPct + 20 : -Infinity
  const priceFor = (x: number) => prevClose * (1 + (x - sumKnown) / 100)
  const t1 = nextTick(priceFor(Math.max(p1, diffPct)))
  const t2 = Math.max(nextTick(priceFor(Math.max(p2, diffPct))), clTick(spreadBase + gap))
  const t3 = nextTick(priceFor(Math.max(p3, diffPct)))
  return { t1, t2, t3 }
}
```

- [ ] **Step 3: 更新 `nLvl` 簽章傳遞 spreadBase**：

```ts
function nLvl(price: number, bp: number, prevClose: number, sumKnown: number, spreadBase: number, mkt: Market, mAvgPct?: number | null, volumeMet = false): 0|1|2|3 {
  const { t1, t2, t3 } = thresh(bp, prevClose, sumKnown, spreadBase, mkt, mAvgPct)
  if (price >= t1) return 1
  if (price >= t2) return 2
  if (volumeMet && price >= t3) return 3
  return 0
}
```

- [ ] **Step 4: 更新全部 7 個 `thresh(`/`nLvl(` 呼叫點**，加入 `spreadBaseOf(i)`（或對應 index）。逐一改：
  - notices 迴圈：`nLvl(simPrices[i]!, days[i].bp, prevCloseOf(i), knownSumOf(i), spreadBaseOf(i), market, mAvgPct, i === 0 && clause3VolMet)`
  - 表格列：`thresh(d.bp, prevCloseOf(i), knownSumOf(i), spreadBaseOf(i), market, mAvgPct)`
  - 卡片：`thresh(d.bp, prevClose0, sumKnown, spreadBaseOf(i), market, mAvgPct)` 與對應 `nLvl(chosen, d.bp, prevClose0, sumKnown, spreadBaseOf(i), market, mAvgPct, i===0 && clause3VolMet)`
  - clause3 面板：`thresh(d0.bp, prevCloseOf(0), knownSumOf(0), spreadBaseOf(0), market, mAvgPct)`
  - banner：`thresh(focusDay.bp, prevCloseOf(fIdx), knownSumOf(fIdx), spreadBaseOf(fIdx), market, mAvgPct)`

- [ ] **Step 5: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無錯誤（確認沒有殘留舊 5 參數呼叫）。

- [ ] **Step 6: Commit**

```bash
git add components/DisposalTool.tsx
git commit -m "fix(disposal): 起迄價差基準改用6日窗口第一天(對齊attstock)"
```

---

## Task 5: 端對端驗證（3581）+ 收尾

**Files:** 無（驗證）

- [ ] **Step 1: 預覽驗證**（dev server 在 3000）— 匯入 3581，預測日 5/27，核對：

| 欄位 | 期望（= attstock） |
|---|---|
| 全體均值（上櫃） | **9.98%** |
| 差幅 | **18.4%**（28.39 − 9.98） |
| 款一① 門檻 | **285** |
| 款一② 門檻 | **284.5** |
| 已知累積 | **28.39%** |

用 preview 工具讀卡片文字確認；或 `curl` market-avg 確認 9.98，再人工核卡片。

- [ ] **Step 2: 刪除暫存驗證腳本**

```bash
rm -f scripts/verify-index.mjs
```

- [ ] **Step 3: 更新 PROJECT_NOTES**：在 market-avg 段註明「全體均值 = 加權指數(TAIEX/櫃買指數)逐日漲跌%相加(全精度)；個股款一為逐日截斷相加；起迄價差基準=窗口第一天」。

- [ ] **Step 4: 最終 commit**

```bash
git add docs app components
git commit -m "docs: 更新 PROJECT_NOTES 全體均值=加權指數逐日相加"
```

---

## Self-Review

- **Spec coverage**：全體均值改加權指數(Task 1-2)✓；資料源 TAIEX/櫃買指數(Task 1，已實測)✓；不再個股等權平均(Task 3)✓；起迄價差基準(Task 4)✓；款二/同類維持現狀(未列任務=不動)✓；驗收 9.98/285/284.5/18.4(Task 5)✓。
- **Placeholder scan**：各步含實際程式碼與指令，無 TBD。
- **Type consistency**：`thresh`/`nLvl` 新增 `spreadBase` 參數在 Task 4 統一更新全部 7 呼叫點；`sumDailyPct`/`fetchTpexIndex`/`fetchTwseIndexMonth` 命名一致。
- **已知風險**：(1) 月初窗口跨月時 `tpex_index`(僅近一月)可能不足 6 日 → `tpex.avg=null`、DisposalTool 退回純價格門檻(既有行為，可接受)；TAIEX 已抓前一月緩解。(2) 9.98 採全精度相加；若日後要與 attstock 對到小數更細，再評估其每日%進位法。
