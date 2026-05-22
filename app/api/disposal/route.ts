import { NextRequest, NextResponse } from 'next/server'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

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

/**
 * 從一個 cell 值掃出第一個 ROC 日期（支援獨立格式或「115/05/08~115/05/21」範圍格式）
 * sep = '/' → ROC slash；sep = '.' → ROC dot
 */
function extractFirstDate(raw: string, sep: '/' | '.'): string | null {
  const pattern = sep === '/'
    ? /(\d{3}\/\d{2}\/\d{2})/
    : /(\d{3}\.\d{2}\.\d{2})/
  const m = raw.match(pattern)
  if (!m) return null
  return sep === '/' ? parseROCSlash(m[1]) : parseROCDot(m[1])
}

/**
 * 從一整列中找第一個有日期的 cell，回傳 { startDate, endDate }
 * colStart～colEnd 掃描範圍
 */
function extractDatesFromRow(
  row: string[],
  colStart: number,
  colEnd: number,
  sep: '/' | '.',
): { startDate: string; endDate?: string } | null {
  const dates: string[] = []
  for (let c = colStart; c <= colEnd && c < row.length; c++) {
    const raw = String(row[c] ?? '')
    // 範圍格式「115/05/08~115/05/21」或「115/05/08～115/05/21」
    const rangePattern = sep === '/'
      ? /(\d{3}\/\d{2}\/\d{2})[~～](\d{3}\/\d{2}\/\d{2})/
      : /(\d{3}\.\d{2}\.\d{2})[~～](\d{3}\.\d{2}\.\d{2})/
    const rangeM = raw.match(rangePattern)
    if (rangeM) {
      const s = sep === '/' ? parseROCSlash(rangeM[1]) : parseROCDot(rangeM[1])
      const e = sep === '/' ? parseROCSlash(rangeM[2]) : parseROCDot(rangeM[2])
      return { startDate: s, endDate: e }
    }
    // 單一日期
    const d = extractFirstDate(raw, sep)
    if (d) dates.push(d)
  }
  if (dates.length === 0) return null
  return { startDate: dates[0], endDate: dates.length > 1 ? dates[dates.length - 1] : undefined }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const today = new Date()
  const past  = new Date(today)
  past.setDate(past.getDate() - 90)

  const twseStart = fmt8(past),      twseEnd = fmt8(today)
  const tpexStart = toROCSlash(past), tpexEnd = toROCSlash(today)

  const records: { dateStr: string; endDateStr?: string }[] = []
  const seen = new Set<string>()

  try {
    const [twseRes, tpexRes] = await Promise.allSettled([
      fetch(
        `https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&startDate=${twseStart}&endDate=${twseEnd}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }
      ),
      fetch(
        `https://www.tpex.org.tw/www/zh-tw/bulletin/disposal?startDate=${tpexStart}&endDate=${tpexEnd}&type=code&code=${encodeURIComponent(code)}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }
      ),
    ])

    // ── TWSE ──
    if (twseRes.status === 'fulfilled' && twseRes.value.ok) {
      try {
        const json = await twseRes.value.json()
        if (json.stat === 'OK' && Array.isArray(json.data)) {
          for (const row of json.data as string[][]) {
            // TWSE punish: row[2]=代號, row[3]=名稱, row[6]=處置起迄時間（斜線格式）
            if (String(row[2]).trim() !== code) continue
            const result = extractDatesFromRow(row, 5, 9, '/')
            if (result && !seen.has(result.startDate)) {
              seen.add(result.startDate)
              records.push({ dateStr: result.startDate, endDateStr: result.endDate })
            }
          }
        }
      } catch { /* ignore */ }
    }

    // ── TPEx ──
    if (tpexRes.status === 'fulfilled' && tpexRes.value.ok) {
      try {
        const json = await tpexRes.value.json()
        const data: string[][] = json?.tables?.[0]?.data ?? []
        if (Array.isArray(data)) {
          for (const row of data) {
            // row[0]=序號, row[1]=公布日期, row[2]=代號, row[3]=名稱(含HTML), row[4]=累計, row[5]=處置起訖時間
            if (String(row[2]).trim() !== code) continue
            const result = extractDatesFromRow(row, 4, 9, '/')
            if (result && !seen.has(result.startDate)) {
              seen.add(result.startDate)
              records.push({ dateStr: result.startDate, endDateStr: result.endDate })
            }
          }
        }
      } catch { /* ignore */ }
    }

    records.sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    const latest = records[0] ?? null
    return NextResponse.json({ latest, records })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg, latest: null, records: [] }, { status: 200 })
  }
}
