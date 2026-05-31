# 專案筆記（PROJECT_NOTES）

> 給未來的 AI / 開發者：這份是「決策與規則的長期記憶」，避免每次重新推導。
> 程式碼才是真相來源，但**法規數字、設計決策、踩雷紀錄**寫在這裡，省得重查重想。

## 專案概觀

台股圖表比較工具（Next.js 16 App Router + TypeScript + Tailwind，dev: `npm run dev` → http://localhost:3000）。
五個模式（`app/page.tsx` 的 `mode`）：
- `overlay`：多檔疊加比較（`SeriesPanel` + `ChartOverlay`）
- `period`：時段比較，起點對齊（`PeriodPanel` + `PeriodChart`）
- `disposal`：**台股注意/處置推演**（`DisposalTool`）
- `chips`：**集保大戶 / 內部大戶籌碼**（`ChipsView` 個股趨勢 + `ChipsScreener` 篩選排行）← 見第六節
- `fund`：**主動式 ETF 持股**（`FundView`，UI 標籤已改成「主動式ETF」）← 見第七節

---

## 一、注意/處置推演（DisposalTool.tsx）

互動沙盤：匯入股號 → 自動載入近 6 日收盤、注意/處置紀錄 → 拖滑桿模擬未來股價，判斷會不會被注意/處置。

### 注意門檻（第一款，6 個營業日累積漲幅，依市場別）

| 款項 | 上市 TWSE | 上櫃 TPEx | 說明 |
|------|-----------|-----------|------|
| **款一①**（純價格） | 超過 **32%** | 超過 **30%** | 光靠價格成立 |
| **款一②**（價格+價差） | 超過 **25%** 且起迄價差 ≥ **50 元** | 超過 **23%** 且起迄價差 ≥ **40 元** | 漲幅門檻較低，但需同時達價差 |

- 「起迄價差」= 計算日收盤 − **6 日窗口第一天收盤**（`closePath[1]`，即基準日後第一個交易日；**非 `closePath[0]` 基準日本身**）。
- 個股**已知累積漲幅 = 逐日漲跌%「2 位無條件捨去（向零）」相加**（非連乘）：`knownSum = Σ trunc2((close[i]/close[i-1]−1)×100)`。
- 門檻價 = `最近收盤 × (1 + (max(價格門檻%, 全體均值+20) − knownSum) / 100)` 取 `nextTick`（嚴格超過）；款一② 同時取 `max(nextTick(...), clTick(spreadBase+gap))`。
- 款一①② **都屬第一款**，都計入「連 3 日 → 處置」。
- `MARKET_PCT`（百分比）：TWSE `{p1:32, p2:25, p3:25, gap:50}`、TPEx `{p1:30, p2:23, p3:27, gap:40}`。

#### 差幅 ≥ 20% 條件（2026/05 全體 + 同類均已完成）
法規款一①② **逐字**：漲幅與**全體 _及_ 同類**差幅**_均_ ≥ 20%**（AND）。
- **全體差幅已納入**：用 `/api/market-avg` 取全體累積漲幅 `mAvgPct`，門檻改為 `max(價格門檻, mAvgPct+20%)`。
  - `thresh(bp, prevClose, sumKnown, spreadBase, mkt, mAvgPct)`：`diffPct = mAvgPct+20`；`t1=nextTick(prevClose×(1+(max(p1,diffPct)−sumKnown)/100))`、`t2=max(nextTick(prevClose×(1+(max(p2,diffPct)−sumKnown)/100)), clTick(spreadBase+gap))`（`bp` 僅為呼叫對稱保留，價差改用 `spreadBase`）。
  - 市場平靜時門檻 = 價格門檻（不變）；大盤一熱，差幅門檻 > 價格門檻 → 注意門檻自動升。
  - `mAvgPct=null`（未載入/取不到）→ 退回純價格門檻。貫穿卡片/表格/滑桿判色/處置模擬（`computeTriggers`）。
- **上市/上櫃分開**：上市股比上市全體、上櫃股比上櫃全體。`mAvgPct = marketAvg[market]`，三者綁同一 `market`。
- **當日（第 6 間隔）全體漲幅以 0% 計**（無法預測 → 假設）；故 `mAvgPct` = 「已知 5 間隔」值即等於「6 日窗口當日=0」的結果。
- **款一①②、款三差幅閘 = max(全體均值, 同類均值) + 20（2026/05/29 完成）**：全體/同類均值皆「自算個股等權累積漲幅、排除標的本身」；上市/上櫃同口徑（上櫃已從櫃買指數加權改為個股等權）。
  - 新端點 `GET /api/sectoravg?market&code&win`：回 `{ targetCum, marketAvg, sectorAvg, sectorCode }`，均值皆排除標的本身。
  - 共用資料層 `lib/disposal/marketData.ts`（`fetchTwseDailyPct` / `fetchTpexDailyPct` / `fetchSectorMap` / `cumulativeMap` / `eqAvg`）。
  - 對拍 attstock 黃金值（窗口 5/22~28）：國巨 2327 累積 = 27.36；同類（產業別 28、排除國巨）= 6.15；全體（排除國巨）= 2.22，已固化為 `lib/disposal/__tests__/golden.test.ts` 回歸測試。

### 第三款（價量同時異常）— 已實作於原子引擎
- 條件：6 日累積漲幅 > **25%（上市）/ 27%（上櫃）** + 全體差幅 ≥ 20% + 當日量 ≥ **5×最近 60 日均量**。
- 引擎位置：`lib/clauseEngine.ts` 的 `c3()` evaluator（`PCT` 用百分比 `p3:25/27`）；`first:false`，`any` 計規則②③④、不計①。
- 量資料：`stocks` API 的 `fetchYahoo` 已解析 `volume`；匯入時算 `avg60Vol`（最近 60 日均量，當日為變數）。
- **UI**：款三等「需當日量/籌碼」的款，因當日量為變數、只對下一交易日有意義 → 放在沙盤**下方整列寬面板**（非卡片內），含「☐ 假設當日量達標」開關（勾選才把 `volMet` 傳進 `evalCard` 餵處置模擬）。卡片本身只放純價格款（款一、款十一）。
- **未做的款三量條件**：「放大倍數與全體差 ≥ 4 倍」（需全市場量能）、週轉率/本益比除外 → 資料不足，略過。

### 款一~十二 實作現況（2026/05 全補齊）— `lib/clauseEngine.ts`

