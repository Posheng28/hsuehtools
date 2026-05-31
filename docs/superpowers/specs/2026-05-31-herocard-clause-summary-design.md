# heroCard 注意線精簡（款一擇低顯示 + 款二~六單行摘要）設計文件

**日期**：2026-05-31
**目標**：把處置工具 heroCard 上半部「答案行＋為什麼是這條注意線（整段）＋卡在哪一條（表格）＋常駐第二款狀態（整塊）」四段重複資訊，精簡成兩行——**款一獨立一行**（保留注意線價、把「離現價 +X 元」改成「只能再漲 +X%」），**款二~六縮成一行**只顯示「最容易觸及」那一款的觸發缺口，且**漲停內根本碰不到的款項直接隱藏**。
**架構**：判定邏輯與門檻數字仍由引擎（`lib/clauseEngine.ts`，純函式可單測）唯一產出——`ClauseResult` 擴充 `priceFloor`/`gateText` 兩欄並新增純函式 `pickWatchSummary(results, maxP)` 做可達性過濾＋排序；UI 層（`components/DisposalTool.tsx` 的 `heroCard`）近乎純渲染，不重算門檻。
**技術棧**：Next.js 16.2.6（Turbopack、App Router）、TypeScript strict、React 19、Tailwind 4、vitest 4。`npm run build` 為 CI gate（含 ESLint，未使用變數會擋）。

> ⚠️ Next.js 版本有破壞性改動，動到 framework API 前先讀 `node_modules/next/dist/docs/`。本輪只改既有 React 元件與純 TS 引擎，未用到新 framework API。

---

## 1. 背景與範圍

### 1.1 為什麼做
heroCard 目前上半部資訊重複、囉嗦（以博磊 3581 為例）：
1. **答案行**（現價 → 注意線 309 款一①，離現價 +X 元）。
2. **「為什麼是這條注意線」整段**（款一①/② 取較低者 + 款二是獨立維度）。
3. **「卡在哪一條」表格**（款一 row + 款二 row）。
4. 另有**常駐「第二款狀態」整塊**（含盤中收紅指示燈）。

問題：(a) 款三/四/五 需收盤 ≥ 309，但博磊漲停才 260，**單日漲停都到不了**，卻仍隱含佔版面；(b) 款一①/② 的細節已在可展開的 `AttentionDetailPanel` 六張卡裡，heroCard 再講一次是重複；(c) 款二同時出現在「卡在哪一條」row 與常駐整塊兩處。

### 1.2 範圍
- **款一**：維持獨立一行。沿用 `mergeC1` 同時算款一①、款一②，只顯示**先被踩到的那條**（注意線價較低＝門檻較鬆者）；把「離現價 +X 元」換成「**只能再漲 +X%**」（基準＝現價）。
- **款二~六**：縮成**一行**，只顯示**最容易觸及**的那一款＋其觸發缺口；漲停內不可達者**隱藏**。當最接近門檻者是款二時，行內標出「**當日需收紅**」並（若有盤中價）顯示目前收紅/收黑。
- **不動**：`AttentionDetailPanel`（六張可展開卡＝計算細節，使用者明確要求全保留）、處置距離 chips、差幅閘門明細 `<details>`、頂列識別/盤中報價狀態、**所有判定邏輯**（`fired`/`first`/`summarize` 計數、沙盤模擬、各 evaluator 的觸發判定）。

### 1.3 設計決策（已與使用者確認）
- 款一 %基準＝**現價**（非前收）。
- 款二~六＝**最嚴重（badge 嚴重度）＋只顯示缺口**；不可達隱藏。
- 引擎為唯一真相來源：採「引擎吐 `priceFloor`+`gateText`、UI 只過濾排序」方案（取代「UI 解析 `headerThreshold` 字串」的脆弱做法），避開既有「差幅閘門邏輯有兩份」痛點。

---

## 2. 顯示規格

