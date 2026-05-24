# 專案筆記（PROJECT_NOTES）

> 給未來的 AI / 開發者：這份是「決策與規則的長期記憶」，避免每次重新推導。
> 程式碼才是真相來源，但**法規數字、設計決策、踩雷紀錄**寫在這裡，省得重查重想。

## 專案概觀

台股圖表比較工具（Next.js 16 App Router + TypeScript + Tailwind，dev: `npm run dev` → http://localhost:3000）。
三個模式（`app/page.tsx` 的 `mode`）：
- `overlay`：多檔疊加比較（`SeriesPanel` + `ChartOverlay`）
- `period`：時段比較，起點對齊（`PeriodPanel` + `PeriodChart`）
- `disposal`：**台股注意/處置推演**（`DisposalTool`）← 本輪主要開發

---

## 一、注意/處置推演（DisposalTool.tsx）

互動沙盤：匯入股號 → 自動載入近 6 日收盤、注意/處置紀錄 → 拖滑桿模擬未來股價，判斷會不會被注意/處置。

### 注意門檻（第一款，6 個營業日累積漲幅，依市場別）

| 款項 | 上市 TWSE | 上櫃 TPEx | 說明 |
|------|-----------|-----------|------|
| **款一①**（純價格） | 超過 **32%** | 超過 **30%** | 光靠價格成立 |
| **款一②**（價格+價差） | 超過 **25%** 且起迄價差 ≥ **50 元** | 超過 **23%** 且起迄價差 ≥ **40 元** | 漲幅門檻較低，但需同時達價差 |

- 「起迄價差」= 計算日收盤 − 基準日收盤（6 天首尾差，**非單日**）。
- 款一①② **都屬第一款**，都計入「連 3 日 → 處置」。
- `MARKET_PCT`：TWSE `{p1:1.32, p2:1.25, gap:50}`、TPEx `{p1:1.30, p2:1.23, gap:40}`。

#### 差幅 ≥ 20% 條件（已部分實作，2026/05）
法規款一①② **逐字**：漲幅與**全體 _及_ 同類**差幅**_均_ ≥ 20%**（AND）。
- **全體差幅已納入**：用 `/api/market-avg` 取全體累積漲幅 `mAvgPct`，門檻改為 `max(價格門檻, mAvgPct+20%)`。
  - `thresh(bp, mkt, mAvgPct)` / `nLvl(..., mAvgPct)`：`diffMul = 1+(mAvgPct+20)/100`；`t1=nextTick(bp×max(p1,diffMul))`、`t2=max(nextTick(bp×max(p2,diffMul)), clTick(bp+gap))`。
  - 市場平靜時門檻 = 價格門檻（不變）；大盤一熱，差幅門檻 > 價格門檻 → 注意門檻自動升。
  - `mAvgPct=null`（未載入/取不到）→ 退回純價格門檻。貫穿卡片/表格/滑桿判色/處置模擬（`computeTriggers`）。
- **上市/上櫃分開**：上市股比上市全體、上櫃股比上櫃全體。`mAvgPct = marketAvg[market]`，三者綁同一 `market`。
- **當日（第 6 間隔）全體漲幅以 0% 計**（無法預測 → 假設）；故 `mAvgPct` = 「已知 5 間隔」值即等於「6 日窗口當日=0」的結果。
- **同類差幅仍無產業資料、未驗證** → 結果為估計（UI 已標註）。**未來若接產業分類可補上同類那半條**。

### 第三款（價量同時異常）— 已實作（2026/05）
- 條件：6 日累積漲幅 > **25%（上市）/ 27%（上櫃）** + 全體差幅 ≥ 20% + 當日量 ≥ **5×最近 60 日均量**。
- `MARKET_PCT` 加 `p3`（TWSE 1.25、TPEx 1.27）；`thresh` 多回傳 `t3 = nextTick(bp×max(p3,diffMul))`。
- `nLvl(..., volumeMet)` 新增 **level 3**；優先序 款一①(1) > 款一②(2) > 款三(3)。
- 量資料：`stocks` API 的 `fetchYahoo` 已解析 `volume`；匯入時算 `avg60Vol`（最近 60 日均量，當日為變數）。
- **處置串接**：`computeTriggers` 的 notices 改 `(0|1|2|3)`；level 3 **計入規則②③④（連5/10日6/30日12）**，**不計規則①（連3日第一款）**。模擬日第一款 = level 1或2。
- **UI**：款三等「需當日量/籌碼」的款，因當日量為變數、只對下一交易日有意義 → 放在沙盤**下方整列寬面板**（非卡片內），含「☐ 假設當日量達標」開關（勾選才把 level 3 餵進處置模擬）。卡片本身只放純價格款。
- **未做的款三量條件**：「放大倍數與全體差 ≥ 4 倍」（需全市場量能）、週轉率/本益比除外 → 資料不足，略過。

