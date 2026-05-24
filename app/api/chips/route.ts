import { NextRequest, NextResponse } from 'next/server'
import { loadTicker, saveTicker, TickerChips } from '@/lib/chipsStore'

// 個股「集保戶股權分散表」大戶持股趨勢（內部大戶概念基礎）。
// 資料源：TDCC 個股查詢 qryStock（保留過去 ~1 年週資料）。
//
// 取得機制（已實測）：
//  1. GET qryStock → cookie(session) + SYNCHRONIZER_TOKEN(一次性) + firDate(最新日) + 可查週清單。
//  2. 每週 POST：{token, method=submit, firDate=最新, sqlMethod=StockNo, stockNo, scaDate=該週}；
//     token 一次性 → 從每次 POST「回應頁」抓新 token 給下一週（token 鏈）。
//  3. 解析 17 級距表，取級距 1-15 的「占集保比例%」。
// 大戶定義：≥400 張 = 級距 12-15 佔比和；≥1000 張 = 級距 15 佔比（股價 >50 看 400、<50 看 1000）。
// on-demand：首次查某股才爬全部週並存檔；之後每次只補新出現的週。

const TDCC = 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const reToken = /SYNCHRONIZER_TOKEN" value="([^"]+)"/
const reFir   = /firDate" value="([^"]+)"/

function cookieFromRes(res: Response): string {
  // 取 Set-Cookie 的 name=value 部分
  const arr = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  return arr.map(c => c.split(';')[0]).join('; ')
}

/** 解析 qryStock 回應頁的 15 級距佔比%；查無資料回 null */
function parseTiers(html: string): number[] | null {
  if (html.includes('查無此')) return null
  const tiers = new Array(15).fill(NaN) as number[]
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/,/g, '').trim())
      .filter(Boolean)
    if (cells.length >= 5 && /^\d{1,2}$/.test(cells[0])) {
      const n = parseInt(cells[0])
      if (n >= 1 && n <= 15) {
        const pct = parseFloat(cells[4])
        if (!isNaN(pct)) tiers[n - 1] = pct
      }
    }
  }
  return tiers.some(v => !isNaN(v)) ? tiers : null
}

export async function GET(req: NextRequest) {
  const code = (new URL(req.url).searchParams.get('ticker') || '').trim().toUpperCase()
  if (!/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: '請輸入 4 位數台股代號' }, { status: 400 })
  }

  try {
    // 1) GET：cookie + token + firDate + 可查週清單
    const g = await fetch(TDCC, { headers: { 'User-Agent': UA } })
    if (!g.ok) throw new Error(`TDCC GET ${g.status}`)
    const cookie = cookieFromRes(g)
    const gh = await g.text()
    let token = gh.match(reToken)?.[1] ?? ''
    const firDate = gh.match(reFir)?.[1] ?? ''
    const weeks = [...new Set([...gh.matchAll(/<option value="(20\d{6})"/g)].map(m => m[1]))]
      .sort((a, b) => (a < b ? 1 : -1)) // 由新到舊
    if (!token || !firDate || weeks.length === 0) throw new Error('TDCC 頁面解析失敗')

    // 2) 載入既有快取，只補缺的週
    const store: TickerChips = (await loadTicker(code)) ?? { code, weeks: {} }
    const missing = weeks.filter(w => !store.weeks[w])

    // 3) token 鏈逐週 POST
    for (const sca of missing) {
      const body = new URLSearchParams({
        SYNCHRONIZER_TOKEN: token,
        SYNCHRONIZER_URI: '/portal/zh/smWeb/qryStock',
        method: 'submit', firDate, sqlMethod: 'StockNo',
        stockNo: code, stockName: '', scaDate: sca,
      })
      const r = await fetch(TDCC, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: body.toString(),
      })
      const t = await r.text()
      const tiers = parseTiers(t)
      if (tiers) store.weeks[sca] = tiers
      token = t.match(reToken)?.[1] ?? token // 換下一週的 token
    }

    if (missing.length) await saveTicker(store)

    // 4) 組時間序列（由舊到新）：回傳原始 15 級距佔比%，前端依自訂張數門檻自由加總
    const series = Object.keys(store.weeks)
      .filter(w => weeks.includes(w))
      .sort()
      .map(date => ({ date, tiers: store.weeks[date].map(v => (isNaN(v) ? 0 : +v.toFixed(2))) }))

    return NextResponse.json({
      code, weeks: series.length, fetched: missing.length,
      // 級距 index(0-13) 對應「≥張數」邊界：tier i 起始張數。≥X張 = 從該級距起加總到 tier15。
      tierLots: [0, 1, 5, 10, 15, 20, 30, 40, 50, 100, 200, 400, 600, 800, 1000],
      series,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'TDCC 取得失敗' }, { status: 502 })
  }
}