### 2.1 before / after（博磊 3581，漲停 260、款三/四/五 t3=309、款六量門檻 2,550 張）
**before（囉嗦）**
```
現價 248 → ⚠️ 注意線 309（款一①）  離現價 +61 元  （漲停 260 外，單日拖不到）
注意線取 款一①（…）與 款一②（…）兩者較低者 → … 款二是另一條獨立的線：…（整段）
卡在哪一條（距現價由近到遠）
  款一①  6 日累積漲幅  +12%/32%   還差 20%   觸發 ≥ 309   ◀ 最近
  款二    長期起迄倍漲（不同維度）  90日 105%   可能觸發  · 另需當日收紅
〔下方另有常駐「🟡 第二款：可能觸發！」整塊，含盤中收紅指示〕
```
**after（精簡）**
```
款一      現價 248 → ⚠️ 注意線 309（款一①）  只能再漲 +24.6%  （漲停 260 外，單日拖不到）
款二~六   款六  量 ≥ 2,550 張   〔可能觸發〕
〔處置距離 ①②③④ chips：保留〕
〔📊 差幅閘門明細 ▸：保留〕
〔可展開的注意細節六卡 AttentionDetailPanel：保留〕
```

### 2.2 款一行（改 `DisposalTool.tsx` 約 1300–1312）
- 新增區域變數 `const pct = curPrice > 0 ? (c1.price / curPrice - 1) * 100 : 0`。
- 保留：`{simulated?'模擬現價':'最近收盤'} {curPrice} → ⚠️ 注意線 {c1.price}（款一{c1.std}）`、注意線顏色依 `c1.feasible`、`!c1.feasible` 時「（漲停 {maxP} 外，單日拖不到）」。
- 取代「離現價 +{toNotice} 元」分支：
```tsx
{pct > 1e-9
  ? <span className="text-amber-400 text-sm font-semibold">只能再漲 +{pct.toFixed(1)}%</span>
  : <span className="text-red-400 text-sm font-semibold">已突破注意線</span>}
```

### 2.3 款二~六摘要行（取代「為什麼是這條注意線」段＋「卡在哪一條」表）
- 新增區域變數：`const results = evalCard(0, curPrice)`（沿用既有 `evalCard`，line 796）、`const watch = pickWatchSummary(results, maxP)`。
- 渲染：
```tsx
<div className="flex flex-wrap items-baseline gap-x-2 text-sm border-t border-gray-800 pt-3">
  <span className="text-gray-400 w-16 shrink-0">款二~六</span>
  {watch ? (
    <>
      <span className="font-semibold text-gray-200">款{watch.id}</span>
      <span className="text-gray-300">{watch.gateText}</span>
      <span className={
        watch.badge === 'fired'    ? 'text-red-400 text-xs'
        : watch.badge === 'possible' ? 'text-amber-400 text-xs'
        :                              'text-gray-500 text-xs'}>
        {watch.badge === 'fired' ? '已觸發' : watch.badge === 'possible' ? '可能觸發' : '距門檻尚遠'}
      </span>
      {watch.id === '2' && livePrice != null && quoteMeta?.prevClose != null && (
        <span className="text-[11px] text-gray-500">
          · 盤中 {fNum(livePrice)} {livePrice > quoteMeta.prevClose ? '＞' : '≤'} 昨收 {fNum(quoteMeta.prevClose)}
          → {livePrice > quoteMeta.prevClose ? <b className="text-yellow-300">目前收紅</b> : <b className="text-green-300">目前收黑</b>}
        </span>
      )}
    </>
  ) : (
    <span className="text-gray-500">今日漲停內皆無法觸及</span>
  )}
</div>
```
> 「距門檻尚遠」用中性灰字而非 panel 的「無風險」綠標，避免在被高亮的摘要行裡出現語意衝突（見 §7）。

---

## 3. 可達性過濾＋排序：`pickWatchSummary(results, maxP)`

純函式，置於 `lib/clauseEngine.ts`（與 `evalClauses`/`summarize` 同檔，可單測）。

```ts
const SUMMARY_IDS: ClauseId[] = ['2', '3', '4', '5', '6']   // 款一另行顯示，排除
const BADGE_RANK: Record<ClauseResult['badge'], number> = { fired: 2, possible: 1, safe: 0 }

export function pickWatchSummary(results: ClauseResult[], maxP: number): ClauseResult | null {
  const feasible = results.filter(r =>
    SUMMARY_IDS.includes(r.id) &&
    (r.priceFloor != null ? r.priceFloor <= maxP + 1e-9 : r.badge !== 'safe'))
  if (!feasible.length) return null
  feasible.sort((a, b) => (BADGE_RANK[b.badge] - BADGE_RANK[a.badge]) || a.id.localeCompare(b.id))
  return feasible[0]
}
```

