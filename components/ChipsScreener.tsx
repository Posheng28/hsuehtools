'use client'

import { useEffect, useState, useCallback } from 'react'

// 全市場大戶佔比排行（籌碼篩選器）。資料來自 /api/chips-rank（TDCC opendata 最新週）。
// 近1週增減需累積 ≥2 週快照才會出現（accumulate-forward）；2/3 週增減隨週數長出。

interface Row { code: string; pct: number; d1: number | null }
interface Resp { date: string; prevDate: string | null; lots: number; total: number; hasDelta: boolean; rows: Row[] }

export default function ChipsScreener() {
  const [lots, setLots] = useState<400 | 1000>(400)
  const [sort, setSort] = useState<'level' | 'd1'>('level')
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/chips-rank?lots=${lots}&sort=${sort}&limit=100`)
      const j = await r.json()
      if (j.error) setError(j.error)
      else setData(j)
    } catch { setError('排行取得失敗') }
    finally { setLoading(false) }
  }, [lots, sort])

  useEffect(() => { load() }, [load])

  const fmtDate = (d?: string | null) => d ? `${d.slice(4, 6)}/${d.slice(6)}` : '—'

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="text-gray-300 font-semibold">全市場大戶佔比排行</span>
        {data && <span className="text-gray-500">資料週 {fmtDate(data.date)}　共 {data.total} 檔</span>}
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          {([400, 1000] as const).map(l => (
            <button key={l} onClick={() => setLots(l)}
              className={`px-3 py-1 transition-colors ${lots === l ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
              ≥{l}張
            </button>
          ))}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button onClick={() => setSort('level')}
            className={`px-3 py-1 transition-colors ${sort === 'level' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>大戶佔比</button>
          <button onClick={() => setSort('d1')} disabled={!data?.hasDelta}
            className={`px-3 py-1 transition-colors disabled:opacity-40 ${sort === 'd1' ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>近1週增減</button>
        </div>
        {loading && <span className="text-gray-400 animate-pulse">載入中…</span>}
        {error && <span className="text-red-400">{error}</span>}
      </div>

      {data && !data.hasDelta && (
        <p className="text-xs text-amber-400/80">※ 近1週增減需累積 ≥2 週快照才會出現（目前僅 {fmtDate(data.date)} 一週；下週起自動長出）。先以「大戶佔比」排行。</p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-900 text-gray-400 text-xs">
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 px-2 font-normal">#</th>
              <th className="text-left py-2 px-2 font-normal">代號</th>
              <th className="text-right py-2 px-2 font-normal">大戶佔比 (≥{lots}張)</th>
              <th className="text-right py-2 px-2 font-normal">近1週增減</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r, i) => (
              <tr key={r.code} className="border-b border-gray-800/50 hover:bg-gray-800/40">
                <td className="py-1.5 px-2 text-gray-500">{i + 1}</td>
                <td className="py-1.5 px-2 text-gray-200 font-semibold">{r.code}</td>
                <td className="py-1.5 px-2 text-right text-amber-300 font-mono">{r.pct.toFixed(2)}%</td>
                <td className="py-1.5 px-2 text-right font-mono"
                  style={{ color: r.d1 == null ? '#6b7280' : r.d1 > 0 ? '#f87171' : r.d1 < 0 ? '#4ade80' : '#9ca3af' }}>
                  {r.d1 == null ? '—' : `${r.d1 > 0 ? '+' : ''}${r.d1.toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
