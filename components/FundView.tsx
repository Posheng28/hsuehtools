'use client'
import { useEffect, useState } from 'react'
import type { FundDef } from '@/lib/fund/types'

interface Holding {
  code: string
  name: string
  weightPct: number
  rank?: number
  amount?: number
  market?: string
}

interface Snapshot {
  fundId: string
  reportType: string
  period: string
  source: string
  fetchedAt: string
  holdings: Holding[]
  meta?: { aum?: number; manager?: string; cashPct?: number; note?: string }
}

export default function FundView() {
  const [funds, setFunds] = useState<FundDef[]>([])
  const [sel, setSel] = useState<string>('uni-benteng')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/fund')
      .then(r => r.json())
      .then(d => {
        setFunds(d.funds ?? [])
        if (d.funds?.length && !d.funds.find((f: FundDef) => f.fundId === 'uni-benteng')) {
          setSel(d.funds[0].fundId)
        }
      })
  }, [])

  useEffect(() => {
    if (!sel) return
    const ac = new AbortController()
    setSnap(null)          // I-fix: clear stale table while switching
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => setSnap(d.monthly ?? d.quarterly ?? null))
      .catch(e => { if (e.name !== 'AbortError') setSnap(null) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [sel])

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto text-sm">
      {/* 基金選擇 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={sel}
          onChange={e => setSel(e.target.value)}
          className="bg-gray-800 text-gray-200 rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-amber-500 text-sm"
        >
          {funds.map(f => (
            <option key={f.fundId} value={f.fundId}>
              {f.fundId}
            </option>
          ))}
        </select>
        {snap && (
          <span className="text-gray-400 text-xs">
            {snap.period}
            {snap.reportType === 'monthly_top10' ? '　月報 Top10' : '　季報全持股'}
            {snap.meta?.manager && <span className="text-gray-500">　經理人：{snap.meta.manager}</span>}
          </span>
        )}
        {loading && <span className="text-gray-500 text-xs">載入中…</span>}
      </div>

      {/* 持股表格 */}
      {snap && snap.holdings.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="tabular-nums w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800 bg-gray-900">
                <th className="px-3 py-2 w-8">#</th>
                <th className="px-3 py-2 w-20">代號</th>
                <th className="px-3 py-2">名稱</th>
                <th className="px-3 py-2 text-right w-20">權重%</th>
              </tr>
            </thead>
            <tbody>
              {snap.holdings.map((h, i) => (
                <tr
                  key={h.code}
                  className="border-t border-gray-800 hover:bg-gray-800 transition-colors"
                >
                  <td className="px-3 py-1.5 text-gray-500">{h.rank ?? i + 1}</td>
                  <td className="px-3 py-1.5 text-amber-300 font-mono">{h.code}</td>
                  <td className="px-3 py-1.5 text-gray-200">{h.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-200">{h.weightPct.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snap && snap.holdings.length === 0 && (
        <div className="text-gray-500 text-sm p-4 text-center">無持股資料</div>
      )}

      {!snap && !loading && funds.length > 0 && (
        <div className="text-gray-500 text-sm p-4 text-center">無資料</div>
      )}
    </div>
  )
}
