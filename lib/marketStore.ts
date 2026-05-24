// 全市場每日「漲跌幅(%)」快照儲存層。
// 設計目標：
//  - 本機 (npm run dev)：寫 JSON 到磁碟 .marketdata/，重啟仍在，未來可做回測。
//  - 雲端 (Vercel serverless)：檔案系統唯讀/暫存 → 自動退回「純記憶體」(寫檔失敗即略過)。
//  - 規矩：只保留最近 N 個交易日，超過的快照（記憶體＋磁碟）一律刪除。
//
// 每筆快照 = { [股票代號]: 當日漲跌幅%（相對前一交易日收盤） }。
// 之所以存「漲跌幅」而非股價：累積漲跌 = ∏(1+每日漲跌幅)−1（連乘，非相加），
// 不需要絕對股價即可還原與法規一致的「6 營業日累積最後成交價漲跌%」。

import { promises as fs } from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), '.marketdata')
const mem = new Map<string, Record<string, number>>() // key = `${market}:${date}`
let diskOk: boolean | null = null

const memKey = (market: string, date: string) => `${market}:${date}`
const filePath = (market: string, date: string) => path.join(DIR, `${market}_${date}.json`)

async function ensureDisk(): Promise<boolean> {
  if (diskOk !== null) return diskOk
  try { await fs.mkdir(DIR, { recursive: true }); diskOk = true }
  catch { diskOk = false } // 唯讀檔案系統（如 Vercel）→ 之後只用記憶體
  return diskOk
}

export async function loadSnapshot(market: string, date: string): Promise<Record<string, number> | null> {
  const k = memKey(market, date)
  if (mem.has(k)) return mem.get(k)!
  if (await ensureDisk()) {
    try {
      const raw = await fs.readFile(filePath(market, date), 'utf-8')
      const obj = JSON.parse(raw) as Record<string, number>
      mem.set(k, obj)
      return obj
    } catch { /* 磁碟上沒有 */ }
  }
  return null
}

export async function saveSnapshot(market: string, date: string, data: Record<string, number>): Promise<void> {
  mem.set(memKey(market, date), data)
  if (await ensureDisk()) {
    try { await fs.writeFile(filePath(market, date), JSON.stringify(data)) }
    catch { /* 唯讀 FS：僅留記憶體 */ }
  }
}

/** 只保留 keepDates 內的快照，其餘（記憶體＋磁碟）刪除 → 達成「只存最近 6 個交易日」。 */
export async function pruneExcept(market: string, keepDates: string[]): Promise<void> {
  const keep = new Set(keepDates)
  for (const k of [...mem.keys()]) {
    const [m, d] = k.split(':')
    if (m === market && !keep.has(d)) mem.delete(k)
  }
  if (await ensureDisk()) {
    try {
      const files = await fs.readdir(DIR)
      const prefix = `${market}_`
      for (const f of files) {
        if (!f.startsWith(prefix) || !f.endsWith('.json')) continue
        const d = f.slice(prefix.length, -5)
        if (!keep.has(d)) { try { await fs.unlink(path.join(DIR, f)) } catch { /* 略過 */ } }
      }
    } catch { /* 無磁碟 */ }
  }
}
