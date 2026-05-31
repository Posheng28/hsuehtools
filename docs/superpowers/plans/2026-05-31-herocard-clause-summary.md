# heroCard 注意線精簡 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 heroCard 上半部四段重複資訊精簡成「款一獨立一行（改顯示『只能再漲 +X%』）＋款二~六單行摘要（只顯示最容易觸及者的缺口、隱藏漲停內不可達者）」。

**Architecture:** 判定與門檻數字由引擎 `lib/clauseEngine.ts` 唯一產出——`ClauseResult` 加 `priceFloor`/`gateText` 兩欄、新增純函式 `pickWatchSummary(results, maxP)`；UI 層 `components/DisposalTool.tsx` 的 `heroCard` 近乎純渲染（過濾/排序交給引擎函式）。判定邏輯、`fired`/`summarize` 計數、`AttentionDetailPanel` 完全不動。

**Tech Stack:** Next.js 16.2.6（Turbopack、App Router）、TypeScript strict、React 19、Tailwind 4、vitest 4。`npm run build`＝CI gate（tsc＋ESLint，未使用變數會擋）；`npm test`＝vitest run。

> 設計來源：`docs/superpowers/specs/2026-05-31-herocard-clause-summary-design.md`
> ⚠️ 指令於專案根目錄執行：Bash 預設 cwd 為 home，需先 `cd "C:/Users/user/chart-overlay"`。
> ⚠️ Next.js 有破壞性改動；本輪只改既有 React 元件與純 TS 引擎，未用到新 framework API，無需查 `node_modules/next/dist/docs/`。

---

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `lib/clauseEngine.ts` | 修改 | `ClauseResult` 加 `priceFloor`/`gateText`；各 evaluator 設值；加 `upPct` helper；新增 export `pickWatchSummary` |
| `lib/clauseEngine.test.ts` | 修改 | 新增 `priceFloor`/`gateText` 欄位測試、`pickWatchSummary` 測試 |
| `components/DisposalTool.tsx` | 修改 | `heroCard`：款一行改 %、款二~六摘要行、移除「為什麼/卡在哪一條」段、移除常駐第二款區塊、清理未使用變數 |
| `docs/PROJECT_NOTES.md` | 修改 | 補記 heroCard 精簡與 `pickWatchSummary` |

---

## Task 1: 引擎 `ClauseResult` 加 `priceFloor`/`gateText`

**Files:**
- Modify: `lib/clauseEngine.ts`（interface 9-20；helper 22-26；evaluators `c1`108-131 / `c2`133-152 / `c3`154-183 / `c4`185-214 / `c5`216-232 / `c6`234-264）
- Test: `lib/clauseEngine.test.ts`

- [ ] **Step 1: 寫失敗測試**（在 `lib/clauseEngine.test.ts` 末尾、`對拍 attstock` describe 之後，新增）：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗（型別/缺欄位）**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: FAIL — `priceFloor`/`gateText` 不存在於 `ClauseResult`（TS 編譯錯）。

- [ ] **Step 3: interface 加兩欄**（`lib/clauseEngine.ts`，`headerThreshold: string` 那行之後）：

```ts
  headerThreshold: string
  priceFloor: number | null   // 觸發所需收盤價下限；款二/六無價格門檻為 null
  gateText: string            // 單行摘要用：最關鍵剩餘門檻（缺口）
  groups: CondGroup[]
```

- [ ] **Step 4: 加 `upPct` helper**（接在 `const fmtLot = ...` 那行之後）：

```ts
// 由現價漲到 target 的百分比（target > cur 時為正）— 摘要行「再漲 X%」缺口
const upPct = (target: number, cur: number) => cur > 0 ? (target / cur - 1) * 100 : 0
```

- [ ] **Step 5: `c1` 兩個 return 物件加欄位**

