import { NextRequest, NextResponse } from 'next/server'
import { fetchDJLegal } from '@/lib/dj'
import { saveLegal, loadLegal, loadProgress, saveProgress } from '@/lib/legalStore'

// 背景漸進爬蟲：逐檔抓 DJ 三大法人持股(近 ~10 週)，存 legalStore，供篩選器算內部大戶。
// 每次呼叫處理 n 檔（預設 25），禮貌延遲，續爬（progress 紀錄已完成代號）。
// 反覆呼叫直到 remaining=0；每週 opendata 換週時自動重置續爬。

const OPENDATA = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
const KEEP_WEEKS = 52
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const dash = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const weekKey = (ymd: string) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / (7 * 86400000))

// DJ 每日資料 → 每週一點（取該週最後一日），只留最新 KEEP_WEEKS 週（滾動，最舊自動丟）
function weekly(daily: Record<string, number[]>): Record<string, number[]> {
  const byWeek = new Map<number, { date: string; v: number[] }>()
  for (const [d, v] of Object.entries(daily)) {
    const wk = weekKey(d)
    const cur = byWeek.get(wk)
    if (!cur || d > cur.date) byWeek.set(wk, { date: d, v })
  }
  const last = [...byWeek.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-KEEP_WEEKS)
  const out: Record<string, number[]> = {}
  for (const e of last) out[e.date] = e.v
  return out
}

// 全市場代號 + 最新週（快取 6h）
let codeCache: { at: number; week: string; codes: string[] } | null = null
async function getCodes(): Promise<{ week: string; codes: string[] }> {
  if (codeCache && Date.now() - codeCache.at < 6 * 60 * 60 * 1000) return codeCache
  const res = await fetch(OPENDATA, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`opendata ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n')
  const set = new Set<string>()
  let week = ''
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',')
    if (c.length < 2) continue
    week = c[0].trim()
    const code = c[1].trim()
    if (/^[1-9]\d{3}$/.test(code)) set.add(code)
  }
  codeCache = { at: Date.now(), week, codes: [...set].sort() }
  return codeCache
}

export async function GET(req: NextRequest) {
  const n = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('n') || '25'), 0), 80) // n=0 → 只回進度
  try {
    const { week, codes } = await getCodes()
    let prog = await loadProgress()
    if (prog.week !== week) prog = { week, done: [] }
    const doneSet = new Set(prog.done)
    const todo = codes.filter(c => !doneSet.has(c)).slice(0, n)

    const to = new Date()
    let ok = 0, fail = 0, skip = 0
    for (const code of todo) {
      const existing = await loadLegal(code) ?? {}
      // 去重：已含本週（opendata 週）就不重抓
      if (Object.keys(existing).some(d => d >= week)) { prog.done.push(code); skip++; continue }
      // 已有舊資料 → 只抓近 3 週（維護）；全新 → 抓滿 ~52 週（種子）
      const seed = Object.keys(existing).length === 0
      const from = new Date(); from.setDate(from.getDate() - (seed ? 7 * (KEEP_WEEKS + 2) : 21))
      try {
        const daily = await fetchDJLegal(code, dash(from), dash(to))
        const merged = { ...existing, ...weekly(daily) }                 // 合併進既有
        const kept = Object.keys(merged).sort().slice(-KEEP_WEEKS)        // 滾動保留最新 52 週
        const out: Record<string, number[]> = {}
        for (const d of kept) out[d] = merged[d]
        if (Object.keys(out).length) { await saveLegal(code, out); ok++ } else fail++
      } catch { fail++ }
      prog.done.push(code)
      await sleep(300) // 禮貌延遲（僅實際抓取時）
    }
    await saveProgress(prog)

    const remaining = codes.length - prog.done.length
    return NextResponse.json({ week, total: codes.length, done: prog.done.length, remaining, justCrawled: todo.length, ok, fail, skip })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '爬取失敗' }, { status: 502 })
  }
}
