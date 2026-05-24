// 富邦 e-broker（嘉實 DJ）法人持股明細抓取。伺服器渲染、上市櫃通吃、約 1 年每日。
// 回傳 ADdate(YYYYMMDD) → [外資持股比重%, 三大法人持股比重%]。
// ⚠️ 投信/自營為 DJ 估算；持股比重以佔已發行計。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

const rocToAD = (s: string) => {
  const [y, m, d] = s.split('/')
  return `${parseInt(y) + 1911}${m.padStart(2, '0')}${d.padStart(2, '0')}`
}

export async function fetchDJLegal(code: string, fromDash: string, toDash: string): Promise<Record<string, [number, number]>> {
  const url = `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl.djhtm?a=${code}&c=${fromDash}&d=${toDash}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcl/zcl_${code}.djhtm` } })
  if (!res.ok) throw new Error(`DJ ${res.status}`)
  const html = new TextDecoder('big5').decode(await res.arrayBuffer())
  const map: Record<string, [number, number]> = {}
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(x => x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/,/g, '').trim())
      .filter(Boolean)
    if (c.length >= 10 && /^\d{2,3}\/\d{2}\/\d{2}$/.test(c[0])) {
      const f = parseFloat(c[c.length - 2])
      const l = parseFloat(c[c.length - 1])
      if (!isNaN(l)) map[rocToAD(c[0])] = [isNaN(f) ? 0 : f, l]
    }
  }
  return map
}
