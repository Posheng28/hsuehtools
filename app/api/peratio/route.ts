import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
const num = (s: unknown) => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
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
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
  return { map, mktPe: median(pes), mktPbr: median(pbrs) }
}
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
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
  return { map, mktPe: median(pes), mktPbr: median(pbrs) }
}
type PeSrc = { map: Record<string, { pe: number|null; pbr: number|null }>; mktPe: number|null; mktPbr: number|null }
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const code = (p.get('code') || '').trim(), market = p.get('market'), date = (p.get('date') || '').replace(/-/g, '')
  const key = `peratio:${market}:${date}`
  let src = getCached(key) as PeSrc | null
  if (!src) { src = (market === 'TWSE' ? await twse(date) : await tpex()); if (src) setCached(key, src, 6 * 60 * 60 * 1000) }
  if (!src) return NextResponse.json({ pe: null, pbr: null, mktPe: null, mktPbr: null })
  const s = src.map[code] ?? { pe: null, pbr: null }
  return NextResponse.json({ pe: s.pe, pbr: s.pbr, mktPe: src.mktPe, mktPbr: src.mktPbr })
}