`r1`（款一①）的 `headerThreshold: \`收盤 ≥ ${t1}\`,` 之後加：
```ts
    priceFloor: t1, gateText: `收盤 ≥ ${t1}`,
```
`r2`（款一②）的 `headerThreshold: \`收盤 ≥ ${t2}（含起迄價差 ≥ ${m.gap} 元）\`,` 之後加：
```ts
    priceFloor: t2, gateText: `收盤 ≥ ${t2}（起迄價差 ≥ ${m.gap} 元）`,
```

- [ ] **Step 6: `c2` return 加欄位**（`headerThreshold: ...,` 之後）：

```ts
    priceFloor: null, gateText: '當日需收紅',
```

- [ ] **Step 7: `c3` return 加欄位**（`headerThreshold: ...,` 之後）：

```ts
    priceFloor: t3,
    gateText: priceMet
      ? (volThresh != null ? `量 ≥ ${fmtLot(volThresh)}張` : '量達標')
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
```

- [ ] **Step 8: `c4` return 加欄位**（`headerThreshold: ...,` 之後）：

```ts
    priceFloor: t3,
    gateText: priceMet
      ? (turnoverLot != null ? `量 ≥ ${fmtLot(turnoverLot)}張` : `週轉率 ≥ ${m.turnover}%`)
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
```

- [ ] **Step 9: `c5` return 加欄位**（`headerThreshold: ...,` 之後）：

```ts
    priceFloor: t3,
    gateText: priceMet
      ? `券商佔比 > ${m.brokerConc}%`
      : `收盤 ≥ ${t3}（再漲 +${upPct(t3, inp.price).toFixed(1)}%）`,
```

- [ ] **Step 10: `c6` return 加欄位**（`headerThreshold: ...,` 之後）：

```ts
    priceFloor: null,
    gateText: c6VolLot != null ? `量 ≥ ${fmtLot(c6VolLot)}張` : `量 ≥ ${m.c6MinLot}張`,
```

- [ ] **Step 11: 跑測試確認通過**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: PASS（含既有測試不回歸）。

- [ ] **Step 12: Commit**

```bash
git add lib/clauseEngine.ts lib/clauseEngine.test.ts
git commit -m "feat(clauseEngine): add priceFloor/gateText to ClauseResult"
```

---

## Task 2: 引擎新增 `pickWatchSummary(results, maxP)`

**Files:**
- Modify: `lib/clauseEngine.ts`（接在 `summarize` 之後）
- Test: `lib/clauseEngine.test.ts`

- [ ] **Step 1: 寫失敗測試**（在 `lib/clauseEngine.test.ts` 末尾新增）：

```ts
describe('pickWatchSummary 摘要挑選（款二~六）', () => {
  it('博磊型：款三/四/五 t3 超出漲停、款二 safe、款六 possible → 取款六', () => {
    const rs = evalClauses({ ...base, price: 130, sharesOutstanding: 1_000_000, pe: 200, pbr: 12, mktPe: 20, mktPbr: 2 })
    const pick = pickWatchSummary(rs, 120)   // 漲停 120 < t3 125.5 → 款三/四/五 不可達
    expect(pick?.id).toBe('6')
  })
  it('多款可能且 t3≤漲停 → badge 平手取款號小者(款三)', () => {
    const rs = evalClauses({ ...base, price: 130, avgVol60: 1000, sharesOutstanding: 1_000_000, pe: 200, pbr: 12, mktPe: 20, mktPbr: 2 })
    expect(pickWatchSummary(rs, 200)?.id).toBe('3')
  })
  it('全 safe 但價格可達(t3≤漲停) → 仍取款三、badge safe', () => {
    const rs = evalClauses({ ...base, price: 120 })  // 120 < t3 125.5 → 款三/四/五 safe
    const pick = pickWatchSummary(rs, 130)           // 125.5 ≤ 130 可達
    expect(pick?.id).toBe('3')
    expect(pick?.badge).toBe('safe')
  })
  it('全不可達（t3>漲停、款二/六 safe）→ null', () => {
    const rs = evalClauses({ ...base, price: 120 })
    expect(pickWatchSummary(rs, 120)).toBeNull()
  })
  it('款一(1①/1②)即使 fired 也不入選（只看款二~六）', () => {
    const rs = evalClauses({ ...base, price: 133 })  // 款一① fired
    const pick = pickWatchSummary(rs, 140)
    expect(['2', '3', '4', '5', '6']).toContain(pick?.id)
    expect(pick?.id).toBe('3')
  })
})
```

