import * as cheerio from 'cheerio'
import type { FundSnapshot, FundHolding } from '../types'

const DATE_RE = /20\d\d[\/.\-]\d{1,2}[\/.\-]\d{1,2}/

export function parseMoneyDJEtf(html: string, fundId: string): FundSnapshot {
  const $ = cheerio.load(html)

  // Locate all rows that contain both td.col05 and td.col06
  const rows = $('tr').filter((_, el) => $(el).find('td.col05').length > 0 && $(el).find('td.col06').length > 0)
  if (rows.length === 0) throw new Error(`MoneyDJ ${fundId}: no holdings rows`)

  const holdings: FundHolding[] = []
  rows.each((_, el) => {
    const $r = $(el)
    const linkText = $r.find('td.col05 a').first().text().trim()
    // Match Taiwan-listed stocks only: e.g. "台積電(2330.TW)"
    const m = linkText.match(/^(.+?)\((\d{4,6}[A-Z]?)\.TW\)\s*$/)
    if (!m) return
    const name = m[1].trim()
    const code = m[2].trim()
    const weightPct = Number($r.find('td.col06').first().text().trim())
    if (Number.isNaN(weightPct)) return
    holdings.push({ code, name, weightPct, rank: holdings.length + 1 })
  })

  if (!holdings.length) throw new Error(`MoneyDJ ${fundId}: zero parsed holdings`)

  // Period: scan whole HTML for the first date in YYYY/MM/DD or YYYY-MM-DD form
  const allText = $.root().text()
  const dm = allText.match(DATE_RE)
  if (!dm) throw new Error(`MoneyDJ ${fundId}: no date found`)
  const period = dm[0].replace(/[\/.]/g, '-') // "2026/05/27" -> "2026-05-27"

  return {
    fundId,
    reportType: 'etf_daily',
    period,
    source: 'moneydj',
    fetchedAt: new Date().toISOString(),
    holdings,
  }
}