> ⚠️ **本節已過時，以上方「注意細節條件面板（2026-05-30）」為準**：引擎已收斂為**款一~六**（移除款十一價差級距 / 款十二借券）；款四(週轉率)改以**發行股數**反推硬量門檻、款五(券商集中)以假設開關落地。下方「資料不足、不判定 → 款四/五」及「款十一/十二」描述均已不適用，保留僅供脈絡。

判定改用**原子引擎** `lib/clauseEngine.ts`：每款為純函式 evaluator → `summarize`→`{first,any}`→`computeTriggers`，live 沙盤與回測共用同一引擎。

**已實作款（可判定）**
- **款一①②**（第一款，計連3日）：純價格漲幅 / 價格+起迄價差，6日窗口，trunc2 精度修正後累加。
- **款二**（純價格 first→當日比值，計連5/10/30）：30/60/90日起迄漲幅門檻，含防重複豁免。
- **款三**（價+當日量，假設開關）：漲幅 > p3 + 5×60日均量，量條件以 UI 開關代入，level 3 計規則②③④不計規則①。
- **款六**（PE/PBR，雙市場 `/api/peratio`，中位數均值）：個股 PE/PBR 對比市場中位數，需當日週轉/券商假設，資料有限標假設。
- **款十一**（起迄價差=當日−窗口第一天 ≥ gap；gap：上櫃=70+floor(P/300)×15、上市=100+floor(P/500)×25）。
- **款十二**（借券，雙市場 `/api/sbl`，6日率>9%上櫃/12%上市 + 放大≥4/5×，假設開關）。

**trunc2 精度修正**：`Math.round(x*1e8)/1e8` 後截斷（整除日如47.3/43→10.00，避免浮點誤差截錯位）。

**新端點**
- `/api/peratio`：上櫃 `tpex_mainboard_peratio_analysis`（回最新快照）、上市 `BWIBBU_d`（日資料）。
- `/api/sbl`：上櫃 `margin/sbl`（借券當日賣出 col9）、上市 `TWT93U`（col9 + 成交量）。

**資料不足、不判定**
- 款四（週轉率，需流通股數）、款五（券商分點）：無公開批量 API → UI 標「資料不足」，不判定。

**處置計數對應**：第一款計規則①（連3日）；款一~十二任一計規則②③④（連5日6次/10日6次/30日12次）。

### 各款可算性現況（差幅一律「全體 AND 同類 均 ≥20%」；全體/同類均值皆自算等權、排除標的；上市/上櫃同口徑）
- **✅ 已實作（`lib/clauseEngine.ts`）**：款一①②、款二（純價格、含豁免）、款三（價+量+假設）、款六（PE/PBR+假設）、款十一（起迄價差）、款十二（借券+假設）。
- **❌ 資料卡死、UI 標「資料不足」**：
  - 款四 週轉率：分母需「流通在外股數」，`發行股數` 算出差 ~3 倍；無免費批量 API（TDCC/MOPS 僅個別查詢）。
  - 款五 單一券商買賣占比：券商分點全量無公開 API（僅熱門前 30 排行）。
  - 款七 券資比、款八 TDR 溢折價、款六單一投資人占比、同類產業均值：資料不足或未接。
- 原子引擎模式已成型：純函式 evaluator → `summarize` → `{first,any}` → `computeTriggers`，live 沙盤與未來回測共用同一引擎。價格類每張卡都算；當日量/籌碼類只對卡 0（下一交易日）有意義、用假設開關。

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
- **窗口結尾 = 下一個交易日（預測目標）** = `nextTD(todayTD)`；週末跳過。**盤中（台股 <14:00 收盤定案前）`todayTD` 排除今天**（今天那場未完成）→ 例：5/26 盤中 → todayTD=5/25、預測日=5/26（即預測今天收盤）；14:00 後才納入今天、推進到 5/27。
- **規則①②連續 streak**：`getRules` 從 ref(預測日，本身無確定注意) 的**前一完成交易日**起算，否則會被空的預測日打斷成 0（例：5/25 有第一款、5/26 未收盤 → 規則①應為 1/3，非 0）。連續規則中間任一**已完成**交易日無注意才歸零。
- 歷史注意 level：API 將「含第一款字樣」標 level 1、其餘標 level 2（=款二~八）。**規則①只算 level 1**（模擬日的 level 2=款一②則算第一款）。
- 卡片配色：🔴 紅 = 款一①②（第一款）；🟠 橘 = 任一其他注意款 fired（款二/三/六/十一/十二，計連5/10/30）；🟢 綠 = 無注意。處置觸發那張卡 → 紅底加重 + ⚠️觸發。
- 滑桿輸入框：打字時自由輸入（`editStr` 暫存原始字串），**離開欄位(blur)才** snap+clamp。
- 市場別由股價 API 回傳 `market`（`.TWO`→TPEx、`.TW`→TWSE）。
- **盤中不採計今日未定案價**（`dropUnclosedToday`）：台灣時間 **< 14:00 且最新 bar = 今天** → 丟掉那根（Yahoo 盤中給即時價非收盤），只用到上一個完成交易日；≥14:00 收盤定案後才納入。僅注意/處置匯入需要（它把價當收盤判定）；籌碼/大戶用 TDCC 官方收盤資料、不受影響。
- 規則說明彈窗（📖）+ 全市場處置清單彈窗（🚨 查詢清單）。

---