**可達性規則**：
- **價格型款（三/四/五，`priceFloor = t3`）**：`priceFloor ≤ 漲停價 maxP` 才算可達（單日漲停拖得到該收盤價）。
- **量能/比率型款（二、六，`priceFloor = null`）**：以 `badge !== 'safe'` 判定——`safe` 代表當日不可能成立（款二未達長期窗口或已豁免；款六 PE/PBR 未同時異常），自然隱藏。

**排序**：badge 嚴重度（已觸發 > 可能 > 尚遠）降冪，平手以款號小者優先。跨維度（價/量/本益比）的「距離」不可直接比較，故以 badge 嚴重度近似「最容易觸及」（見 §7）。

**博磊推演**：款三/四/五 `t3=309 > maxP=260` → 全數排除；款二近 30 日內已有款一注意且 6 日漲幅 ≤ dupPct → `exempt` → badge `safe` → 排除；款六 `priceFloor=null` 且 PE/PBR 同時異常 → badge `possible` → 唯一 feasible → 顯示「款六 量 ≥ 2,550 張〔可能觸發〕」。✓ 與使用者範例一致。

---

## 4. 引擎改動 `lib/clauseEngine.ts`

### 4.1 `ClauseResult` 擴充（兩個新欄位）
```ts
export interface ClauseResult {
  // …既有欄位不變…
  priceFloor: number | null   // 觸發所需「收盤價」下限；無價格門檻（款二/六）為 null
  gateText: string            // 單行摘要用的「最關鍵剩餘門檻（缺口）」字串
}
```
> 既有 `fired`/`first`/`badge`/`headerThreshold`/`groups`/`exclusions`/`blocked` 完全不動；`summarize` 只讀 `fired`/`first`，介面相容。`AttentionDetailPanel` 不需改（它不讀新欄位）。

### 4.2 helper
```ts
// 由現價漲到 target 的百分比（target > cur 時為正）
const upPct = (target: number, cur: number) => cur > 0 ? (target / cur - 1) * 100 : 0
```

### 4.3 各 evaluator 設定 `priceFloor` / `gateText`
`inp.price` 即現價，引擎可直接算「再漲 X%」缺口。價格型款在 `priceMet`（價已達 t3、badge=possible）時，缺口改顯示其量能/集中度條件；未達時顯示價格缺口。

| 款 | `priceFloor` | `gateText` |
|---|---|---|
| 1① | `t1` | `收盤 ≥ ${t1}`（摘要不顯示，設值求一致） |
| 1② | `t2` | `收盤 ≥ ${t2}（起迄價差 ≥ ${m.gap}元）`（同上） |
| 2 | `null` | `當日需收紅` |
| 3 | `t3` | `priceMet ? (volThresh!=null ? \`量 ≥ ${fmtLot(volThresh)}張\` : '量達標') : \`收盤 ≥ ${t3}（再漲 +${upPct(t3,inp.price).toFixed(1)}%）\`` |
| 4 | `t3` | `priceMet ? (turnoverLot!=null ? \`量 ≥ ${fmtLot(turnoverLot)}張\` : \`週轉率 ≥ ${m.turnover}%\`) : \`收盤 ≥ ${t3}（再漲 +${upPct(t3,inp.price).toFixed(1)}%）\`` |
| 5 | `t3` | `priceMet ? \`券商佔比 > ${m.brokerConc}%\` : \`收盤 ≥ ${t3}（再漲 +${upPct(t3,inp.price).toFixed(1)}%）\`` |
| 6 | `null` | `c6VolLot!=null ? \`量 ≥ ${fmtLot(c6VolLot)}張\` : \`量 ≥ ${m.c6MinLot}張\`` |

> 各 evaluator 內 `t1/t2/t3/volThresh/turnoverLot/c6VolLot/priceMet` 等變數均已存在，僅在 `return` 物件加兩欄。

### 4.4 `pickWatchSummary` 匯出（見 §3）。

---

## 5. UI 改動 `components/DisposalTool.tsx`（`heroCard` IIFE，約 1229–1436）