### 八款注意條件 — 原子拆解與可算性（設計參考）
法規第四條第一項共 8 款（FL007225/FL007226；上櫃為櫃買對應要點）。差幅一律「全體 **AND** 同類 均 ≥20%」。
- **可算（已/可做）**：款一①②（價格+全體差幅+價差）、款二（30/60/90日倍漲，差幅未做）、款三（價+5×量）。
- **⚠️ 需額外接 API**：款四 週轉率（流通股數）、款六 本益比/股淨比（TWSE BWIBBU 日資料 + 全體加權平均）、款七 券資比（融資券日資料）、同類產業均值、實收資本額、除權息還原。
- **❌ 拿不到**：款五 券商受託占比、款六單一投資人占比、款八 TDR 溢折價。
- **設計方向**：把判定重構成「**原子條件亮燈 → 組合判款**」（純函式引擎），live 沙盤與未來回測共用同一引擎。價格類原子每張卡都算；當日量/籌碼類只對第一張卡（下一交易日）有意義。

### 第二款（起迄兩營業日，長窗口倍漲）— `CLAUSE2`

| 窗口 | 上市 | 上櫃 |
|------|------|------|
| 30 日 | > 100% | > 100% |
| 60 日 | > 130% | > **140%** |
| 90 日 | > 160% | > 160% |

- 用實際匯入的歷史股價算 30/60/90 日起迄漲幅（差幅條件無資料，僅價格面）。
- **防重複豁免（唯一實作的豁免）**：最近 30 日內已有第一款注意 **且** 最近 6 日累積漲幅 ≤ **25%（上市）/ 27%（上櫃）** → 第二款不適用。
- 表格「款二不豁免≥」= `nextTick(bp × (1+dupPct%))`，達此價代表 6 日漲幅破 25/27%，豁免失效。
- 其他豁免（類股均值、溢折價、IPO、除權息…）**未實作**（資料不足）。

### 處置規則（FL007225）

- 規則①：連 **3** 日第一款 → 處置
- 規則②：連 **5** 日（第一款~第八款）→ 處置
- 規則③：最近 **10** 日內 **6** 日 → 處置
- 規則④：最近 **30** 日內 **12** 日 → 處置（門檻永遠 12，不因第幾次處置而降）
- 被處置後，計數從**處置生效日重新起算**（`baseReset`，工具自動帶入最近一次處置日）。

### 台股 tick（最小升降單位，`tickOf`）

`<10:0.01｜10~50:0.05｜50~100:0.1｜100~500:0.5｜500~1000:1｜≥1000:5`
- `flTick/clTick/snapTick/nextTick` 都依價位 tick。
- 漲停 = 前收 ×1.1 無條件捨去到 tick（`lup`）；跌停 = ×0.9 無條件進位（`ldn`）。
- 「超過 X%」採嚴格大於 → `nextTick(p)` = 剛好超過 p 的第一個合法 tick 價。

### 重要設計決策

- **規則卡 = 只算「已確定注意」**（真實紀錄，不含沙盤模擬）；模擬結果只反映在下方「此路徑安全/觸發處置」結果列（`computeTriggers`）。
- **窗口結尾 = 下一個交易日（預測目標）** = `nextTD(lastTD(today))`；週末會跳過。例：今天週六 5/23 → 預測日 5/25，規則①窗口 = 5/21~5/25。
- 歷史注意 level：API 將「含第一款字樣」標 level 1、其餘標 level 2（=款二~八）。**規則①只算 level 1**（模擬日的 level 2=款一②則算第一款）。
- 配色：🔴 紅 = 款一①②（第一款，連3日處置）；🟡 黃 = 款二；🟢 綠 = 安全。
- 滑桿輸入框：打字時自由輸入（`editStr` 暫存原始字串），**離開欄位(blur)才** snap+clamp。
- 市場別由股價 API 回傳 `market`（`.TWO`→TPEx、`.TW`→TWSE）。
- 規則說明彈窗（📖）+ 全市場處置清單彈窗（🚨 查詢清單）。

---

## 二、API 端點（app/api/）— ⚠️ 正確的官方 URL（踩過雷）

| 端點 | 用途 | 關鍵 |
|------|------|------|
| `stocks/route.ts` | Yahoo Finance 股價 | **時間戳要 +8h**（台股 UTC+8，否則日期少一天）；Yahoo 對 .TWO 有延遲 → 補抓 TWSE/TPEx 當月資料；回傳 `market`；`bust=1` 清快取 |
| `notices/route.ts` | 注意紀錄 | TWSE `rwd/zh/announcement/notice`；TPEx `www/zh-tw/bulletin/attention`（直接回 JSON `tables[0].data`） |
| `disposal/route.ts` | 單股處置 | **TWSE 是 `announcement/punish`**（不是 disposal！）；**TPEx 是 `bulletin/disposal`**（不是 disposition！） |
| `disposal-list/route.ts` | 全市場處置清單 | 同上兩個 URL，不帶 code |
| `market-avg/route.ts` | 全體有價證券「已知 5 間隔累積漲幅%」簡單平均（款一差幅基底） | 見下方專段 |