## 注意細節條件面板（2026-05-30）
- 引擎 `lib/clauseEngine.ts` 收斂為款一~六：移除款十一(價差級距)/款十二(借券)，新增款四(週轉率硬量門檻)/款五(券商集中)。
- 款三量門檻 = 5×近60日均量(張)；款四 = 門檻%×發行張數（上市10%/上櫃5%）；款六項三 = max(5%×發行張數, 3000/2000張)。**當日週轉率 = 成交量 ÷ 發行股數** → 第二條件反推成硬量門檻，盤中即時比對。
- 款六改 OR→AND（項一∧項二∧項三∧項四假設），貼法規「同時達」。
- 殘差(全市場量/週轉率均值比較)以「次要條件假設成立」開關帶過：c3/c4 預設開（絕對門檻必綁定）、c5/c6 預設關（整段非公開）。
- 發行股數：上市 MI_QFIIS `row[3]`、上櫃 tpex_3insti_qfii `NumberOfSharesIssued`（`fetchIssuedShares`，24h 快取，經 `/api/shares`）。國巨 2327=2,071,465,484 股 → 款四門檻 207,147 張（對拍 attstock）。
- UI：`components/disposal/AttentionDetailPanel.tsx` 6 張可收合卡片，錨定計算日，盤中帶 Yahoo 即時價＋累積量。引擎為唯一真相來源，面板近乎純渲染。
- 單位：引擎一律「張」，UI 在 evalCard 呼叫點 股→張(÷1000)。
- ⚠️ **假設開關可見性（2026-05-30 審查修正）**：`AttentionDetailPanel` 的開關顯示只看 `card.assumeKey`（c3~c6 卡恆顯示），**不可**綁 group 的 `assumed` 狀態——該狀態本身由開關決定，綁了會造成「關掉就消失、再也開不回來」的單向陷阱（c5/c6 預設關 → 開關永遠不顯示 → 款五/款六無法觸發）。
- 發行股數查無（盤前/非交易日 MI_QFIIS 空、上櫃端點偶發）→ `sharesOutstanding=null` → 款四/六量門檻退顯「週轉率 ≥%」、發行張數「—」，badge 轉 safe/possible，屬**正常降級**（非「無風險」，卡片以「—」示意）。
- ⚠️ **PE 排除同類差幅閘（2026-05-30 修正）**：法規「PE 為負或 ≥門檻倍(上市60/上櫃65)不適用類股規定」→ 差幅閘門須**剔除同類均值**，僅 `全體+20%`，不可再 `max(全體,同類)+20%`。原本只在「除外條件」打勾顯示卻照用同類＝自相矛盾的 bug。引擎匯出 `sectorAppliesForPe(market,pe)` / `SECTOR_PE_LIMIT` 為單一真相，`effSector()` 依 PE 回 null；`DisposalTool` 的 `thresh()`＋兩處 📊差幅閘門顯示用 `peExcludesSector`/`sAvgGate` 同步剔除並標示原因。**差幅閘門邏輯有兩份（引擎 effCum／UI thresh），改動兩邊都要顧**。
- 已 commit 上線（master `2ec64be`，PE 修正後另計）；`npm test` 97/97、`npm run build` 綠。

---

## 盤中即時報價 + 款二當日收紅（2026-05-30）

**MIS 即時報價接線**（盤中隨時更新狀態，不必等收盤）：
- 解析器 `lib/disposal/quote.ts`（純函式 `parseMisQuote`/`misExCh`，6 個單元測試 `lib/disposal/__tests__/quote.test.ts`）；代理 `app/api/quote/route.ts`：**MIS 近即時 → Yahoo 延遲**退路，確保不低於既有行為。
- MIS 端點 `mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_X.tw|otc_X.tw&json=1&delay=0`：一次同查上市(`tse_`)+上櫃(`otc_`)，由回應 `ex` 欄位判市場（比呼叫端 hint 可靠，6488 不帶 market 參數也解析為 TPEx）。需 `User-Agent` + `Referer: mis.twse.com.tw/stock/fibest.jsp`；server-to-server 可，瀏覽器直連被 CORS 擋 → 必經 proxy。欄位：`z` 最新價（可為 `-` 無成交 → 退 Yahoo）、`o` 開盤、`y` 昨收（≈開盤參考價）、`h/l` 高低、`u/w` 漲跌停、`v` 量（**張**，×1000=股）、`d/t` 日期時間。Next 16 Route Handler 預設不快取、讀 `req.url` 即動態；上游 `fetch` 加 `cache:'no-store'` + `AbortSignal.timeout`。**Vercel US IP 可能被 MIS 限流 → 靠 Yahoo 退路兜底**。端點細節已回寫 `~/.claude/refs/taiwan-finance-data.md`。
- DisposalTool 接線：`refreshLive(manual?)`（用 latest-callback ref + render 鏡像 ref 避免 setInterval stale closure）；**台股交易時段（平日 09:00–13:35，`inTwMarketHours()`）每 30 秒自動輪詢** + 🔄 立即刷新鈕；匯入後即抓一次（`importedCode` effect）。狀態列顯示「盤中即時 · hh:mm:ss 更新／延遲報價」+ 來源。即時價只餵 `livePrice`/`dayVolume`/`quoteMeta`，**不改 clauseEngine**（引擎仍以歷史收盤判定）。

**款二「當日收紅」收斂（重要法規理解）**：
- 款二同窗倍漲門檻（30日>100% / 60日>130%(上櫃140%) / 90日>160%）達標只是**必要條件**；法規另要求「當日收盤價 > 當日開盤參考價」。
- **開盤參考價 ≈ 開盤競價基準 ≈ 前一營業日收盤**（= MIS `y`，盤前即已知）→ 款二的當日過濾條件 = **當日收紅（收盤 > 前收）**。
- 故盤中拿到即時價即可判：`isRed = livePrice > prevClose(=MIS y)`。第二款面板新增可見註記：紅 →「方向符合（款二可能觸發）」、黑 →「若收盤維持則款二今日不觸發」、無即時價 → 提示未取得。**純 UI 判定，不動 `checkClause2`**（引擎仍只看價格倍漲面，款二維持「可能觸發」標籤 + 收紅補註）。

**heroCard 注意線寫法（款一擇低）**：
- 「注意線」= 款一①（漲幅達門檻%）與 款一②（漲幅達門檻% 且起迄價差 ≥ gap 元）**兩者門檻價較低者**（動態，隨 t1/t2/全體均值差幅閘變動）→ 先被列注意的那條。
- 款二是**另一條獨立的線**：長期 30/60/90 日倍漲，**與今日這 6 日窗口的價格無關**（卡片明文解釋「為什麼與今日價無關」）。一律用「注意」非「處置」字樣（被列注意 ≠ 直接處置）。

（以上四項已 commit 上線 master `4ff2627`；當時 `npm test` 103/103、`npm run build` 綠、`/api/quote` 已 smoke test：2330→TWSE、6488→TPEx、壞代號→400。後續測試已增至 113/113。）

---

## heroCard 注意線精簡（2026-05-31）

