// 全市場「大戶佔比」每週快照（供籌碼篩選器排行 + 近N週增減）。
// 一週一份 { [code]: [pct400, pct1000] }。本機落磁碟 .rankdata/，雲端唯讀退回記憶體。

import { promises as fs } from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), '.rankdata')
const mem = new Map<string, Record<string, [number, number]>>()
let diskOk: boolean | null = null

const filePath = (date: string) => path.join(DIR, `rank_${date}.json`)

async function ensureDisk(): Promise<boolean> {
  if (diskOk !== null) return diskOk
  try { await fs.mkdir(DIR, { recursive: true }); diskOk = true } catch { diskOk = false }
  return diskOk
}

export async function loadRankWeek(date: string): Promise<Record<string, [number, number]> | null> {
  if (mem.has(date)) return mem.get(date)!
  if (await ensureDisk()) {
    try { const o = JSON.parse(await fs.readFile(filePath(date), 'utf-8')); mem.set(date, o); return o } catch { /* none */ }
  }
  return null
}

export async function saveRankWeek(date: string, map: Record<string, [number, number]>): Promise<void> {
  mem.set(date, map)
  if (await ensureDisk()) {
    try { await fs.writeFile(filePath(date), JSON.stringify(map)) } catch { /* read-only */ }
  }
}

export async function listRankDates(): Promise<string[]> {
  const set = new Set<string>([...mem.keys()])
  if (await ensureDisk()) {
    try {
      for (const f of await fs.readdir(DIR)) {
        const m = f.match(/^rank_(\d{8})\.json$/)
        if (m) set.add(m[1])
      }
    } catch { /* none */ }
  }
  return [...set].sort()
}
