import { NextRequest, NextResponse } from 'next/server'
import { fetchDJLegal } from '@/lib/dj'
import { saveLegal, loadProgress, saveProgress } from '@/lib/legalStore'

// 背景漸進爬蟲：逐檔抓 DJ 三大法人持股(近 ~10 週)，存 legalStore，供篩選器算內部大戶。
// 每次呼叫處理 n 檔（預設 25），禮貌延遲，續爬（progress 紀錄已完成代號）。
// 反覆呼叫直到 remaining=0；每週 opendata 換週時自動重置續爬。

const OPENDATA = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const dash = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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
  const n = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('n') || '25'), 1), 80)
  try {
    const { week, codes } = await getCodes()
    let prog = await loadProgress()
    if (prog.week !== week) prog = { week, done: [] }
    const doneSet = new Set(prog.done)
    const todo = codes.filter(c => !doneSet.has(c)).slice(0, n)

    const to = new Date()
    const from = new Date(); from.setDate(from.getDate() - 75) // 近 ~10 週
    let ok = 0, fail = 0
    for (const code of todo) {
      try {
        const map = await fetchDJLegal(code, dash(from), dash(to))
        if (Object.keys(map).length) { await saveLegal(code, map); ok++ } else fail++
      } catch { fail++ }
      prog.done.push(code)
      await sleep(300) // 禮貌延遲
    }
    await saveProgress(prog)

    const remaining = codes.length - prog.done.length
    return NextResponse.json({ week, total: codes.length, done: prog.done.length, remaining, justCrawled: todo.length, ok, fail })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '爬取失敗' }, { status: 502 })
  }
}