- **款一獨立一行**：保留注意線價＋款一①/②綁定標準，「離現價 +X 元」改為「只能再漲 +X%」（基準＝現價，`pct = (c1.price/curPrice − 1)×100`，>1e-9 才顯示，否則「已突破注意線」）。注意線 > 漲停仍保留「（漲停 X 外，單日拖不到）」註記。
- **款二~六縮成單行摘要**：引擎 `pickWatchSummary(results, maxP)` 過濾＋排序——價格型款(款三/四/五，`priceFloor=t3`)需 `t3 ≤ 漲停 maxP` 才算可達；量能/比率型(款二/六，`priceFloor=null`)需 `badge≠safe`。取 badge 最嚴重者（fired>possible>safe）、平手取款號小者；全不可達顯示「今日漲停內皆無法觸及」。最接近者是款二時標「當日需收紅」並帶盤中收紅/收黑。
- `ClauseResult` 新增 `priceFloor: number|null`、`gateText: string`（引擎＝唯一真相來源，UI 純渲染；過濾/排序皆在引擎）。
- **移除**：heroCard「為什麼是這條注意線」段、「卡在哪一條」表、常駐「第二款狀態」整塊（收紅併入摘要行；豁免狀態由 `AttentionDetailPanel` 款二卡呈現）。保留：處置距離 chips、差幅閘門明細 details、6 卡注意明細面板。
- **對拍博磊(3581)**（dev server 實測）：注意線 **312.5**（款一②）→「只能再漲 **+32.1%**」（最近收盤 236.5）；款二~六僅顯示「**款六 量 ≥ 2,550張 可能觸發**」——款三/四/五 因 t3≈312.5 > 漲停 260 隱藏。三段舊區塊皆消失、chips/差幅 details/六卡面板皆在。

---

## 徽章可達性修正 + 四位數價格版面（2026-05-31）

- **注意細節面板表頭徽章改用「可達性」判定**（`components/disposal/AttentionDetailPanel.tsx` `effBadge`）：價格型款（`priceFloor != null`）的表頭燈號改看「門檻價是否 ≤ 計算日漲停價 `maxP`」——可達 →「可能觸發」(橘)、連漲停都摸不到 →「無風險」(綠)；量能/比率型款（款二/六，`priceFloor=null`）才沿用引擎 `badge`。與 heroCard `pickWatchSummary` 同一套可達性邏輯（呼叫點新增 `maxP={getDayBounds(0, simPrices, days).maxP}`）。
  - **修的 bug**：`c1()` 引擎 `badge` 只有 `fired`/`safe`（無 `possible`），價格未達就直接 `safe` → 表頭亮綠「無風險」，但展開的細項列（`priceGroup` status = `met ? 'met' : 'possible'`）卻顯示「可能」→ 表頭與內容自相矛盾（user 回報「都講可能了 上面不要顯示無風險」）。
  - ⚠️ **已知殘留（未處理）**：表頭已可達性化，但**展開後的逐項細條件仍直接吃引擎原始 status**。故若某款門檻價「連漲停都到不了」，表頭正確顯示「無風險」、那一列細項卻可能仍寫「可能」（反向不一致）。要徹底一致需把 `maxP` 也傳進引擎 `priceGroup` 做可達性（會動引擎＋測試，暫緩）。當前 user 案例（國巨款一②門檻 800 ≤ 漲停 ≈812）為可達，不受影響。
- **六日預測卡四位數價格被遮擋修正**（`components/DisposalTool.tsx`）：價格輸入框獨立成整行（`flex-1 min-w-0`），日漲跌幅移到下方「累積 +X%」那一行右側（`justify-between`），解決四位數股價（≥1000）被日漲跌標籤蓋住（user 回報「四位數字 數字被擋住了」）。
- 順手移除 `Clause2Result` 未使用的 `sixDayPct` 回傳欄位（仍保留區域變數供 `exempt` 計算）。
- 已 commit + push（master `469d696`）；`npm run build` 綠、`npx vitest run` 113/113。

---

## 二、API 端點（app/api/）— ⚠️ 正確的官方 URL（踩過雷）

| 端點 | 用途 | 關鍵 |
|------|------|------|
| `stocks/route.ts` | Yahoo Finance 股價 | **時間戳要 +8h**（台股 UTC+8，否則日期少一天）；Yahoo 對 .TWO 有延遲 → 補抓 TWSE/TPEx 當月資料；回傳 `market`；`bust=1` 清快取 |
| `quote/route.ts` | **盤中即時報價**（MIS 近即時 → Yahoo 延遲退路）；`?code&market` → `{source,market,price,open,prevClose,...}` | MIS 一次同查 tse_\|otc_、由 `ex` 判市場；CORS 擋瀏覽器需 proxy；見「盤中即時報價」專段 + `lib/disposal/quote.ts` |
| `notices/route.ts` | 注意紀錄 | TWSE `rwd/zh/announcement/notice`；TPEx `www/zh-tw/bulletin/attention`（直接回 JSON `tables[0].data`） |
| `disposal/route.ts` | 單股處置 | **TWSE 是 `announcement/punish`**（不是 disposal！）；**TPEx 是 `bulletin/disposal`**（不是 disposition！） |
| `disposal-list/route.ts` | 全市場處置清單 | 同上兩個 URL，不帶 code |
| `market-avg/route.ts` | 全體均值（款一差幅 ≥ 20% 基底）；**上市/上櫃同口徑**（皆個股等權累積漲幅平均，上櫃已從櫃買指數加權改為個股等權）| 見下方專段 |
| `sectoravg/route.ts` | 同類/全體均值（款一①②、款三差幅閘）；回 `targetCum/marketAvg/sectorAvg/sectorCode`，均值排除標的本身 | `lib/disposal/marketData.ts` |

### `market-avg` — 全體累積漲幅（差幅 ≥ 20% 用）上市/上櫃同口徑（2026/05/29 起）
- **上市 = 全體普通股「逐日漲跌%(2 位無條件捨去) 相加」再等權(簡單)平均**（**非** TAIEX 指數）。逐檔抓 `twse.com.tw/exchangeReport/MI_INDEX?response=json&date=YYYYMMDD&type=ALLBUT0999`（`row[0]`=代號、`row[8]`=收盤、`row[9]`=漲跌方向(green=跌)、`row[10]`=漲跌價差），只取普通股 `[1-9]\d{3}`，6 日窗口交集後等權平均（`fetchTwseDailyPct`+`eqAvg`，含重試避免掉檔）。
- **上櫃 = 個股等權累積漲幅平均**（**已從舊版「櫃買指數加權」改為與上市同口徑**）。逐檔抓 `tpex.org.tw` 每日收盤（`afterTrading/dailyQuotes?date=ROC&type=EW&response=json`，`tables[0].data`：col0=代號、col2=收盤、col3=漲跌帶號），6 日窗口交集後等權平均（`fetchTpexDailyPct`+`eqAvg`）。
- 上市交易日窗口用 TAIEX `MI_5MINS_HIST?response=json&date=YYYYMMDD`（ROC 日期、`row[4]`=收盤指數）定出，再對那 6 日逐檔抓個股。
- **窗口**由 `?date=`（個股最近收盤日）決定，取 ≤ 該日最近 **6** 交易日（**5** 間隔）。回傳 `{ knownIntervals, baseDate, lastClosedDate, twse:{avg}, tpex:{avg} }`；`avg` 取不到為 `null`（個股端退回純價格門檻）。結果快取 6h（key=endYMD），`bust=1` 清。
- **對拍 attstock 新版黃金值（2026/05, 窗口5/22~28）**：國巨 2327 累積 = 27.36；同類（產業別28、排除國巨）= 6.15；全體（排除國巨）= 2.22。已固化為 `lib/disposal/__tests__/golden.test.ts` 回歸測試。

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

