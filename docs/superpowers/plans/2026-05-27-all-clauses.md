# 注意款全補齊 + 原子引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 DisposalTool 的注意判定重構成獨立「原子款評估器」引擎，並補齊款六/十一/十二（雙市場）、修 trunc2 浮點精度；款四/五 標資料不足。

**Architecture:** 新增 `lib/clauseEngine.ts`（純函式，每款一個 evaluator，回 `ClauseResult`，組合成 `{first, any}` 餵既有 `computeTriggers`）。價格款（一/十一）即時算；需當日資料款（三/六/十二）放下方面板＋假設開關。新增 `/api/peratio`、`/api/sbl`（雙市場）。

**Tech Stack:** Next.js 16 App Router, TypeScript；官方端點 TPEx dailyQuotes/peratio_analysis/margin-sbl、TWSE MI_INDEX/BWIBBU_d/TWT93U。無測試框架 → Node 驗證腳本 + dev server :3000。

---

## 已釘死事實（實測）

- **款十一 gap(P)**：上櫃 `70 + floor(P/300)×15`、上市 `100 + floor(P/500)×25`（P=當日收盤，300/500「含」即 floor）。觸發 = `當日收盤 − 窗口最低收盤 ≥ gap`（當日為窗口最高；沙盤預測 up-move 用 predictPrice − min(窗口收盤)）。
- **款六 PE/PBR**：上櫃 `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis`（回**最新交易日快照**、忽略 date 參數；array of `{SecuritiesCompanyCode, PriceEarningRatio, PriceBookRatio}`）。上市 `https://www.twse.com.tw/exchangeReport/BWIBBU_d?response=json&date=YYYYMMDD&selectType=ALL`（`data` row：[0]代號 [2]收盤 [5]本益比("-"=略) [6]股價淨值比）。門檻 上櫃 PE≥65且>全體均×2 或 PBR≥4且>均×2；上市 PE≥60/PBR≥6。**全體均值用簡單算術平均(排除"-")**——因絕對門檻(≥65/≥4)幾乎恆 dominate「>均×2」（市場均 PE~20→×2=40<65），均值精度不敏感。
- **款十二 借券**：上櫃 `https://www.tpex.org.tw/www/zh-tw/margin/sbl?date=YYYY/MM/DD&response=json`（`tables[0].data` row：[0]代號 [9]借券當日賣出 [12]借券當日餘額）。上市 `https://www.twse.com.tw/exchangeReport/TWT93U?response=json&date=YYYYMMDD`（`data` row：[0]代號 [9]當日借券賣出 [12]借券餘額；**末列「合計」排除**）。門檻 上櫃 6日借券賣出率>9%且放大≥4×；上市 12%/5×。
- **trunc2 精度**：`Math.round(x*1e8)/1e8` 後 `Math.trunc(*100)/100`。
- 數字格式都含千分位逗號字串 → 用既有 `idxNum`/`parseNum` 解析。

## File Structure

- **Create `lib/clauseEngine.ts`**：純函式款評估器 + 型別。唯一判定真相來源。
- **Create `app/api/peratio/route.ts`**：個股 PE/PBR + 全體簡單均（雙市場）。
- **Create `app/api/sbl/route.ts`**：個股 6日借券賣出/成交量 + 60日均（雙市場）。
- **Modify `components/DisposalTool.tsx`**：改用 clauseEngine；新增款十一卡片門檻、款六/十二下方面板＋假設開關；款四/五 標資料不足。
- **Modify `app/api/market-avg/route.ts`**：僅 trunc2 精度修正（twseEqAvg）。

---

## Task 1: 修 trunc2 浮點精度

**Files:** Modify `components/DisposalTool.tsx`、`app/api/market-avg/route.ts`；Verify `scripts/v-trunc.mjs`

- [ ] **Step 1: 驗證腳本（先示範現況錯誤）**

