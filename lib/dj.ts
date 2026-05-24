// 富邦 e-broker（嘉實 DJ）法人持股明細抓取。伺服器渲染、上市櫃通吃、約 1 年每日。
// 回傳 ADdate(YYYYMMDD) → [外資%, 三大法人%, 外資持股張, 投信持股張, 自營持股張]。
// ⚠️ 投信/自營為 DJ 估算；持股比重以佔已發行計。
// 明細表末欄序：…外資估計持股, 投信估計持股, 自營估計持股, 三大法人合計持股, 外資%, 三大法人%
//   → 倒數：%三大-1、%外資-2、合計-3、自營-4、投信-5、外資-6。

export type LegalRow = [number, number, number, number, number] // [外資%, 三大法人%, 外資張, 投信張, 自營張]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const rocToAD = (s: string) => {
  const [y, m, d] = s.split('/')
  return `${parseInt(y) + 1911}${m.padStart(2, '0')}${d.padStart(2, '0')}`
}

export async function fetchDJLegal(code: string, fromDash: string, toDash: string): Promise<Record<string, LegalRow>> {
  const url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${code}&c=${fromDash}&d=${toDash}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl_${code}.djhtm` } })
  if (!res.ok) throw new Error(`DJ ${res.status}`)
  const html = new TextDecoder('big5').decode(await res.arrayBuffer())
  const map: Record<string, LegalRow> = {}
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/,/g, '').trim())
      .filter(Boolean)
    if (c.length >= 10 && /^\d{2,3}\/\d{2}\/\d{2}$/.test(c[0])) {
      const f = parseFloat(c[c.length - 2]) // 外資%
      const l = parseFloat(c[c.length - 1]) // 三大法人%
      const qfii   = parseFloat(c[c.length - 6]) // 外資持股(張)
      const it     = parseFloat(c[c.length - 5]) // 投信持股(張)
      const dealer = parseFloat(c[c.length - 4]) // 自營持股(張)
      const num = (v: number) => (isNaN(v) ? 0 : v)
      if (!isNaN(l)) map[rocToAD(c[0])] = [num(f), l, num(qfii), num(it), num(dealer)]
    }
  }
  return map
}