### PeriodChart X 軸：合成日期 + tickMarkFormatter（踩雷）
- 設計：每個時段第 `i` 個**交易日** → 合成日曆日 `REF + i 天`，讓所有時段對齊到第 0 天；X 軸真正的日期沒意義，純當索引。
- **lightweight-charts v5 雷**：餵字串日期（`'2020-06-15'`）當資料，library 內部轉成 **`BusinessDay` 物件**；`tickMarkFormatter`/crosshair 的 `time` 參數收到的是 **BusinessDay（或 UTCTimestamp 秒）, 不是字串**。舊碼把它當字串算 → `NaN`。
- **`tickMarkFormatter` 回傳 `null` 會 fallback 到預設格式器**（把合成日期 `2020/1/1` 直接秀出來）→ 這就是「起點顯示 2020/1/1」的根因。
- 修法（`PeriodChart.tsx`）：`timeToIndex(time)` 用 `isBusinessDay()` 三態分流（BusinessDay→`Date.UTC`／字串→`Date.parse`／number→`*1000`）換回天數索引；`axisLabel()` **永不回 null**（idx 0=「起點」、其餘「+N」）。`REF='2020-06-15'`（刻意避開年/月邊界）。crosshair 同樣改用 `timeToIndex`，tooltip 顯示真實日期。

---

## 四、檔案地圖

```
app/page.tsx                  五模式切換（overlay/period/disposal/chips/fund）
components/
  DisposalTool.tsx            注意/處置推演（核心，~1700 行；含盤中即時報價接線）
  PeriodPanel.tsx             時段比較側欄（年份+歷史）
  SeriesPanel/ChartOverlay/PeriodPanel/PeriodChart   疊加與時段圖
  ChipsView.tsx               籌碼-個股大戶趨勢（自訂張數區間、逐週扣三大法人）
  ChipsScreener.tsx           籌碼-篩選排行（大戶/內部大戶 top50、lazy 自動爬）
  FundView.tsx                訊號台 entry → renders <FundShell/>
  fund/FundShell.tsx          4 區段 sidebar (01 動向 / 02 持股 / 03 冠軍 / 04 個股流向)；container ResizeObserver < 720px 收合成 top-nav
  fund/MovesView.tsx          01 動向（跨 8 檔 ETF 每日加減碼聚合）
  fund/HoldingsView.tsx       02 持股（單 ETF 持股表 + 更新本期按鈕）
  fund/ChampionsView.tsx      03 冠軍（主動式 ETF YTD Top7 4 維度比較：績效/共識持股/重疊矩陣/集中度×YTD）
  fund/FlowView.tsx           04 個股流向（K 線 + 跨 ETF 淨持股股數變動柱，lightweight-charts）
app/api/
  stocks/                     Yahoo + TWSE/TPEx 補抓股價，回 market（含 volume；?ohlc=1 加 open/high/low）
  notices/ disposal/ disposal-list/   注意/處置紀錄
  market-avg/                 全體累積漲幅平均（款一差幅 ≥ 20% 基底）
  chips/                      單股 TDCC 集保級距週歷史（on-demand 爬 qryStock）
  foreign/                    單股逐週三大法人持股%（DJ，via lib/dj）
  chips-rank/                 全市場大戶/內部大戶排行（opendata + legalStore）
  chips-crawl/                背景漸進爬 DJ 三大法人（種子/維護/去重）
  fund/                       ETF API（bare → 列出 8 檔；?fund=<id> → {def, etfDaily}；?moves=1 → 跨 ETF 動向聚合；?flow=CODE → 個股流向序列）
  fund-crawl/                 live 抓最新（8 檔統一 MoneyDJ）；POST {fundId} 單檔覆蓋｜POST {all:true} 一次爬全 8 檔（以來源日期為鍵，已存在則跳過）；18:30 gate (→ 425)，{force:true} 可繞過
  fund-rank/                  GET data/fund-rank.json（主動式 ETF YTD 排行 snapshot）
lib/fund/
  types.ts                    types（ReportType 只剩 'etf_daily'、CrawlStrategy 只剩 'moneydj'|'none'）
  sources.ts                  ETFS = ALL_DEFS（8 檔主動式 ETF）
  store.ts                    disk+memory snapshot store（ETF cache 至 .funddata/etf/<id>/<period>.json）
  moves.ts                    fundMoves / aggregateMoves（純函式，FundSnapshot 通用）
  flow.ts                     computeFlow（純）：個股跨 ETF 逐日淨持股股數變動聚合
  timegate.ts                 isAfterCutoff（台灣 18:30，純）
  parse/moneyDjEtf.ts         統一 ETF parser（cheerio：td.col05/06/07）
  parse/moneyDjRank.ts        ETF YTD 排行 parser
  __tests__/fixtures/         moneydj-*.html（9 ETF + rank 真實 fixtures）+ moves-{prev,curr}.json；flow.test.ts
data/fund-rank.json           committed 主動式 ETF 排行 snapshot
.funddata/etf/                ETF 每日快照本機快取（gitignore，可重抓）
lib/cache.ts                  記憶體快取（getCached/setCached/deleteCachePrefix）
lib/chipsStore.ts             單股 TDCC 級距週資料（per-ticker）
lib/rankStore.ts              全市場大戶佔比每週快照（opendata）
lib/legalStore.ts             全市場三大法人持股 per-stock 週資料（DJ，留 52 週）+ 爬取進度
lib/dj.ts                     DJ 法人持股明細抓取（big5、上市櫃通吃）
docs/PROJECT_NOTES.md         （本檔）
```

---