```js
// scripts/v-trunc.mjs
const bad = (x) => Math.trunc(x * 100) / 100;
const good = (x) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100; };
const r = (47.3 / 43.0 - 1) * 100;   // 應為剛好 10.00
console.log('raw', r, 'bad', bad(r), 'good', good(r));
if (good(r) !== 10) { console.error('FAIL good'); process.exit(1); }
// 4127 天良 6日: 43→47.3→52→57.2→62.9→69.1→68.1 (base 5/18=43)
const c = [43, 47.3, 52, 57.2, 62.9, 69.1, 68.1];
let s = 0; for (let i = 1; i < c.length; i++) s += good((c[i] / c[i-1] - 1) * 100);
console.log('4127 sum', +s.toFixed(2), '(expect 48.30)');
if (+s.toFixed(2) !== 48.30) { console.error('FAIL 4127'); process.exit(1); }
console.log('PASS');
```

- [ ] **Step 2: 跑** `node scripts/v-trunc.mjs` → 期望 `good 10`、`4127 sum 48.3`、`PASS`。

- [ ] **Step 3: 改 `components/DisposalTool.tsx`** 的 `trunc2`（目前 `const trunc2 = (x: number) => Math.trunc(x * 100) / 100`）改為：

```ts
const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }
```

- [ ] **Step 4: 改 `app/api/market-avg/route.ts`** 的 `trunc2`（在 `twseEqAvg` 內）同樣改為上式。

- [ ] **Step 5: 驗證** `npx tsc --noEmit`（無錯）；`curl -s "http://localhost:3000/api/market-avg?date=20260526&bust=1"`（tpex 9.98、twse 仍 5.x 非 null）。

- [ ] **Step 6: Commit** `git add -A && git commit -m "fix: trunc2 浮點精度(整除日如47.3/43→10.00)"`

---

## Task 2: 建 lib/clauseEngine.ts（既有款一/二/三 評估器）

**Files:** Create `lib/clauseEngine.ts`；Verify `scripts/v-engine.mjs`

- [ ] **Step 1: 建 `lib/clauseEngine.ts`**（完整內容）：

