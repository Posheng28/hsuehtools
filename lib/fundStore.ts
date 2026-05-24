// 每日「外資持股比率%」全市場快照（per-date）。供籌碼/大戶逐週扣外資用。
// 一個日期一份 { code: 外資持股% }，跨股票共用、跨重啟可重用（本機磁碟；雲端唯讀退回記憶體）。

import { promises as fs } from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), '.funddata')
const mem = new Map<string, Record<string, number>>()
let diskOk: boolean | null = null

const filePath = (date: string) => path.join(DIR, `qfii_${date}.json`)

async function ensureDisk(): Promise<boolean> {
  if (diskOk !== null) return diskOk
  try { await fs.mkdir(DIR, { recursive: true }); diskOk = true }
  catch { diskOk = false }
  return diskOk
}

export async function loadFund(date: string): Promise<Record<string, number> | null> {
  if (mem.has(date)) return mem.get(date)!
  if (await ensureDisk()) {
    try { const obj = JSON.parse(await fs.readFile(filePath(date), 'utf-8')); mem.set(date, obj); return obj } catch { /* none */ }
  }
  return null
}

export async function saveFund(date: string, map: Record<string, number>): Promise<void> {
  mem.set(date, map)
  if (await ensureDisk()) {
    try { await fs.writeFile(filePath(date), JSON.stringify(map)) } catch { /* read-only */ }
  }
}