## 五、法規來源
- FL007225（公布注意交易資訊暨處置作業要點）、FL007226（注意標準附表）
- 上市標準：twse-regulation.twse.com.tw；上櫃標準：證券櫃買中心（用戶提供 PDF）
- 上市/上櫃**數字不同**（如上表），務必依市場別套用。

---

## 六、籌碼 / 大戶（chips 模式）

目標：看「集保大戶持股集中度」與「**內部大戶 = 大戶 − 三大法人**」的趨勢與全市場排行（仿 CMoney 內部大戶 APP，不做財報篩選/社團）。

### 概念與級距
- **大戶**：集保戶股權分散表中持股達門檻的級距佔比。門檻**只能對齊集保級距邊界**（張）：`50/100/200/400/600/800/1000`。
- 級距 index(0-14) → ≥張數下界 `tierLots = [0,1,5,10,15,20,30,40,50,100,200,400,600,800,1000]`。≥X張 = 從該級距加總到 tier15。常用：≥400張=級距12-15、≥1000張=級距15。
- **內部大戶 = 大戶佔比 − 三大法人持股比重%**（扣掉法人才是「非法人大戶」）。

### 資料源（關鍵）
| 用途 | 來源 | 範圍 |
|------|------|------|
| 單股大戶級距週歷史 | TDCC 個股查詢 `qryStock`（POST，Struts **SYNCHRONIZER_TOKEN** 一次性、**token 鏈**、cookie；`firDate`=最新日不是查詢週） | 約 1 年 |
| 全市場大戶（最新週） | TDCC opendata `getOD.ashx?id=1-5`（一次回全市場 ~3900 檔 × 17 級距，欄位：日期,代號,分級,人數,股數,佔比%） | 僅最新一週 |
| 三大法人持股 | **DJ**（富邦/嘉實）`zcl.djhtm?a=代號&c=起&d=迄`（**big5**、伺服器渲染、上市櫃通吃；明細表末欄序：外資/投信/自營**估計持股(張)**、三大法人合計(張)、外資%、三大法人%）| 約 1 年每日 |
| `lib/dj` 回傳 | `LegalRow = [外資%, 三大法人%, 外資張, 投信張, 自營張]`（chips-rank 只讀 index 1=三大法人%；ChipsView 柱圖用張數） | — |
| **`/api/foreign` 快取規則** | 一律抓**固定近 54 週**（不跟著請求 dates 變），快取以 code 為 key → 永遠完整。**勿用請求區間當抓取範圍**（曾因此只快取到 1 天、線圖最後一週暴跌） | — |
| 外資官方（備用） | 上市 MI_QFIIS、上櫃 OpenAPI `tpex_3insti_qfii`（⚠️ MI_QFIIS `row[6]`=**尚可投資比率非持股**，持股要 `(發行−尚可)/發行`，已改用 DJ） | — |
| 全市場三大法人買賣超週報（維護用） | 上市 `TWT54U?date=週起&dymd=週迄&selectType=ALLBUT0999`（1335 檔）；上櫃週報端點未接 | 每週 |

### 內部大戶爬蟲策略（`chips-crawl` + `legalStore`）
- **DJ 逐檔**（一個來源就給完整三大法人，省掉外資/投信/自營分開接）。背景漸進、禮貌延遲 300ms、可中斷續爬（`_progress.json`，換週自動重置）。
- **三層省抓**：①已含本週→**跳過不抓**（dedup）；②有舊資料→**只抓近 3 週**合併進既有；③全新股→才抓滿 ~52 週（種子）。
- **52 週滾動**：DJ 每日 → 收斂每週一點（該週最後一日）→ 只留最新 52 週，新進舊出。
- **lazy 自動**：開「篩選排行→內部大戶」時前端自動分批呼叫 `chips-crawl` 補齊本週並顯示進度；新週自動重爬。**無排程器**、本機/雲端通用。

### 資料時間 / 對齊（重要，別貼錯週）
- **一律用資料源自己的日期欄位當週次**，不要用「今天」推。
- 延遲 ≈「最新可得 = 上一個完成的週五」（週五資料約週一到位），**非整整一週**。opendata 與 DJ 通常都對齊到同一個上週五。
- **同週相減**：`chips-rank` 的 `legalAt()` 把三大法人錨定到「≤ opendata 週」最近一筆 → 兩源更新時間差也不混週。

### 排行（`chips-rank`）
- `?net=1` = 內部大戶（大戶 − 三大法人）；否則原始大戶。`?lots=400|1000`、`?sort=level|d1`、`limit` 預設 100、UI 取 **top 50**。
- **net 全覆蓋 + 資料品質 `src`**（每列回傳）：①legalStore 有 DJ → `src='dj'`（扣完整三大法人，且有 d1 增減）；②否則官方外資 map（`fetchForeignMap`：MI_QFIIS 上市 + tpex_3insti_qfii 上櫃）有 → `src='qfii'`（僅扣外資、無 d1）；③都無 → 法人視同 0、`src='none'`（內部大戶≈大戶）。UI 代號標記：`外`=qfii、`＊`=none、無標=dj。
- **DJ 覆蓋缺口**：全市場 ~2933 檔中 DJ 約 **1970 檔有法人資料**；缺的 ~960 檔（多為低量傳產 11xx/12xx）**DJ 與官方外資皆查無**（法人持股極低），故落到 `src='none'`、頂端會出現 100% 的封閉持有小股（屬正常、非訊號）。**未加過濾開關**（用戶決定）。
- **週對週增減**：opendata 大戶每週累積（rankStore）+ DJ 三大法人歷史 → 第 2 個 opendata 週後自動長出（僅 `src='dj'` 有）。

### ChipsView 個股圖（lightweight-charts，**單張疊圖**，price+volume 式）
- **同一個 chart**：內部大戶%折線走**右軸**（`scaleMargins {top:0.05,bottom:0.42}` → 佔上方）；三大法人庫存**三色堆疊柱**走**左軸**（`scaleMargins {top:0.62,bottom:0}` → 壓底部），共用時間軸 → 每個線點正上方對齊它的柱。
- 堆疊柱用「**累積值 + z-order**」技巧：先 addSeries 總和(自營綠)、再外資+投信(投信橘)、再外資(外資藍)，最後才 addSeries 折線（疊最上層）。視覺由下而上 = 外資/投信/自營。
- **crosshair tooltip**：顯示該週「內部大戶%」+ 外資/投信/自營**個別庫存(張)**（tooltip 用 `qByRef/iByRef/dByRef` 取最新，因 init effect 只跑一次）。
- 自訂「股價區間→張數門檻」可加區間（localStorage `chips_bands_v1`），依股價挑門檻。

