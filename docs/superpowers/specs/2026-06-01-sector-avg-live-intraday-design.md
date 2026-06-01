# 盤中同類均值即時化（差幅閘門的同類項，計算日當日不再固定 0%）設計文件

**日期**：2026-06-01
**目標**：盤中讓差幅閘門的「**同類均值**」用同類成員的即時價即時變動——計算日當日不再固定以 0% 計，而是以同類成員當日 live 漲跌算出今日貢獻併入 6 日累積。**全體均值維持當日 0%**（成本考量，使用者明確選擇）。收盤後窗口前進、新計算日盤中再從 0% 起算 → 自然成立。
**架構**：歷史層沿用 `/api/sectoravg`（每檔成員 5 完成日累積 `cums` + `sectorMap`，6h 快取）；新增 `live=1` 分支，在歷史層之上加一層「MIS 批量抓同類成員即時價 → 今日 live% → 併入該成員累積 → 等權平均」。live 層每次現抓、不快取。純計算邏輯抽成可單測函式，route 與 UI 近乎只接線。
**技術棧**：Next.js 16.2.6（Turbopack、App Router）、TypeScript strict、React 19、Tailwind 4、vitest 4。`npm run build` 為 CI gate（含 ESLint，未使用變數會擋）。

> ⚠️ Next.js 版本有破壞性改動，動到 framework API 前先讀 `node_modules/next/dist/docs/`。本輪新增一支 route 分支與純 TS 函式、改既有 React 元件，未用到新 framework API。

---

## 1. 背景與範圍

### 1.1 為什麼做
差幅閘門 = `max(全體均值, 同類均值) + 20%`。兩個均值都是「近 6 個營業日累積漲幅」，目前**計算日當日（第 6 間隔）一律以 0% 計**（見 `DisposalTool` 明細「已知 5 間隔，當日以 0% 計」）。因此盤中同類均值不會變動——例：2327 國巨盤中，同類（類28）固定顯示 +5.14%，與前一交易日收盤後相同。

但實際法規以**收盤價**逐日累積；計算日當日真正的同類漲跌，盤中可由同類成員即時價估計。個股（國巨）的「今天」已用即時/模擬價算進它自己的 6 日漲幅，**同類卻仍當 0%**，形成不對稱：若整個類股跟著噴，實際門檻會更高，工具偏保守、比實際更早報注意。本輪消除同類側的這個不對稱。

### 1.2 範圍
- **只做同類均值**的盤中即時化。**全體均值維持當日 0%**（全市場上千檔即時成本過高，使用者明確要求不做）。
- 閘門取兩者較高 + 20%；同類噴漲時它本來就是綁定（較高）的那個 → 只即時化同類即可解決目標情境。
- 盤中（台股交易時段）才算 live；**非盤中／盤前無成交 → 退回當日 0%**（＝現狀）。

### 1.3 設計決策（已與使用者確認）
- **(a)** 採方案 A：擴充現有 `/api/sectoravg` 加 `live=1`，不另開 route（live 需每檔成員的 5 日 `cums`，這支路由已算好且快取，原地加層最省、不必把上百筆 cums 丟前端）。
- **(b)** 同類成員若無即時價（MIS 未回／`z`、`y` 缺）→ **該成員今日當 0%**（保留其歷史累積，**仍留在平均內**，使 live 與歷史的成員數 n 一致）。
- **(c)** 差幅閘門明細的「同類」列顯示**即時當日%**（取代隱含 0%）；全體列仍標 0%。

### 1.4 不動
- 全體均值路徑（`/api/market-avg`、`marketAvg` state）、款一①②/款二~六/款三~六的判定邏輯、`cumulativeMap`/`eqAvg`/trunc2 既有口徑、規則①②③④ 計數、`AttentionDetailPanel`。
- 歷史層快取策略（6h、key 含 window 日期）。

---

## 2. 計算規格

設目標股 `code`（國巨）、其產業別 `sectorCode`、歷史層已得各檔 5 完成日累積 `cums[c]` 與 `sectorMap`。

**同類成員集合**（與歷史同口徑，確保 n 一致）：
```
members = { c : sectorMap[c] === sectorCode 且 c ∈ cums 且 c ≠ code }
```
（`cums` 僅含「全 5 日都有資料」的代號，故停牌缺日者本就不在歷史平均內，live 也一致排除。）

**每成員今日 live%**（與歷史日同口徑，逐日 2 位無條件捨去）：
```
todayPct[m] = trunc2( (z_m − y_m) / y_m × 100 )    若 z_m 有效且 y_m > 0
            = 0                                      否則（無即時 / y 缺）
```
`z_m` = MIS 最新成交價、`y_m` = MIS 昨收（＝最近完成日 5/29 收盤，與窗口一致）。

**成員 live 累積與同類 live 均值**（等權、排除 code）：
```
liveCum[m]      = cums[m] + todayPct[m]
sectorAvgLive   = mean_{m ∈ members} liveCum[m]
sectorTodayAvg  = mean_{m ∈ members} todayPct[m]    （＝明細顯示的「當日 +X% 即時」）
```
（因平均為線性，`sectorTodayAvg = sectorAvgLive − sectorAvgHist`；為避免逐項 `toFixed` 累積誤差，直接回傳。）

**閘門**：`diffPct` 的同類項改吃 `sectorAvgLive`（live 存在時），注意線價 `priceFor` 自然跟著動。

---

## 3. 架構與資料流

