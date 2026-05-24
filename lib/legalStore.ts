// 全市場「三大法人持股比重%」per-stock 週資料（DJ 來源），背景漸進爬取後落磁碟。
// 結構：每檔一份 { code, weeks: { [YYYYMMDD]: [foreign%, legal%] } }。
// 另存爬取進度 _progress.json：{ week, done: string[] } 供續爬。

import { promises as fs } from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), '.legaldata')
const mem = new Map<string, Record<string, number[]>>()
let diskOk: boolean | null = null

const fp = (code: string) => path.join(DIR, `${code}.json`)
const progressPath = () => path.join(DIR, '_progress.json')

async function ensureDisk(): Promise<boolean> {
  if (diskOk !== null) return diskOk
  try { await fs.mkdir(DIR, { recursive: true }); diskOk = true } catch { diskOk = false }
  return diskOk
}

export async function loadLegal(code: string): Promise<Record<string, number[]> | null> {
  if (mem.has(code)) return mem.get(code)!
  if (await ensureDisk()) {
    try { const o = JSON.parse(await fs.readFile(fp(code), 'utf-8')); mem.set(code, o); return o } catch { /* none */ }
  }
  return null
}

export async function saveLegal(code: string, weeks: Record<string, number[]>): Promise<void> {
  mem.set(code, weeks)
  if (await ensureDisk()) { try { await fs.writeFile(fp(code), JSON.stringify(weeks)) } catch { /* ro */ } }
}

export async function listLegalCodes(): Promise<string[]> {
  const set = new Set<string>([...mem.keys()])
  if (await ensureDisk()) {
    try { for (const f of await fs.readdir(DIR)) { const m = f.match(/^(\d{4})\.json$/); if (m) set.add(m[1]) } } catch { /* none */ }
  }
  return [...set]
}

export async function loadProgress(): Promise<{ week: string; done: string[] }> {
  if (await ensureDisk()) {
    try { return JSON.parse(await fs.readFile(progressPath(), 'utf-8')) } catch { /* none */ }
  }
  return { week: '', done: [] }
}

export async function saveProgress(p: { week: string; done: string[] }): Promise<void> {
  if (await ensureDisk()) { try { await fs.writeFile(progressPath(), JSON.stringify(p)) } catch { /* ro */ } }
}