### `market-avg` — 全體累積漲幅（差幅 ≥ 20% 用）
- **資料源（皆可帶日期回補歷史）**：
  - 上市：`twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999` → 表 title 含「每日收盤行情」，`row[0]`=代號、`row[8]`=收盤、`row[9]`=漲跌(+/-)(`green`=跌)、`row[10]`=漲跌價差(幅度)。
  - 上櫃：`tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=YYYY/MM/DD&type=EW&response=json` → `tables[0]`，`row[0]`=代號、`row[2]`=收盤、`row[3]`=漲跌(含正負號)。
  - 只取普通股 `/^[1-9]\d{3}$/`（排除 00xx ETF、6 位數 ETN、特別股 2887B）。
- **演算法**：抓最近 **6** 個已收盤交易日（含基準日；非交易日資料源回空 → 跳過避假日）→ 存每檔「當日漲跌幅%」→ **逐檔連乘 5 個間隔 `∏(1+漲跌幅)−1`**（= `close(最近)/close(基準)−1`，與法規價格比值一致）→ 對「整段都有交易」的股票取**簡單算術平均**（非市值加權；官方無此指數，需自算）。
- **⚠️ 相加 ≠ 連乘**：每日漲跌幅**相加**少算複利交叉項；大漲股 6 天差可達 1~3%，**務必連乘**。已用真實資料對拍「收盤比值」驗證（差 ~0.016pp，純納入檔數差+tick 四捨五入）。
- **儲存** `lib/marketStore.ts`：每日每市場 `{code:漲跌幅%}` 快照。本機寫 `.marketdata/`（gitignore），雲端唯讀 FS 自動退回純記憶體。`pruneExcept()` 只留當前窗口的交易日（規矩：滾動保留，週一更新即丟最舊）。
- 回傳 `{ knownIntervals:5, baseDate, lastClosedDate, days, twse:{avg,count}, tpex:{avg,count} }`；結果快取 6h（key=lastClosedDate），`bust=1` 清。

### 處置 API 欄位對應（重要）
- **TWSE punish**：`row[2]`=代號、`row[3]`=名稱、`row[6]`=處置起迄時間（斜線格式 `115/05/08～115/05/21`）
- **TPEx disposal**：`row[1]`=公布日期、`row[2]`=代號、`row[3]`=名稱(含HTML連結，要 strip `\(.*?\)`)、`row[5]`=處置起迄時間
- 日期是 ROC 格式，可能是「起~迄」範圍（全形/半形波浪號都要處理）。

### 注意 API 日期 = 計算日；處置起迄時間第一個日期 = 處置生效日（起算點）

---

## 三、時段比較（PeriodPanel.tsx）

- 移除舊固定 presets，改兩類：
  1. **📅 年份**（可展開收合）：今年=年初至今、往年=整年。
  2. **🕘 歷史紀錄**：用 **localStorage** 持久化（key `period_history_v1`），上限 **15** 筆 FIFO，去重（ticker+from+to），點擊套用、✕ 刪除。
- localStorage = 同網域+同裝置+同瀏覽器設定檔才共用；不同人/裝置看不到彼此（無後端帳號）。

### 已加入時段卡片：複製 ⧉ + 行內編輯 ✎
- 每張卡片右上角四鈕：**✎ 編輯｜⧉ 複製｜👁 顯示｜× 刪除**。
- **✎ 編輯**：卡片就地展開成輸入欄，**預填現有 標的/名稱/起迄日期（絕不清空）** → 可只改時間不動標的。Enter 完成、Esc 取消。
- **⧉ 複製**：複製同標的/名稱/時間的新卡，**立刻進入編輯模式**、autoFocus 在代碼欄（工作流：複製→改時間或標的→完成）。
- 改 ticker/from/to 才會重新 fetch；存檔同樣寫入歷史紀錄。
- 父層機制：`page.tsx` 的 `handleUpdateSegment(id, patch)`（`'ticker'|'from'|'to' in patch` 才 refetch），透過 `onUpdate` prop 傳入；複製沿用既有 `onAdd`（自帶 fetch）。

---

## 四、檔案地圖

```
app/page.tsx                  三模式切換（overlay/period/disposal）
components/
  DisposalTool.tsx            注意/處置推演（核心，~1100 行）
  PeriodPanel.tsx             時段比較側欄（年份+歷史）
  SeriesPanel/ChartOverlay/PeriodPanel/PeriodChart   疊加與時段圖
app/api/
  stocks/                     Yahoo + TWSE/TPEx 補抓股價，回 market
  notices/                    注意紀錄
  disposal/                   單股處置（punish/disposal）
  disposal-list/              全市場處置清單
  market-avg/                 全體累積漲幅平均（款一差幅 ≥ 20% 基底）
lib/cache.ts                  記憶體快取（getCached/setCached/deleteCachePrefix）
lib/marketStore.ts            全市場每日漲跌幅快照（磁碟+記憶體 fallback，留 6 交易日）
docs/PROJECT_NOTES.md         （本檔）
```

---

## 五、法規來源
- FL007225（公布注意交易資訊暨處置作業要點）、FL007226（注意標準附表）
- 上市標準：twse-regulation.twse.com.tw；上櫃標準：證券櫃買中心（用戶提供 PDF）
- 上市/上櫃**數字不同**（如上表），務必依市場別套用。