```ts
export type Market = 'TWSE' | 'TPEx'
export type ClauseId = '1①' | '1②' | '2' | '3' | '6' | '11' | '12'
export interface ClauseResult { id: ClauseId; fired: boolean; first: boolean; detail: string; blocked?: boolean }

const trunc2 = (x: number) => { const v = Math.round(x * 1e8) / 1e8; return Math.trunc(v * 100) / 100 }

// 台股 tick（與 DisposalTool 一致）
const tickOf = (p: number) => p < 10 ? 0.01 : p < 50 ? 0.05 : p < 100 ? 0.1 : p < 500 ? 0.5 : p < 1000 ? 1 : 5
const nextTick = (p: number) => { const t = tickOf(p); let k = Math.ceil(p / t) * t; if (k <= p + 1e-9) k += t; return +k.toFixed(2) }
const clTick   = (p: number) => { const t = tickOf(p); return +(Math.round(p / t) * t).toFixed(2) }

// 款一/二/三 價格門檻% 與款十一 gap、款六/十二 門檻（依市場別）
const PCT = {
  TWSE: { c1a: 32, c1b: 25, c3: 25, gap: 50, c2: [100, 130, 160] as const, sbl11: 100, sblStep: 500, sblAdd: 25, pe: 60, pbr: 6, sblRate: 12, sblAmp: 5, c2dup: 25 },
  TPEx: { c1a: 30, c1b: 23, c3: 27, gap: 40, c2: [100, 140, 160] as const, sbl11: 70,  sblStep: 300, sblAdd: 15, pe: 65, pbr: 4, sblRate: 9,  sblAmp: 4, c2dup: 27 },
}

export interface ClauseInput {
  market: Market
  prevClose: number      // 計算日前一交易日收盤
  sumKnown: number       // 已知累積%(基準→前一日, trunc2 相加)
  price: number          // 計算日(預測)收盤
  spreadBase: number     // 6日窗口第一天收盤(款一②價差用)
  windowMin: number      // 6日窗口最低收盤(含預測價, 款十一用)
  marketAvg6: number | null   // 全體6日累積%(款一差幅)
  c2: { window: number; pct: number; exempt: boolean } | null  // 款二: 觸發窗口/漲幅/是否豁免(DisposalTool 算好傳入)
  volMet: boolean        // 款三 當日量達標(假設或實際)
  pe: number | null; pbr: number | null; mktPe: number | null; mktPbr: number | null  // 款六(pe/pbr=預測日值)
  c6Assume: boolean      // 款六 假設當日週轉/券商達標
  sblRate: number | null; sblAmp: number | null  // 款十二(含預測日假設後的值)
  c12Assume: boolean     // 款十二 假設當日借券達標
}

// 達累積漲幅 x% 所需計算日收盤
const priceForCum = (prevClose: number, sumKnown: number, x: number) => prevClose * (1 + (x - sumKnown) / 100)
const cumOf = (inp: ClauseInput) => inp.sumKnown + trunc2(inp.prevClose > 0 ? (inp.price - inp.prevClose) / inp.prevClose * 100 : 0)

export function gap11(market: Market, price: number): number {
  const m = PCT[market]
  return m.sbl11 + Math.floor(price / m.sblStep) * m.sblAdd
}

function c1(inp: ClauseInput): ClauseResult[] {
  const m = PCT[inp.market]
  const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity
  const t1 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c1a, diff)))
  const t2 = Math.max(nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c1b, diff))), clTick(inp.spreadBase + m.gap))
  const cum = cumOf(inp)
  const f1 = inp.price >= t1, f2 = !f1 && inp.price >= t2
  return [
    { id: '1①', fired: f1, first: f1, detail: `累積${cum.toFixed(2)}% ≥門檻${t1}` },
    { id: '1②', fired: f2, first: f2, detail: `累積${cum.toFixed(2)}%+價差 ≥門檻${t2}` },
  ]
}
function c2(inp: ClauseInput): ClauseResult {
  const hit = inp.c2 && inp.c2.pct > 0 && !inp.c2.exempt
  return { id: '2', fired: !!hit, first: false, detail: inp.c2 ? `${inp.c2.window}日 ${inp.c2.pct.toFixed(1)}%${inp.c2.exempt ? '(豁免)' : ''}` : '無資料' }
}
function c3(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const diff = inp.marketAvg6 != null ? inp.marketAvg6 + 20 : -Infinity
  const t3 = nextTick(priceForCum(inp.prevClose, inp.sumKnown, Math.max(m.c3, diff)))
  const fired = inp.volMet && inp.price >= t3
  return { id: '3', fired, first: false, detail: `價≥${t3} 且當日量達標` }
}
function c11(inp: ClauseInput): ClauseResult {
  const g = gap11(inp.market, inp.price)
  const spread = inp.price - inp.windowMin
  const fired = spread >= g
  return { id: '11', fired, first: false, detail: `起迄價差 ${spread.toFixed(2)} ≥${g}元` }
}
function c6(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const peHit  = inp.pe  != null && inp.pe  >= m.pe  && (inp.mktPe  == null || inp.pe  > inp.mktPe  * 2)
  const pbrHit = inp.pbr != null && inp.pbr >= m.pbr && (inp.mktPbr == null || inp.pbr > inp.mktPbr * 2)
  const priceHit = peHit || pbrHit
  const fired = priceHit && inp.c6Assume
  return { id: '6', fired, first: false, blocked: !inp.c6Assume && priceHit, detail: `PE${inp.pe?.toFixed(1) ?? '—'}/PBR${inp.pbr?.toFixed(2) ?? '—'} ${priceHit ? '達標(需當日週轉/券商)' : '未達'}` }
}
function c12(inp: ClauseInput): ClauseResult {
  const m = PCT[inp.market]
  const rateHit = inp.sblRate != null && inp.sblRate > m.sblRate
  const ampHit  = inp.sblAmp  != null && inp.sblAmp  >= m.sblAmp
  const known = rateHit && ampHit
  const fired = known && inp.c12Assume
  return { id: '12', fired, first: false, blocked: known && !inp.c12Assume, detail: `借券率${inp.sblRate?.toFixed(2) ?? '—'}% 放大${inp.sblAmp?.toFixed(1) ?? '—'}×` }
}

export function evalClauses(inp: ClauseInput): ClauseResult[] {
  return [...c1(inp), c2(inp), c3(inp), c6(inp), c11(inp), c12(inp)]
}
// 給 computeTriggers 用：該卡是否成立第一款 / 任一款
export function summarize(rs: ClauseResult[]): { first: boolean; any: boolean } {
  return { first: rs.some(r => r.first && r.fired), any: rs.some(r => r.fired) }
}
export { gap11 as _gap11, PCT as _PCT }
```