- [ ] **Step 2: 測試 import 加 `pickWatchSummary`**（`lib/clauseEngine.test.ts` 第 3 行）：

```ts
import { evalClauses, summarize, pickWatchSummary, sectorAppliesForPe, SECTOR_PE_LIMIT, type ClauseInput, type ClauseResult } from '@/lib/clauseEngine'
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: FAIL — `pickWatchSummary` 未匯出。

- [ ] **Step 4: 實作 `pickWatchSummary`**（`lib/clauseEngine.ts`，接在 `summarize` 函式之後）：

```ts
const SUMMARY_IDS: ClauseId[] = ['2', '3', '4', '5', '6']   // 款一另行顯示，排除
const BADGE_RANK: Record<ClauseResult['badge'], number> = { fired: 2, possible: 1, safe: 0 }

// 款二~六 單行摘要：挑「最容易觸及」者。
// 可達性：價格型款(priceFloor!=null) 需 priceFloor ≤ 漲停 maxP；量能/比率型(null) 需 badge≠safe。
// 排序：badge 嚴重度降冪，平手取款號小者。皆不可達回 null。
export function pickWatchSummary(results: ClauseResult[], maxP: number): ClauseResult | null {
  const feasible = results.filter(r =>
    SUMMARY_IDS.includes(r.id) &&
    (r.priceFloor != null ? r.priceFloor <= maxP + 1e-9 : r.badge !== 'safe'))
  if (!feasible.length) return null
  feasible.sort((a, b) => (BADGE_RANK[b.badge] - BADGE_RANK[a.badge]) || a.id.localeCompare(b.id))
  return feasible[0]
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run lib/clauseEngine.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/clauseEngine.ts lib/clauseEngine.test.ts
git commit -m "feat(clauseEngine): add pickWatchSummary for 款二~六 single-line summary"
```

---

## Task 3: heroCard 款一行改「只能再漲 %」+ import

**Files:**
- Modify: `components/DisposalTool.tsx`（import 第 4 行；heroCard 變數區 ~1241-1248；款一答案行 ~1308-1311）

- [ ] **Step 1: import 加 `pickWatchSummary`**（第 4 行）：

old:
```ts
import { evalClauses, summarize, sectorAppliesForPe, SECTOR_PE_LIMIT, type ClauseResult } from '@/lib/clauseEngine'
```
new:
```ts
import { evalClauses, summarize, pickWatchSummary, sectorAppliesForPe, SECTOR_PE_LIMIT, type ClauseResult } from '@/lib/clauseEngine'
```

- [ ] **Step 2: heroCard 變數區整理**（清理未使用變數、加 `pct`/`watch`）

old（`const { p1, p2, gap } = ...` 起到 `const rows = ...` 止，即現 1241-1263 整段）：
```tsx
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
```
new：
```tsx
    const gateVals    = [mAvgEff, sAvgGate].filter((x): x is number => x != null)
    const gate        = gateVals.length ? Math.max(...gateVals) + 20 : null
    const stockName   = importStatus.stockName
    const mktLabel    = market === 'TWSE' ? '上市' : '上櫃'
    const pct         = curPrice > 0 ? (c1.price / curPrice - 1) * 100 : 0   // 款一：只能再漲 %
    const watch       = pickWatchSummary(evalCard(0, curPrice), maxP)        // 款二~六：最容易觸及者
```

- [ ] **Step 3: 款一答案行改 % 顯示**

old（現 1308-1311）：
```tsx
          {toNotice > 1e-9
            ? <span className="text-amber-400 text-sm font-semibold">離現價 +{fNum(toNotice)} 元</span>
            : <span className="text-red-400 text-sm font-semibold">已突破注意線</span>}
```
new：
```tsx
          {pct > 1e-9
            ? <span className="text-amber-400 text-sm font-semibold">只能再漲 +{pct.toFixed(1)}%</span>
            : <span className="text-red-400 text-sm font-semibold">已突破注意線</span>}
```

- [ ] **Step 4: build 確認暫時失敗（rows/cum 等已移除但「卡在哪一條」JSX 仍引用）**

Run: `npm run build`
Expected: FAIL — `rows`/`cum`/`eff1` 等在 JSX（為什麼段/卡在哪一條）仍被引用。**Task 4 移除該 JSX 後恢復綠**（此為刻意的中繼狀態）。

> 註：Task 3+4 是同一 heroCard 區塊的拆分，需連續完成；單獨 Task 3 後 build 不綠屬預期。

---

## Task 4: 以款二~六摘要行取代「為什麼/卡在哪一條」段

**Files:**
- Modify: `components/DisposalTool.tsx`（heroCard 內「為什麼是這條注意線」`<p>` + 「卡在哪一條」`<div>`，現 1314-1349）

- [ ] **Step 1: 移除兩段、置入摘要行**

old（現 1314-1349，整段「為什麼」`<p>` 起到「卡在哪一條」`</div>` 止）：
```tsx
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
```
new：
```tsx
        {/* 款二~六：只顯示最容易觸及者的缺口；漲停內不可達者隱藏 */}
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm border-t border-gray-800 pt-3">
          <span className="text-gray-400 w-16 shrink-0">款二~六</span>
          {watch ? (
            <>
              <span className="font-semibold text-gray-200">款{watch.id}</span>
              <span className="text-gray-300">{watch.gateText}</span>
              <span className={
                watch.badge === 'fired' ? 'text-red-400 text-xs'
                : watch.badge === 'possible' ? 'text-amber-400 text-xs'
                : 'text-gray-500 text-xs'}>
                {watch.badge === 'fired' ? '已觸發' : watch.badge === 'possible' ? '可能觸發' : '距門檻尚遠'}
              </span>
              {watch.id === '2' && livePrice != null && quoteMeta?.prevClose != null && (
                <span className="text-[11px] text-gray-500">
                  · 盤中 {fNum(livePrice)} {livePrice > quoteMeta.prevClose ? '＞' : '≤'} 昨收 {fNum(quoteMeta.prevClose)} →{' '}
                  {livePrice > quoteMeta.prevClose
                    ? <b className="text-yellow-300">目前收紅</b>
                    : <b className="text-green-300">目前收黑</b>}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-500">今日漲停內皆無法觸及</span>
          )}
        </div>
```

- [ ] **Step 2: build 確認綠**

Run: `npm run build`
Expected: PASS（tsc 無誤、ESLint 無未使用變數）。

- [ ] **Step 3: 跑全測試**

Run: `npm test`
Expected: PASS（既有 + 新增測試全綠）。

- [ ] **Step 4: Commit**

```bash
git add components/DisposalTool.tsx
git commit -m "feat(disposal): 款一行改顯示再漲%、款二~六縮成單行摘要"
```

---

## Task 5: 移除常駐「第二款狀態」整塊

**Files:**
- Modify: `components/DisposalTool.tsx`（常駐第二款 block，現 1489-1558）

- [ ] **Step 1: 移除整塊**（收紅指示已移入 Task 4 摘要行的款二分支；豁免狀態由 `AttentionDetailPanel` 款二卡呈現）

old（現 1489-1558，`{/* ── 第二款狀態 ... */}` 起到對應 `})()}` 止）：
```tsx
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
```
new：（整段刪除，不留空白佔位；上一個元素是 `{heroCard}`、下一個是 `🎮 互動沙盤` 區塊）
```tsx

