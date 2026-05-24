// 個股「集保戶股權分散表」週資料快取（per-ticker）。
// 來源：TDCC 個股查詢（保留過去 ~1 年週資料）。on-demand：首次查某股才爬，存檔後秒回。
// 本機落磁碟 .chipsdata/<code>.json；雲端唯讀 FS 自動退回純記憶體。
// 結構：{ code, weeks: { [YYYYMMDD]: number[] } }，number[] = 15 個級距的「占集保比例%」。

import { promises as fs } from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), '.chipsdata')
const mem = new Map<string, TickerChips>()
let diskOk: boolean | null = null

export interface TickerChips {
  code: string
  weeks: Record<string, number[]> // date → 15 級距佔比%
}

const filePath = (code: string) => path.join(DIR, `${code}.json`)

async function ensureDisk(): Promise<boolean> {
  if (diskOk !== null) return diskOk
  try { await fs.mkdir(DIR, { recursive: true }); diskOk = true }
  catch { diskOk = false }
  return diskOk
}

export async function loadTicker(code: string): Promise<TickerChips | null> {
  if (mem.has(code)) return mem.get(code)!
  if (await ensureDisk()) {
    try {
      const raw = await fs.readFile(filePath(code), 'utf-8')
      const obj = JSON.parse(raw) as TickerChips
      mem.set(code, obj)
      return obj
    } catch { /* 尚無 */ }
  }
  return null
}

export async function saveTicker(data: TickerChips): Promise<void> {
  mem.set(data.code, data)
  if (await ensureDisk()) {
    try { await fs.writeFile(filePath(data.code), JSON.stringify(data)) }
    catch { /* 唯讀 FS：僅記憶體 */ }
  }
}
