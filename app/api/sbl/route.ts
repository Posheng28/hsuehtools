import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
const num = (s: unknown) => { const n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? null : n }
const toSlash = (y: string) => `${y.slice(0,4)}/${y.slice(4,6)}/${y.slice(6,8)}`
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
  return { sblSell: srow ? num(srow[9]) : null, vol: qrow ? num(qrow[2]) : null }
}
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams
  const code = (p.get('code') || '').trim(), market = p.get('market')
  const win = (p.get('win') || '').split(',').filter(Boolean)
  const amp = (p.get('amp') || '').split(',').filter(Boolean)
  const key = `sbl:${market}:${code}:${win.join('')}`
  const cached = getCached(key); if (cached) return NextResponse.json({ ...(cached as object), cached: true })
  const dayFn = market === 'TWSE' ? twseDay : tpexDay
  const winData = await Promise.all(win.map(d => dayFn(d, code)))
  const ampData = await Promise.all(amp.map(d => dayFn(d, code)))
  const sumSell = winData.reduce((a, d) => a + (d.sblSell ?? 0), 0)
  const sumVol  = winData.reduce((a, d) => a + (d.vol ?? 0), 0)
  const rate = sumVol > 0 ? +(sumSell / sumVol * 100).toFixed(2) : null
  const avgSell = ampData.length ? ampData.reduce((a, d) => a + (d.sblSell ?? 0), 0) / ampData.length : null
  const lastSell = winData.at(-1)?.sblSell ?? null
  const amplitude = avgSell && avgSell > 0 && lastSell != null ? +(lastSell / avgSell).toFixed(2) : null
  const result = { rate, amp: amplitude }
  setCached(key, result, 6 * 60 * 60 * 1000)
  return NextResponse.json(result)
}
