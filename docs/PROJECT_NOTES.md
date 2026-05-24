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
- 法規另要求「漲幅與全體/同類差幅 ≥ 20%」→ **工具無類股資料，僅算價格面**（UI 標註「僅價格面參考」）。
- 款一①② **都屬第一款**，都計入「連 3 日 → 處置」。
- 門檻價公式：`nextTick(bp × 倍數)`；款一② = `max(nextTick(bp×p2), clTick(bp+gap))`（兩條件取較高）。
- `MARKET_PCT`：TWSE `{p1:1.32, p2:1.25, gap:50}`、TPEx `{p1:1.30, p2:1.23, gap:40}`。

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
lib/cache.ts                  記憶體快取（getCached/setCached/deleteCachePrefix）
docs/PROJECT_NOTES.md         （本檔）
```

---

## 五、法規來源
- FL007225（公布注意交易資訊暨處置作業要點）、FL007226（注意標準附表）
- 上市標準：twse-regulation.twse.com.tw；上櫃標準：證券櫃買中心（用戶提供 PDF）
- 上市/上櫃**數字不同**（如上表），務必依市場別套用。