```

- [ ] **Step 2: build 確認綠**（確認 `CLAUSE2`/`livePrice`/`quoteMeta` 在他處仍有引用，無未使用 import）

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: 跑全測試**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add components/DisposalTool.tsx
git commit -m "refactor(disposal): 移除常駐第二款區塊（收紅併入款二~六摘要行）"
```

---

## Task 6: 驗證 + 對拍 + 文檔

**Files:**
- Modify: `docs/PROJECT_NOTES.md`

- [ ] **Step 1: 全測試 + build gate**

Run: `npm test && npm run build`
Expected: 全綠；vitest 全數通過、build 成功。

- [ ] **Step 2: 手動對拍（dev server）**

Run: `npm run dev`，匯入博磊 3581，人工核對 heroCard：
- 款一行顯示「現價 → 注意線 {價}（款一①/②） 只能再漲 +X%」，且 X% ≈ `(注意線/現價−1)×100`。
- 款二~六行顯示「款六 量 ≥ 2,550 張〔可能觸發〕」（款三/四/五 因 309 > 漲停 260 隱藏）。
- 「為什麼是這條注意線」段、「卡在哪一條」表、常駐「第二款狀態」整塊皆已消失。
- 處置距離 chips、差幅閘門明細、可展開六卡面板皆仍在。
- 再換一檔款二觸發中的股票，確認摘要行顯示「款二 當日需收紅 … 盤中 … 目前收紅/收黑」。