- [ ] **Step 2: 驗證腳本** `scripts/v-engine.mjs`（import 編譯後不便，直接複製關鍵函式測 gap11 + 款十一/款一邏輯）：

```js
const PCT = { TPEx:{sbl11:70,sblStep:300,sblAdd:15}, TWSE:{sbl11:100,sblStep:500,sblAdd:25} };
const gap11 = (m,p)=>PCT[m].sbl11 + Math.floor(p/PCT[m].sblStep)*PCT[m].sblAdd;
// 上櫃驗證點(attstock): 51.8→70, 355.5→85, 464→85, 930→115, 3425→235
const cases=[[51.8,70],[355.5,85],[464,85],[930,115],[3425,235]];
let ok=true; for(const [p,e] of cases){ const g=gap11('TPEx',p); if(g!==e){console.error('FAIL',p,g,e);ok=false;} }
console.log(ok?'gap11 PASS':'gap11 FAIL'); if(!ok)process.exit(1);
```

- [ ] **Step 3: 跑** `node scripts/v-engine.mjs` → `gap11 PASS`。`npx tsc --noEmit` 無錯。

- [ ] **Step 4: Commit** `git add lib/clauseEngine.ts scripts/v-engine.mjs && git commit -m "feat: clauseEngine 原子款評估器(款一/二/三/六/十一/十二)"`

---

## Task 3: DisposalTool 改用 clauseEngine（款一/二/三，回歸不退化）

**Files:** Modify `components/DisposalTool.tsx`

- [ ] **Step 1:** import 引擎：頂部加 `import { evalClauses, summarize, gap11, type ClauseInput, type ClauseResult } from '@/lib/clauseEngine'`。

- [ ] **Step 2:** 在 derived 區（`closePath`/`knownSumOf`/`prevCloseOf`/`spreadBaseOf` 之後）新增每卡 input 組裝 + 評估：

```ts
const windowMinOf = (i: number) => Math.min(...closePath.slice(i, i + OFFSET + 1).filter(v => v != null))
const evalCard = (i: number, price: number): ClauseResult[] => evalClauses({
  market, prevClose: prevCloseOf(i), sumKnown: knownSumOf(i), price,
  spreadBase: spreadBaseOf(i), windowMin: Math.min(windowMinOf(i), price),
  marketAvg6: mAvgPct,
  c2: i === 0 ? clause2ForEngine() : null,
  volMet: i === 0 && clause3VolMet,
  pe: i === 0 ? pePredict(price) : null, pbr: i === 0 ? pbrPredict(price) : null, mktPe: peData?.mktPe ?? null, mktPbr: peData?.mktPbr ?? null,
  c6Assume: i === 0 && clause6Assume,
  sblRate: i === 0 ? (sblData?.rate ?? null) : null, sblAmp: i === 0 ? (sblData?.amp ?? null) : null,
  c12Assume: i === 0 && clause12Assume,
})
```

  （`clause2ForEngine`/`pePredict`/`pbrPredict`/`peData`/`sblData`/`clause6Assume`/`clause12Assume` 在 Task 4-6 加；本 Task 先以 `c2:null, pe/pbr:null, sblRate/Amp:null, *Assume:false` 佔位讓款一/二/三可動——款二改由既有 `checkClause2` 結果轉成 `clause2ForEngine()`，見下）。

- [ ] **Step 3:** 款二橋接：新增 `const clause2ForEngine = () => { const r = clause2; return r.triggered ? { window: r.window!, pct: r.pct!, exempt: r.exempt } : null }`（`clause2` 已由既有 `checkClause2(priceHistory, pastNotices, market)` 算出）。

- [ ] **Step 4:** 取代 `notices` 迴圈：

```ts
const notices: { first: boolean; any: boolean }[] = []
for (let i = 0; i < days.length; i++) {
  if (simPrices[i] === null) break
  notices.push(summarize(evalCard(i, simPrices[i]!)))
}
```

