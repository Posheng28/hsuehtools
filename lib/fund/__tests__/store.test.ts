import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { saveSnapshot, loadSnapshot, snapshotPath, __resetMem } from '../store'
import type { FundSnapshot } from '../types'

const fund: FundSnapshot = {
  fundId: 'uni-benteng', reportType: 'monthly_top10', period: '2026-04',
  source: 'test', fetchedAt: '2026-04-11T00:00:00Z',
  holdings: [{ code: '2330', name: '台積電', weightPct: 7.24, rank: 5 }],
}
const etf: FundSnapshot = {
  fundId: '00981A', reportType: 'etf_daily', period: '2026-04-30',
  source: 'test', fetchedAt: '2026-04-30T10:00:00Z',
  holdings: [{ code: '2330', name: '台積電', weightPct: 9.11 }],
}

describe('fundStore', () => {
  beforeEach(() => __resetMem())
  afterEach(async () => {
    await fs.rm(path.join(process.cwd(), 'data/funds/uni-benteng'), { recursive: true, force: true })
    await fs.rm(path.join(process.cwd(), '.funddata/etf/00981A'), { recursive: true, force: true })
  })

  it('基金月報存到 data/funds/（committed 區）', () => {
    expect(snapshotPath(fund)).toContain(path.join('data', 'funds', 'uni-benteng'))
  })
  it('ETF 每日存到 .funddata/etf/（gitignore 區）', () => {
    expect(snapshotPath(etf)).toContain(path.join('.funddata', 'etf', '00981A'))
  })
  it('存後可讀回', async () => {
    await saveSnapshot(fund)
    const got = await loadSnapshot('uni-benteng', 'monthly_top10', '2026-04')
    expect(got?.holdings[0].code).toBe('2330')
  })
  it('同鍵重存為覆寫、不重複', async () => {
    await saveSnapshot(fund)
    await saveSnapshot({ ...fund, holdings: [{ code: '3017', name: '奇鋐', weightPct: 9.74, rank: 1 }] })
    const got = await loadSnapshot('uni-benteng', 'monthly_top10', '2026-04')
    expect(got?.holdings).toHaveLength(1)
    expect(got?.holdings[0].code).toBe('3017')
  })
})
