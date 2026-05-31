import { NextRequest, NextResponse } from 'next/server'
import { classifyNoticeLevel } from '@/lib/disposal/noticeLevel'

function fmt8(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}
function toROCSlash(d: Date): string {
  const ry = d.getFullYear() - 1911
  return `${ry}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}
function parseROCDot(s: string): string {
  const p = s.split('.')
  return `${1911+parseInt(p[0])}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`
}
function parseROCSlash(s: string): string {
  const p = s.split('/')
  return `${1911+parseInt(p[0])}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const today = new Date()
  const past  = new Date(today)
  past.setDate(past.getDate() - 60)

  const twseStart = fmt8(past),    twseEnd = fmt8(today)
  const tpexStart = toROCSlash(past), tpexEnd = toROCSlash(today)

  const records: { dateStr: string; level: 1 | 2 }[] = []
  const seen = new Set<string>()
  let stockName = ''
  const sources: string[] = []

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }

    const [twseRes, tpexRes] = await Promise.allSettled([
      fetch(
        `https://www.twse.com.tw/rwd/zh/announcement/notice?response=json&startDate=${twseStart}&endDate=${twseEnd}`,
        { headers, signal: AbortSignal.timeout(15000) }
      ),
      fetch(
        `https://www.tpex.org.tw/www/zh-tw/bulletin/attention?startDate=${tpexStart}&endDate=${tpexEnd}&type=code&code=${encodeURIComponent(code)}`,
        { headers, signal: AbortSignal.timeout(15000) }
      ),
    ])

    // ── TWSE ──
    if (twseRes.status === 'fulfilled' && twseRes.value.ok) {
      const json = await twseRes.value.json()
      if (json.stat === 'OK' && Array.isArray(json.data)) {
        const prevLen = records.length
        for (const row of json.data) {
          if (String(row[1]).trim() === code) {
            if (!stockName) stockName = String(row[2]).replace(/\*/g, '').trim()
            const dateStr = parseROCDot(String(row[5]))
            const info    = String(row[4] || '')
            const level = classifyNoticeLevel(info)
            // 僅第九款~第十四款（如第十三款當日沖銷）不計入任何處置規則，整筆排除
            if (level === 0) continue
            if (!seen.has(dateStr)) { seen.add(dateStr); records.push({ dateStr, level }) }
          }
        }
        if (records.length > prevLen) sources.push('上市 TWSE')
      }
    }

    // ── TPEx ──
    if (tpexRes.status === 'fulfilled' && tpexRes.value.ok) {
      const json = await tpexRes.value.json()
      const data = json?.tables?.[0]?.data
      if (Array.isArray(data)) {
        const prevLen = records.length
        for (const row of data) {
          if (String(row[1]).trim() === code) {
            if (!stockName) stockName = String(row[2]).replace(/\*/g, '').trim()
            const dateStr = parseROCSlash(String(row[5]))
            const info    = String(row[4] || '')
            const level = classifyNoticeLevel(info)
            // 僅第九款~第十四款（如第十三款當日沖銷）不計入任何處置規則，整筆排除
            if (level === 0) continue
            if (!seen.has(dateStr)) { seen.add(dateStr); records.push({ dateStr, level }) }
          }
        }
        if (records.length > prevLen) sources.push('上櫃 TPEx')
      }
    }

    records.sort((a, b) => a.dateStr.localeCompare(b.dateStr))
    return NextResponse.json({ records, stockName, sources })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