- [ ] **Step 5:** 改 `computeTriggers` 介面吃 `{first, any}[]`（目前吃 `(0|1|2|3)[]`）。在 `computeTriggers` 內：`isFirst = isPast ? (n===1) : all[i].first`、`isAny = isPast ? (n>=1) : all[i].any`（歷史 pastNotices 仍 level 1/2：1→first+any、2→any）。把 `notices: (0|1|2|3)[]` 參數型別改為 `{first:boolean;any:boolean}[]`，內部 `prior` 仍用 level，`all=[...prior.map(l=>({first:l===1,any:l>=1})), ...notices]`。

- [ ] **Step 6:** 卡片渲染：用 `evalCard(i, chosen)` 取得 `ClauseResult[]`，款一① `t1`/款一② `t2` 仍顯示（從 `thresh` 或改由引擎回門檻——保留現有 `thresh` 供顯示門檻線；引擎負責 fired 判定）。卡片色：`rs.some(r=>(r.id==='1①'||r.id==='1②')&&r.fired)`→紅；`rs.find(r=>r.id==='11')?.fired`→橘(款十一)；其餘綠。

- [ ] **Step 7:** 驗證 `npx tsc --noEmit`；dev server 匯入 3581（預測下一交易日），確認款一① 285、款一② 284.5、處置計數（連3/5/10/30）與改前一致（用 5/26 前的狀態比對）。

- [ ] **Step 8: Commit** `git add -A && git commit -m "refactor: DisposalTool 改用 clauseEngine(款一/二/三)，computeTriggers 吃{first,any}"`

---

## Task 4: 款十一（起迄價差）卡片

**Files:** Modify `components/DisposalTool.tsx`

- [ ] **Step 1:** 卡片新增款十一門檻線：`const t11 = clTick(windowMinOf(i)) + gap11(market, dispPrice)`（門檻價 = 窗口最低 + gap(該價)）。在卡片門檻列加一個橘色標籤 `款十一 價差≥{gap11(market,dispPrice)} → 收盤≥{(windowMinOf(i)+gap11(...)).toFixed(2)}`。

- [ ] **Step 2:** fired 已由 `evalCard` 的 `id==='11'` 提供（Task 3 Step 6 配色已含）。

- [ ] **Step 3:** 驗證腳本 `scripts/v-c11.mjs`：對 5/26 窗口（5/19~5/26，base 5/18）四檔算 `當日收盤 − 窗口最低` 比對 gap：

```js
const gap11=(m,p)=>(m==='TPEx'?70:100)+Math.floor(p/(m==='TPEx'?300:500))*(m==='TPEx'?15:25);
// 弘塑3131 5/19~5/26 收盤(窗口6日,含當日5/26): 起點(最低)=close5/19, 當日=close5/26
const data={ '3131':{closes:[2580,/*...*/3115], notice:535}, };
// (執行時用 dailyQuotes 抓 5/19..5/26 收盤; 這裡示意: 價差=max-min, 應=535/110/87.5/92)
```
  實作：抓 3131/3211/6138/4760 在 5/19~5/26 收盤，`價差 = close(5/26) − min(6日收盤)`，期望 535/110/87.5/92，且各 ≥ gap11(該當日收盤)。

- [ ] **Step 4:** 跑腳本 → 四檔價差命中。`npx tsc --noEmit`；dev server 看 3581 卡片出現款十一門檻列。

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: 款十一 起迄價差卡片(gap=70+floor(P/300)×15 上櫃)"`

---

## Task 5: /api/peratio + 款六 下方面板

**Files:** Create `app/api/peratio/route.ts`；Modify `components/DisposalTool.tsx`；Verify `scripts/v-peratio.mjs`

