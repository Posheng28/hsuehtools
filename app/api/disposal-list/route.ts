import { NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

function fmt8(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
}
function toROCSlash(d: Date): string {
  return `${d.getFullYear()-1911}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}
function parseROCDot(s: string): string {
  const p = s.split('.')
  return `${1911+parseInt(p[0])}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`
}
function parseROCSlash(s: string): string {
  const p = s.split('/')
  return `${1911+parseInt(p[0])}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`
}

/** 從單一 cell 掃出日期範圍 */
function extractDates(raw: string, sep: '/' | '.'): { startDate: string; endDate?: string } | null {
  const rangeRE = sep === '/'
    ? /(\d{3}\/\d{2}\/\d{2})[~～](\d{3}\/\d{2}\/\d{2})/
    : /(\d{3}\.\d{2}\.\d{2})[~～](\d{3}\.\d{2}\.\d{2})/
  const singleRE = sep === '/'
    ? /(\d{3}\/\d{2}\/\d{2})/
    : /(\d{3}\.\d{2}\.\d{2})/
  const parse = sep === '/' ? parseROCSlash : parseROCDot

  const rm = raw.match(rangeRE)
  if (rm) return { startDate: parse(rm[1]), endDate: parse(rm[2]) }
  const sm = raw.match(singleRE)
  if (sm) return { startDate: parse(sm[1]) }
  return null
}

/** 掃一整列找第一組日期 */
function extractDatesFromRow(
  row: string[], colStart: number, colEnd: number, sep: '/' | '.',
): { startDate: string; endDate?: string } | null {
  for (let c = colStart; c <= colEnd && c < row.length; c++) {
    const result = extractDates(String(row[c] ?? ''), sep)
    if (result) return result
  }
  return null
}

export interface DisposalRecord {
  code:      string
  name:      string
  startDate: string
  endDate?:  string
  source:    'TWSE' | 'TPEx'
}

const CACHE_KEY = 'disposal-list:all'

export async function GET() {
  const hit = getCached(CACHE_KEY)
  if (hit) return NextResponse.json({ records: hit, cached: true })

  const today = new Date()
  const past  = new Date(today); past.setDate(past.getDate() - 90)

  const twseStart = fmt8(past),      twseEnd = fmt8(today)
  const tpexStart = toROCSlash(past), tpexEnd = toROCSlash(today)

  const records: DisposalRecord[] = []
  const seen = new Set<string>()

  try {
    const [twseRes, tpexRes] = await Promise.allSettled([
      fetch(
        `https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&startDate=${twseStart}&endDate=${twseEnd}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }
      ),
      fetch(
        `https://www.tpex.org.tw/www/zh-tw/bulletin/disposal?startDate=${tpexStart}&endDate=${tpexEnd}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }
      ),
    ])

    // ── TWSE ─────────────────────────────────────────────────────────────────
    if (twseRes.status === 'fulfilled' && twseRes.value.ok) {
      try {
        const json = await twseRes.value.json()
        if (json.stat === 'OK' && Array.isArray(json.data)) {
          for (const row of json.data as string[][]) {
            // TWSE punish: row[2]=代號, row[3]=名稱, row[6]=處置起迄時間（斜線格式）
            const code = String(row[2] ?? '').trim()
            const name = String(row[3] ?? '').replace(/\(.*?\)/g, '').replace(/\*/g, '').trim()
            if (!code) continue
            const result = extractDatesFromRow(row, 5, 9, '/')
            if (!result) continue
            const key = `TWSE:${code}:${result.startDate}`
            if (!seen.has(key)) {
              seen.add(key)
              records.push({ code, name, startDate: result.startDate, endDate: result.endDate, source: 'TWSE' })
            }
          }
        }
      } catch { /* ignore */ }
    }

    // ── TPEx ─────────────────────────────────────────────────────────────────
    if (tpexRes.status === 'fulfilled' && tpexRes.value.ok) {
      try {
        const json = await tpexRes.value.json()
        const data: string[][] = json?.tables?.[0]?.data ?? []
        if (Array.isArray(data)) {
          for (const row of data) {
            // row[0]=序號, row[1]=公布日期, row[2]=代號, row[3]=名稱(含HTML連結), row[5]=處置起訖時間
            const code = String(row[2] ?? '').trim()
            // Strip embedded HTML links from name: "博磊(../../...)" → "博磊"
            const name = String(row[3] ?? '').replace(/\(.*?\)/g, '').replace(/\*/g, '').trim()
            if (!code) continue
            const result = extractDatesFromRow(row, 4, 9, '/')
            if (!result) continue
            const key = `TPEx:${code}:${result.startDate}`
            if (!seen.has(key)) {
              seen.add(key)
              records.push({ code, name, startDate: result.startDate, endDate: result.endDate, source: 'TPEx' })
            }
          }
        }
      } catch { /* ignore */ }
    }

    records.sort((a, b) => b.startDate.localeCompare(a.startDate))
    setCached(CACHE_KEY, records, 10 * 60 * 1000)
    return NextResponse.json({ records })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg, records: [] }, { status: 200 })
  }
}