- [ ] **Step 3: 更新 `docs/PROJECT_NOTES.md`**

在 heroCard / 注意面板相關段落補一段（依現有章節風格）：
```md
## heroCard 注意線精簡（2026-05-31）
- 款一獨立一行：保留注意線價＋款一①/②綁定標準，「離現價 +X 元」改為「只能再漲 +X%」（基準＝現價）。
- 款二~六縮成單行摘要：引擎 `pickWatchSummary(results, maxP)` 過濾＋排序——價格型款(款三/四/五，priceFloor=t3)需 t3≤漲停才算可達；量能/比率型(款二/六，priceFloor=null)需 badge≠safe。取 badge 最嚴重者、平手取款號小者；全不可達顯示「今日漲停內皆無法觸及」。最接近者是款二時標「當日需收紅」並帶盤中收紅/收黑。
- `ClauseResult` 新增 `priceFloor: number|null`、`gateText: string`（引擎為唯一真相來源，UI 純渲染）。
- 移除：heroCard「為什麼是這條注意線」段、「卡在哪一條」表、常駐「第二款狀態」整塊（收紅併入摘要行；豁免狀態由 AttentionDetailPanel 款二卡呈現）。
```

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT_NOTES.md
git commit -m "docs: 記錄 heroCard 注意線精簡與 pickWatchSummary"
```

---

## 自審清單（撰寫後檢查，已逐項過）

- **Spec 覆蓋**：款一改% → Task 3-4；款二~六摘要 → Task 2+4；不可達隱藏 → Task 2（pickWatchSummary 可達性）；款二收紅 → Task 4 摘要行分支；移除三段 → Task 4-5；保留面板/chips/差幅 details → 未動。✓
- **無 placeholder**：所有步驟含完整碼/指令/預期輸出。✓
- **型別一致**：`priceFloor: number|null`、`gateText: string`、`pickWatchSummary(results, maxP)` 在引擎、測試、UI 三處名稱一致。`watch.id`/`watch.gateText`/`watch.badge` 對應 `ClauseResult`。✓
- **中繼狀態標註**：Task 3 後 build 暫時不綠（rows 仍被引用），Task 4 修復——已於 Task 3 Step 4 註明，需連續完成。✓
- **Git 安全**：每 Task 結尾 commit。⚠️ **使用者全域規則：未經明示不得 commit/push**；執行時若採 commit step，須先取得使用者同意，或改為「完成後一次性由使用者授權 commit」。
```