### 踩雷
- **勿在 server 執行中 `rm .legaldata`**：store 的 `ensureDisk` 快取了「目錄存在」，刪目錄後 mkdir 不再執行 → 寫檔靜默失敗。要重置請重建目錄或重啟 dev server。
- DJ 是第三方、big5、格式可能改版 → 會需要修 `lib/dj.ts`。投信/自營是 DJ 估算、持股比重以**佔已發行**計（與集保庫存略差），UI 已標。
- TDCC `qryStock` 的 token 一次性：每次 POST 從回應頁抓新 token 給下一週（鏈式）。

### 現況（2026/05 種子完成）
- DJ 種子爬蟲已跑完：**1970 檔**有三大法人週資料（52 週）；其餘 ~960 檔 DJ/官方外資皆無（低法人股）。
- net 排行全市場可用（含品質標記）；lazy 自動（開內部大戶頁→分批補本週、新週重爬）已生效。

### 待辦（之後）
- 週報買賣超維護匯入器（取代維護期的 DJ 抓取，更省）：缺上櫃週報端點 + 需發行股數換算（買賣超→%）+ 除權息漂移處理。**有 1970 檔的 DJ 絕對持股當基準，可改用 `TWT54U?...&selectType=ALLBUT0999` 全市場買賣超累加維護**。
- 回測系統（之前規劃過，未做）：抽 `disposalEngine` 純函式 + 歷史逐日重跑（見對話規劃）。

---

## 七、主動式 ETF 持股（fund 模式）

> **2026/05/29 重構**：原本 13 檔投信基金（SITCA 月/季報）的 live 來源遲遲找不到（SITCA WebForms 那頁實際上是 fund-of-funds 投資比率表，cnYES 代號錯位且落後，MoneyDJ 基金區 big5 沒解），所以放棄基金、只做主動式 ETF。刪除：13 檔基金 seed (`data/funds/`)、衍生 JSON (`fund-{strategies,dna,flow}.json`)、04 策略 / 05 經理人 / 06 資金流 三頁、`lib/fund/{seed,period,query}.ts`、`scripts/fund-seed.ts`、`sitca` crawl 策略。Git history 留有完整脈絡，需要追歷史時可 `git log -- data/funds/`。

目標：跨 7 檔主動式 ETF 看每日持股動向、單檔持股明細，與 YTD 冠軍 ETF 的交叉分析。

### 8 檔 ETF（`lib/fund/sources.ts` 唯一真相來源，2026/05/29 對齊 MoneyDJ 主動式 ETF 排行）
00980A 主動野村臺灣優選、00981A 主動統一台股增長、00982A 主動群益台灣強棒、00985A 主動野村台灣50、00988A 主動統一全球創新、00990A 主動元大 AI 新經濟、00991A 主動復華未來50、00992A 主動群益科技創新。全部走 MoneyDJ。
- **00988A 含 US/JP/KS 多市場部位**，parser 已支援。
- 早期曾納入 00984A 安聯、00986A 台新、00993A，現已移出（不再列在 MoneyDJ 主動排行）。Test fixtures 仍保留以驗證 parser 對多形態 HTML 的相容性。

### 「訊號台」識別（自有）
- CSS vars 在 `app/globals.css` 的 `.fund-term`：`--bg #0e1116 / --panel #161a22 / --panel2 #1c2230 / --line / --accent #35c9d6 (cyan) / --txt / --txt-dim / --txt-mute / --up #ff5d6c (red) / --down #34d399 (green)`。
- 台股慣例 **red=漲/加碼、green=跌/減碼**（跟西方相反，別搞錯）。
- `font-mono` + `tabular-nums` 所有數字；nav 加 mono index `01..03`。
- RWD：FundShell 用 ResizeObserver 監看 container 寬度，**< 720px 自動把 sidebar 收成 top-nav**；MovesView grid 用 `repeat(auto-fit, minmax(min(100%, 300px), 1fr))` 保證子欄不溢位（`min(100%, X)` 是關鍵 trick）。

### 4 個分頁
| # | 名稱 | 元件 | 內容 |
|---|------|------|------|
| 01 | 動向 | `MovesView` | 跨 8 檔 ETF 最新 vs 前一可得交易日 加碼/減碼/新進/落榜聚合 |
| 02 | 持股 | `HoldingsView` | 單 ETF 持股表 + 更新本期 |
| 03 | 冠軍 | `ChampionsView` | YTD Top7 四維比較：績效表 / 共識持股 / 重疊矩陣 / 集中度×YTD |
| 04 | 個股流向 | `FlowView` | 輸入股號 → 上方 K 線 + 下方逐日「跨 ETF 淨持股股數變動」柱（紅=加碼/綠=減碼）。見下方流向指標。 |

### 資料模型（`lib/fund/types.ts`）
- `ReportType: 'etf_daily'`（單一）
- `CrawlStrategy: 'moneydj' | 'none'`
- `FundSnapshot { fundId, reportType, period, source, fetchedAt, holdings[], meta? }`
- `FundHolding { code, name, weightPct, rank?, shares?, amount?, market? }` — `shares`（股數）是流向指標的主要度量；MoneyDJ 取 `td.col07`、野村 API 取 Table row[2]。
- `FundDef { fundId, company, etfTicker, crawl }`
- 唯一鍵 `(fundId, reportType, period)`，重存 = upsert（冪等）。

### 儲存（`lib/fund/store.ts`，仿 chipsStore disk+memory）
- ETF 每日：`.funddata/etf/<ticker>/<period>.json`（gitignore，可重抓）
- `saveSnapshot/loadSnapshot/listPeriods` API；唯讀 FS 自動退記憶體。

### Live 爬蟲 — MoneyDJ（單一來源）
- `crawl: 'moneydj'`：`GET https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=<TICKER>.TW`
  - **UTF-8、無 cookie/token/auth、server-to-server 直接 200**。
  - Cheerio selector：`tr` filter has both `td.col05` + `td.col06`。
  - 取 row：`td.col05 a` text 為 `<中文名>(<code>.TW)`；`td.col06` weight%；`td.col07` shares。
  - Period：掃全頁第一個 `YYYY/MM/DD` → `YYYY-MM-DD`。
  - 一個 parser (`lib/fund/parse/moneyDjEtf.ts`) 通吃所有 ETF（含 US/JP/KS 多市場）。
  - 對拍結果（fixtures 已存）：00980A 45、00981A 51、00982A 59、00984A 109、00986A 28、00990A 52、00991A 50。