1. **新增**（區域變數，接在 `c1`/`curPrice` 之後）：`const results = evalCard(0, curPrice)`、`const watch = pickWatchSummary(results, maxP)`、`const pct = curPrice > 0 ? (c1.price / curPrice - 1) * 100 : 0`。需 `import { …, pickWatchSummary } from '@/lib/clauseEngine'`。
2. **改** 款一行（1308–1311）：`toNotice` 分支 → `pct` 分支（§2.2）。
3. **刪** 「為什麼是這條注意線」`<p>`（1314–1323）。
4. **刪** 「卡在哪一條」整塊（1325–1349，含 `rows.map` 與 `clause2.triggered` 款二 row）→ 換成款二~六摘要行（§2.3）。
5. **刪** 常駐「第二款狀態」整塊（1489–1558）：其盤中**收紅指示**已移入摘要行的款二分支；其「防重複豁免/為什麼獨立」明細由 `AttentionDetailPanel` 款二卡的群組呈現（已涵蓋豁免狀態）。
6. **未使用變數清理**（build gate ESLint 會擋，**必須一併刪**）：
   - heroCard 內：`const { p1, p2, gap } = MARKET_PCT[market]`（1241）、`eff1`（1244）、`eff2`（1245）、`cum`（1246）、`spread`（1247）、`toNotice`（1248）、`rowC1a`（1255–1258）、`rowC1b`（1259–1262）、`rows`（1263）。
   - 保留：`gateVals`/`gate`（差幅閘門 details 用，1242–1243、1409+）、`distChips`（1265–1268）。
7. **不需動 import**：`CLAUSE2`（1067 仍用）、`livePrice`（954、摘要行仍用）、`quoteMeta`（1282、摘要行仍用）皆在他處有引用，移除常駐區塊不會產生未使用 import。

---

## 6. 測試與驗證

### 6.1 單元測試（vitest，新增於引擎測試檔）
`pickWatchSummary` 涵蓋案例：
1. **博磊型**：款三/四/五 `priceFloor > maxP`、款二 `safe`、款六 `possible` → 回款六。
2. **多個可能**：款三/四 price 已達（possible）、款六 possible → 排序回 id 最小者（款三）。
3. **全可達但皆 safe**：款三/四/五 `t3 ≤ maxP` 但價未達（safe），款二/六 safe → feasible＝款三/四/五，回款三（badge 平手取款號小）。
4. **全不可達**：款三/四/五 `t3 > maxP`、款二/六 safe → 回 `null`。
5. **款一不入選**：`results` 含 `1①`/`1②` 高 badge 也不被選。

`gateText` 字串分支：價格型款 `priceMet` true/false 兩態（量門檻 vs 價格缺口）、款二固定「當日需收紅」、款六量門檻字串、`fmtLot` 千分位。

### 6.2 回歸與 gate
- 既有 **103 測試**不得回歸（`ClauseResult` 只加欄位、不改判定）。
- `npm run build` 必須綠（`tsc` strict ＋ ESLint 無未使用變數）。
- 「另一種算法對拍」：博磊實際匯入，人工核對摘要行＝「款六 量 ≥ 2,550 張」、款一行＝「只能再漲 +X%」與 `(309/現價−1)×100` 相符。

---

## 7. 風險 / 取捨
1. **safe-but-reachable 款項仍顯示**：價格可達（`t3 ≤ maxP`）但現價未達門檻時，摘要行會顯示該款＋「距門檻尚遠」（灰）。符合使用者「只隱藏漲停內碰不到的」規則；label 用中性灰字避免與 panel「無風險」綠標語意打架。
2. **`clause2.sixDayPct` 明細消失**：常駐區塊移除後，「最近 6 日起迄漲幅 X% 是否 > dupPct」的數字不再顯示；panel 款二卡仍以「防重複豁免」子條件呈現**豁免狀態**（只是不列原始 6 日%）。屬簡化取捨；若使用者要回，後續可把 `sixDayPct` 帶進引擎 `c2` 群組 note（本輪不做）。
3. **`gateText` 隨 `priceMet` 切換顯示量/價**：邏輯仍集中在引擎單一處，UI 純渲染，不違反「單一真相來源」。
4. **「最容易觸及」以 badge 嚴重度近似**：跨維度（價/量/本益比）距離不可直接比較；同 badge 以款號小者優先。若日後要更精準（如同為 possible 時比「缺口百分比」），需各款提供可比的標準化距離，本輪 YAGNI。

---

## 8. 不在本輪範圍（YAGNI）
- 跨維度標準化距離的精算排序（用 badge 嚴重度近似即可）。
- 摘要行展開款二~六逐項細節（`AttentionDetailPanel` 已提供）。
- 摘要行顯示款六盤中即時量進度（panel 款六卡已有「目前 V 張 / 門檻」）。
- 把 `sixDayPct` 原始數字搬進 panel（除非使用者要求）。