### 3.1 純函式（可單測，新檔/既有檔）
- `lib/disposal/quote.ts` 既有 `parseMisQuote(json, code)` 旁，新增 **`parseMisQuoteRows(json): { code, price, prevClose, market }[]`**：解析 MIS `msgArray` **全部列**（非單一代號），共用既有 `num`/`fmtDate`。
- 新檔 **`lib/disposal/sectorLive.ts`**：
  - `liveSectorAvg(cums, sectorMap, sectorCode, exclude, todayPctMap): { avg: number|null; n: number; todayAvg: number|null }`
    純函式：依 §2 組 `members`，**單次迴圈**同時累加 `liveCum[m]=cums[m]+todayPct[m]` 與 `todayPct[m]`，回 `{ avg, n, todayAvg }`（語意＝既有 `eqAvg` 的等權＋產業篩＋排除，外加 todayAvg；各 avg 以 `+(sum/n).toFixed(2)`，n=0 時 avg/todayAvg 皆 null）。
  - `misExChBatch(market, codes): string[]` 把代號每 40 檔一批、各批以 `|` 串成 `ex_ch`。
  - `fetchSectorTodayPct(market, codes, deps?): Promise<Record<string, number>>`
    分批打 MIS getStockInfo → `parseMisQuoteRows` → 算 `trunc2 todayPct`。`deps` 可注入 `fetch` 供測試。任何一批失敗 → 該批成員缺漏（視同今日 0%），不整體拋錯。

### 3.2 Route：`app/api/sectoravg/route.ts` 加 `live=1`
歷史層完全不變（含快取）。取得 `cums`/`sectorMap` 後：
```
if (live==='1' && sectorCode) {
  members   = codes of cums where sectorMap===sectorCode && c!==code
  todayPct  = await fetchSectorTodayPct(market, members)        // 現抓、不快取
  const { avg, n, todayAvg } = liveSectorAvg(cums, sectorMap, sectorCode, code, todayPct)
  → sectorAvgLive = avg；sectorTodayAvg = todayAvg
}
```
回應新增欄位：`sectorAvgLive: number|null`、`sectorTodayAvg: number|null`、`sectorLiveN: number|null`。`live` 未帶或抓不到 → 皆 `null`，行為同今日。

### 3.3 前端：`components/DisposalTool.tsx`
- import 成功且 `inTwMarketHours()` → 對 `/api/sectoravg` 帶 `live=1`；把 `{market, code, winYMDs}` 存入 `sectorReqRef`（ref），供輪詢閉包重建 URL。
- `refreshLive`（每 30 秒 + 立即刷新）盤中時，於抓 `/api/quote` 之外**再打** `/api/sectoravg?…&live=1`，成功則 `setSectorAvg`（合併 live 欄位）。
- 取值：`sAvgPct = sectorAvg.sectorAvgLive ?? sectorAvg.sectorAvg`（live 優先，否則歷史）。其餘（`mAvgEff`、targetCum）不變。
- 非盤中：不帶 live、不輪詢（沿用 `inTwMarketHours()` 既有閘門）。

---

## 4. 邊界與退路
- **MIS 整批/部分失敗**：缺的成員視同今日 0%；全失敗則 `sectorAvgLive=null` → 前端 `??` 退回歷史值。`refreshLive` 既有 catch「保留前值」。
- **盤前無成交**：成員 `z` 為 `-`/null → todayPct 0 → `sectorAvgLive ≈ sectorAvgHist`（合理）。
- **y 缺或 ≤0**：該成員今日 0%。
- **同類只有目標一檔**（n=0）：`sectorAvgLive=null`，閘門退回純全體（同現狀 sector=null 行為）。
- **全體均值**：永遠當日 0%，不受本輪影響。
- **跨市場**：同類成員與目標同市場 → `misExCh(market, …)` 全 `tse_` 或全 `otc_`。

## 5. UI 變更（差幅閘門明細，`DisposalTool` ~1346–1383）
- 標題那句「已知 5 間隔，當日（第 6 間隔）以 0% 計」改為：**全體**仍「當日以 0% 計」；**同類**在 live 有值時改述「同類當日以即時價計」。
- 「同類」列：顯示 `sectorAvgLive` 並旁註「**當日即時 {+X%}**」（X = `sectorTodayAvg`，紅綠依號）。無 live 時維持原樣。
- 全體列不變。

## 6. 測試策略（TDD，先紅後綠）
1. `parseMisQuoteRows`：多檔 `msgArray`（tse/otc 混合、`z`/`y` 含 `-`、缺欄）→ 正確列陣列。
2. `fetchSectorTodayPct`（注入假 fetch）：分批、合併、trunc2、缺值成員省略。
3. `liveSectorAvg`：給定 `cums` + `sectorMap` + `todayPctMap` → **手算黃金值**（含排除目標、無即時成員當 0%、n 與歷史一致、`todayAvg` 正確）。
4. （整合可選）route `live=1` 以注入/假資料對拍一組 `sectorAvgLive`。
全程 `npx vitest run` + `npm run build` 綠燈。

## 7. 受影響檔案
- `lib/disposal/quote.ts`（+`parseMisQuoteRows`）
- `lib/disposal/sectorLive.ts`（新：`liveSectorAvg`/`misExChBatch`/`fetchSectorTodayPct`）
- `app/api/sectoravg/route.ts`（`live=1` 分支 + 新回應欄位）
- `components/DisposalTool.tsx`（`sectorReqRef`、`refreshLive` 接線、`sAvgPct` 取 live、明細文字）
- `lib/disposal/__tests__/`（新增 `sectorLive.test.ts`；`quote` 測試擴充）

## 8. 非目標（YAGNI）
- 全體均值即時化、同類指數近似、歷史回放、live 值持久化、跨日 streak 用 live 值（規則計數仍只用確定收盤注意）。