### 加減碼聚合（`lib/fund/moves.ts`，純）
- `fundMoves(prev, curr): FundMove[]` per-stock 變化（`kind: 'add' | 'reduce' | 'enter' | 'exit'`，weight 不變則略過）。
- `aggregateMoves(perFund): StockAgg[]` 跨 ETF group by code，計 `upCount/downCount/netCount/totalDelta`。
- `/api/fund?moves=1` 內：對每檔 ETF 拿最新 2 個 `etf_daily` period（latest vs prev），各算 `fundMoves` 後丟給 `aggregateMoves`。回 `{currPeriod, prevPeriod, up[], down[]}`，up/down 各取前 40。
- `currPeriod/prevPeriod` 取所有 ETF 裡**最晚的 latest**那一對；若各 ETF 抓取日期不同（罕見），仍是逐 ETF 自己對自己比，不會混期。

### 觸發流程
1. 開 chart-overlay「主動式ETF」分頁 → MovesView 預設。
   - **進場自動爬（2026/05/29）**：`FundShell` 掛載時，若台灣時間（UTC+8）為**平日且過 18:30** → 背景 POST `/api/fund-crawl {all:true}` 一次爬全 8 檔，並以 `localStorage` 旗標 `fund-autocrawl:<YYYY-MM-DD>` 確保每日只觸發一次（失敗不設旗標、下次進場重試）。週末略過（不打 API）；節慶休市由「來源日期為鍵」自動跳過（MoneyDJ 休市日仍回上個交易日 → period 已存在 → skipped）。爬取狀態以頂部 pill 顯示（資料更新中… / 已更新 N 檔 / 資料已是最新）。
2. 切到 02 持股 → 選 ETF → 顯示當日持股。
3. 點「更新本期」→ POST `/api/fund-crawl {fundId}`（單檔，總是覆蓋寫入）；18:30 前回 425（`{force:true}` 可繞過）、live → 200 + 寫 `.funddata/etf/<ticker>/<date>.json`。
4. 03 冠軍從 `data/fund-rank.json`（committed snapshot）直接讀，不走 fund-crawl。

### 個股流向指標（2026/05/29；歷史回填功能已移除）
**目標**：輸入股號（如 2330）→ 上方 K 線、下方柱狀顯示「該日跨所有主動式 ETF 的淨持股股數變動」（紅=加碼/綠=減碼）。

**單一來源原則（重要）**：8 檔 ETF 全部走 MoneyDJ `Basic0007B`（含 `col07 持有股數` + 來源日期）。MoneyDJ **無日期參數、只給最新**，所以流向序列只能**靠每日爬蟲往前累積**（≥2 個有股數的交易日才有 delta）。
- **2026/05/29 重構**：原本野村 2 檔（00980A/00985A）另接 `nomurafunds.com.tw` date-aware REST 回填完整歷史，但其餘 6 檔無等價回填來源，混用會違反單一來源原則並在流向圖造成假「全出再全進」尖刺。依用戶決定**全部刪除、8 檔統一 MoneyDJ 重來**：移除 `lib/fund/history/`（nomura adapter + dispatch）、`app/api/fund-backfill`，清空 `.funddata/etf/*` 後以 `{all:true,force:true}` 重新種一輪（每檔 1 個快照）。歷史脈絡見 git log。
- recon 備忘（為何 6 檔無回填）：群益 `capitalfund.com.tw` 被 Incapsula WAF 擋(403)；元大 `etfapi.yuantaetfs.com` 是 FuncId gateway 需瀏覽器側 recon；統一 ezmoney、復華 Excel 皆「只有當期」。野村 REST 雖可回填但屬不同源，棄用。

**流向聚合** `lib/fund/flow.ts`（純）：`computeFlow(perEtf, code): FlowSeries`。
- 每檔 ETF 比較自己**相鄰快照**的股數差（後一日 - 前一日），首個快照不計（不把建倉算加碼）；股票不在清單視為 0 股；delta 歸屬後一個快照日；跨 ETF 同日加總。
- 🛡️ **無股數快照防護**：`isSharelessSnapshot()` 把「有持股清單但全無 shares 欄位」的舊快照（早期 MoneyDJ）剔除，永久根治混源假尖刺（空持股快照 length 0 不算，予以保留）。即使舊 shares-less 快照仍在硬碟，computeFlow 也會自動忽略。
- 回 `{ code, name, points[{date,netShares,addShares,reduceShares,contributors[]}], etfsCovered[] }`。
- API：`/api/fund?flow=CODE`（載入全 ETF 全 period 快照後 computeFlow）。
- UI `FlowView`：lightweight-charts 單張疊圖，K 線(`CandlestickSeries`)走右軸上方、流向柱(`HistogramSeries` 逐 bar color 紅/綠)走左軸壓底；股數顯示以 ÷1000=張。`/api/stocks?...&ohlc=1` 新增 OHLC（只在帶 ohlc=1 時回 open/high/low，cache key 加 `:ohlc` 後綴，不影響既有 overlay 消費者）。

### ⚠️ Data-integrity 教訓（保留）
**Sub-agent 自生「寫實 spread」假資料事故**：曾有 implementer 自行生成 `fund-strategies.json`，graduation 6m 寫成 `0.1634` / 387 trades，與真實 (63.54% / 510 trades) 差距巨大。**Data fixture 必須 verbatim 真實 server response**，任何「我幫你補一些寫實 spread」都是 fabrication。修補後所有 fixtures 已對拍真實值（含 MoneyDJ ETF 的 byte-identical curl 驗證）。

### 待辦
- **流向覆蓋現況**：8 檔統一 MoneyDJ 單一來源（含股數），無歷史，自每日爬蟲累積往前。已用「進場自動爬」（過 18:30/平日，每日一次）取代手動觸發；動向頁與流向圖都隨累積天數變長。**前提是有人在平日 18:30 後開過頁面**——純前端觸發，無伺服器排程。
- 若要保證每日都抓（即使沒人開頁）：未來可加伺服器側 cron / 排程（serverless 環境需外部觸發）。
- **未來功能（用戶已提，尚未實作）**：單檔 ETF「連續 N 個交易日加碼/減碼」之類的訊號顯示，做出與市面 app 的差異化。
- 之後可能：ETF vs ETF dualTrack 比較、ETF 回測（流向歷史累積後可做）。