- [ ] **Step 1: 建 `app/api/peratio/route.ts`**（完整）：

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
const num = (s: unknown) => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
// 上櫃：openapi 回最新快照
async function tpex() {
  const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis', { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) return null
  const arr = (await r.json()) as { SecuritiesCompanyCode: string; PriceEarningRatio: string; PriceBookRatio: string }[]
  const map: Record<string, { pe: number | null; pbr: number | null }> = {}
  const pes: number[] = [], pbrs: number[] = []
  for (const x of arr) {
    const pe = num(x.PriceEarningRatio), pbr = num(x.PriceBookRatio)
    map[String(x.SecuritiesCompanyCode).trim()] = { pe, pbr }
    if (pe && pe > 0) pes.push(pe); if (pbr && pbr > 0) pbrs.push(pbr)
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  return { map, mktPe: avg(pes), mktPbr: avg(pbrs) }
}
// 上市：BWIBBU_d 指定日
async function twse(date: string) {
  const r = await fetch(`https://www.twse.com.tw/exchangeReport/BWIBBU_d?response=json&date=${date}&selectType=ALL`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) return null
  const j = (await r.json()) as { data?: string[][] }
  if (!j.data?.length) return null
  const map: Record<string, { pe: number | null; pbr: number | null }> = {}
  const pes: number[] = [], pbrs: number[] = []
  for (const row of j.data) {
    const code = String(row[0]).trim(); const pe = num(row[5]), pbr = num(row[6])
    map[code] = { pe, pbr }
    if (pe && pe > 0) pes.push(pe); if (pbr && pbr > 0) pbrs.push(pbr)
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  return { map, mktPe: avg(pes), mktPbr: avg(pbrs) }
}
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const code = (p.get('code') || '').trim(), market = p.get('market'), date = (p.get('date') || '').replace(/-/g, '')
  const key = `peratio:${market}:${date}`
  const cached = getCached(key)
  const src = cached ?? (market === 'TWSE' ? await twse(date) : await tpex()) as { map: Record<string, { pe: number|null; pbr: number|null }>; mktPe: number|null; mktPbr: number|null } | null
  if (!cached && src) setCached(key, src, 6 * 60 * 60 * 1000)
  if (!src) return NextResponse.json({ pe: null, pbr: null, mktPe: null, mktPbr: null })
  const s = src.map[code] ?? { pe: null, pbr: null }
  return NextResponse.json({ pe: s.pe, pbr: s.pbr, mktPe: src.mktPe, mktPbr: src.mktPbr })
}
```

- [ ] **Step 2: 驗證** `curl -s "http://localhost:3000/api/peratio?market=TPEx&code=3163&date=20260526"` → 回 `pe/pbr` 為數字、`mktPe/mktPbr` 為數字（波若威；值依最新交易日，PE 應為三位數高值）。`curl ...?market=TWSE&code=2330&date=20260526` → pe≈30.x/pbr≈9.x。

- [ ] **Step 3: DisposalTool** 加 state + fetch（匯入時帶 `market`、`todayTD`）：

```ts
const [peData, setPeData] = useState<{ pe: number|null; pbr: number|null; mktPe: number|null; mktPbr: number|null } | null>(null)
const [clause6Assume, setClause6Assume] = useState(false)
// 在 doImport / importFromList 成功後：
fetch(`/api/peratio?market=${json.market}&code=${code}&date=${todayTD.replace(/-/g,'')}`).then(r=>r.json()).then(setPeData).catch(()=>setPeData(null))
// 預測日 PE/PBR 隨價縮放（現 PE/PBR 來自最近收盤）
const lastClose = priceHistory.at(-1)?.value ?? startPrice
const pePredict  = (price: number) => peData?.pe  != null && lastClose > 0 ? peData.pe  * price / lastClose : null
const pbrPredict = (price: number) => peData?.pbr != null && lastClose > 0 ? peData.pbr * price / lastClose : null
```

- [ ] **Step 4: 下方面板**（在款三面板區，新增款六列）：顯示 `evalCard(0, simPrices[0] ?? startPrice)` 的 `id==='6'` result detail；若 `blocked`（PE/PBR達標但未勾假設）顯示橘字「達標→需當日週轉率≥5%或券商集中(資料不足)」+ checkbox `clause6Assume`「假設當日條件達標」。勾選才計入處置（已透過 evalCard 的 c6Assume）。

- [ ] **Step 5: 驗證** `npx tsc --noEmit`；dev server 匯入 3163(波若威)，款六面板顯示 PE/PBR 達標。

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: /api/peratio + 款六(PE/PBR)下方面板(雙市場)"`

---

## Task 6: /api/sbl + 款十二 下方面板

**Files:** Create `app/api/sbl/route.ts`；Modify `components/DisposalTool.tsx`；Verify `scripts/v-sbl.mjs`

- [ ] **Step 1: 建 `app/api/sbl/route.ts`**（完整）— 回該股 6 日借券賣出率 + 60日均放大。需逐日抓借券（上櫃 margin/sbl、上市 TWT93U）+ 成交量（既有 stocks/dailyQuotes）。為簡化：route 接受 `?code=&market=&dates=YYYYMMDD,...`（DisposalTool 傳窗口 6 日 + 供 60 日均的日期），逐日抓借券當日賣出與成交量、回 `{ rate6, amp }`。

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
const num = (s: unknown) => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
const toSlash = (y: string) => `${y.slice(0,4)}/${y.slice(4,6)}/${y.slice(6,8)}`
// 回 { [ymd]: { sblSell, vol } }
async function tpexDay(ymd: string, code: string) {
  const [s, q] = await Promise.all([
    fetch(`https://www.tpex.org.tw/www/zh-tw/margin/sbl?date=${toSlash(ymd)}&response=json`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${toSlash(ymd)}&type=EW&response=json`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.ok ? r.json() : null).catch(() => null),
  ])
  const srow = s?.tables?.[0]?.data?.find((r: string[]) => String(r[0]).trim() === code)
  const qrow = q?.tables?.[0]?.data?.find((r: string[]) => String(r[0]).trim() === code)
  return { sblSell: srow ? num(srow[9]) : null, vol: qrow ? num(qrow[8]) : null }
}
async function twseDay(ymd: string, code: string) {
  const [s, q] = await Promise.all([
    fetch(`https://www.twse.com.tw/exchangeReport/TWT93U?response=json&date=${ymd}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${ymd}&type=ALLBUT0999`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.ok ? r.json() : null).catch(() => null),
  ])
  const srow = s?.data?.find((r: string[]) => String(r[0]).trim() === code)
  const t = q?.tables?.find((x: { title?: string }) => String(x.title ?? '').includes('每日收盤行情'))
  const qrow = t?.data?.find((r: string[]) => String(r[0]).trim() === code)
  return { sblSell: srow ? num(srow[9]) : null, vol: qrow ? num(qrow[2]) : null }   // MI_INDEX row[2]=成交股數
}
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const code = (p.get('code') || '').trim(), market = p.get('market')
  const win = (p.get('win') || '').split(',').filter(Boolean)    // 6日窗口 YYYYMMDD
  const amp = (p.get('amp') || '').split(',').filter(Boolean)    // 供60日均的日期(可較少)
  const key = `sbl:${market}:${code}:${win.join('')}`
  const cached = getCached(key); if (cached) return NextResponse.json({ ...(cached as object), cached: true })
  const dayFn = market === 'TWSE' ? twseDay : tpexDay
  const winData = await Promise.all(win.map(d => dayFn(d, code)))
  const ampData = await Promise.all(amp.map(d => dayFn(d, code)))
  const sumSell = winData.reduce((a, d) => a + (d.sblSell ?? 0), 0)
  const sumVol  = winData.reduce((a, d) => a + (d.vol ?? 0), 0)
  const rate6 = sumVol > 0 ? +(sumSell / sumVol * 100).toFixed(2) : null
  const avgSell = ampData.length ? ampData.reduce((a, d) => a + (d.sblSell ?? 0), 0) / ampData.length : null
  const lastSell = winData.at(-1)?.sblSell ?? null
  const ampVal = avgSell && avgSell > 0 && lastSell != null ? +(lastSell / avgSell).toFixed(2) : null
  const result = { rate: rate6, amp: ampVal }
  setCached(key, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
```

- [ ] **Step 2: 驗證** `scripts/v-sbl.mjs`：直接呼叫端點，上櫃 4128 6 日窗口(5/19~5/26)借券率應 ≈10.39%。Run: `curl -s "http://localhost:3000/api/sbl?market=TPEx&code=4128&win=20260519,20260520,20260521,20260522,20260525,20260526&amp=20260519,20260520,20260521,20260522,20260525,20260526"` → rate ≈ 10.x。

- [ ] **Step 3: DisposalTool** 加 state + fetch（匯入後帶窗口 6 日；amp 用最近 ~60 交易日的日期或同窗口近似）：

```ts
const [sblData, setSblData] = useState<{ rate: number|null; amp: number|null } | null>(null)
const [clause12Assume, setClause12Assume] = useState(false)
// 匯入成功後：win = days.map(d=>d.baseDateStr...) 取窗口 6 日 YYYYMMDD
fetch(`/api/sbl?market=${json.market}&code=${code}&win=${winYMDs.join(',')}&amp=${ampYMDs.join(',')}`).then(r=>r.json()).then(setSblData).catch(()=>setSblData(null))
```

- [ ] **Step 4: 下方面板** 新增款十二列：顯示 `sblData.rate`/`amp` 與門檻；`blocked`（已知達標未勾假設）→ checkbox `clause12Assume`「假設當日借券達標」。勾選計入處置。

- [ ] **Step 5: 驗證** `npx tsc --noEmit`；dev server 匯入 4128 看款十二面板借券率。

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: /api/sbl + 款十二(借券)下方面板(雙市場)"`

---

## Task 7: 款四/五 標「資料不足」

**Files:** Modify `components/DisposalTool.tsx`

- [ ] **Step 1:** 下方面板加兩列灰字：「款四 週轉率：需流通在外股數，無公開批量 API → 無法自動判定」「款五 單一券商買賣占比：券商分點全量無公開 API → 無法自動判定」。不參與 evalClauses。

- [ ] **Step 2:** 驗證 `npx tsc --noEmit`；dev server 看到兩列灰字。

- [ ] **Step 3: Commit** `git add -A && git commit -m "feat: 款四/五 標資料不足(不判定)"`

---

## Task 8: 端對端驗證 + 收尾

**Files:** 驗證 + Modify `docs/PROJECT_NOTES.md`

- [ ] **Step 1:** dev server 匯入 3581(上櫃)：款一① 285 / 款一② 284.5 / 累積 28.39（或預測窗口對應值）；款十一門檻列存在；款六/十二面板顯示資料；處置計數正確。再抽驗一檔上市股（PE/PBR、借券面板有值）。

- [ ] **Step 2:** 刪暫存腳本 `rm -f scripts/v-trunc.mjs scripts/v-engine.mjs scripts/v-c11.mjs scripts/v-sbl.mjs scripts/v-peratio.mjs`。

- [ ] **Step 3: PROJECT_NOTES** §一 更新：列出已實作款（一①②/二/三/六/十一/十二）+ 原子引擎 `lib/clauseEngine.ts` + 各款門檻/端點 + 款四/五資料不足；trunc2 精度修正；款十一 gap 公式。

- [ ] **Step 4: Commit** `git add -A && git commit -m "docs: PROJECT_NOTES 更新 注意款全補齊+原子引擎"`

---

## Self-Review

- **Spec coverage**：原子引擎(T2/T3)✓、款十一(T4)✓、款六(T5)✓、款十二(T6)✓、trunc2(T1)✓、款二純價格移入(T3 橋接 checkClause2)✓、雙市場端點(T5/T6)✓、款四/五標註(T7)✓、market-avg 不擴充✓。
- **Placeholder scan**：端點/欄位/gap 公式皆實測值；款十一 windowMin 用窗口最低(非固定第一天，含非單調)；款六 全體均用簡單平均(已說明絕對門檻 dominate)。
- **Type consistency**：`ClauseInput`/`ClauseResult`/`evalClauses`/`summarize`/`gap11` 跨 Task 一致；`computeTriggers` 介面由 `(0|1|2|3)[]`→`{first,any}[]`（T3 Step 5 同步歷史 prior 轉換）。
- **風險**：(1) peratio 上櫃端點回最新快照、非歷史 → 沙盤用最新即可；驗收值隨日期變動，看公式對不對。(2) /api/sbl 逐日抓多次 fetch、慢 → 已快取；amp(60日均)若只給窗口近似則放大倍數為估計，UI 標註。(3) T3 重構動到處置計數，務必比對改前後 3581 計數一致。
