import { promises as fs } from 'fs'
import path from 'path'
import type { FundSnapshot, ReportType } from './types'

const COMMITTED = path.join(process.cwd(), 'data', 'funds')
const ETF_CACHE = path.join(process.cwd(), '.funddata', 'etf')
const mem = new Map<string, FundSnapshot>()
const diskOk = new Map<string, boolean>()

const key = (fundId: string, rt: ReportType, period: string) => `${fundId}|${rt}|${period}`

export function snapshotPath(s: FundSnapshot): string {
  if (s.reportType === 'etf_daily') return path.join(ETF_CACHE, s.fundId, `${s.period}.json`)
  return path.join(COMMITTED, s.fundId, `${s.reportType}_${s.period}.json`)
}

async function ensureDir(dir: string): Promise<boolean> {
  if (diskOk.has(dir)) return diskOk.get(dir)!
  try { await fs.mkdir(dir, { recursive: true }); diskOk.set(dir, true) }
  catch { diskOk.set(dir, false) }
  return diskOk.get(dir)!
}

export async function saveSnapshot(s: FundSnapshot): Promise<void> {
  mem.set(key(s.fundId, s.reportType, s.period), s)
  const file = snapshotPath(s)
  if (await ensureDir(path.dirname(file))) {
    try { await fs.writeFile(file, JSON.stringify(s, null, 0)) }
    catch { /* read-only FS: memory only */ }
  }
}

export async function loadSnapshot(fundId: string, rt: ReportType, period: string): Promise<FundSnapshot | null> {
  const k = key(fundId, rt, period)
  if (mem.has(k)) return mem.get(k)!
  const file = snapshotPath({ fundId, reportType: rt, period } as FundSnapshot)
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const obj = JSON.parse(raw) as FundSnapshot
    mem.set(k, obj)
    return obj
  } catch { return null }
}

export async function listPeriods(fundId: string, rt: ReportType): Promise<string[]> {
  const dir = rt === 'etf_daily' ? path.join(ETF_CACHE, fundId) : path.join(COMMITTED, fundId)
  try {
    const files = await fs.readdir(dir)
    const prefix = rt === 'etf_daily' ? '' : `${rt}_`
    return files.filter(f => f.endsWith('.json') && f.startsWith(prefix))
      .map(f => f.slice(prefix.length, -5)).sort()
  } catch { return [] }
}

export function __resetMem() { mem.clear(); diskOk.clear() }
