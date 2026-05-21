'use client'

import { useState } from 'react'
import { PeriodSegment, COLORS } from '@/lib/types'

interface Props {
  segments: PeriodSegment[]
  onAdd: (seg: Omit<PeriodSegment, 'data' | 'loading'>) => void
  onRemove: (id: string) => void
  onToggleVisible: (id: string) => void
  onColorChange: (id: string, color: string) => void
  onClose?: () => void
}

export default function PeriodPanel({ segments, onAdd, onRemove, onToggleVisible, onColorChange, onClose }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [ticker, setTicker]   = useState('')
  const [label, setLabel]     = useState('')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [error, setError]     = useState<string | null>(null)

  const nextColor = () => COLORS[segments.length % COLORS.length]

  const handleAdd = () => {
    const t = ticker.trim().toUpperCase()
    if (!t)   { setError('請輸入代碼'); return }
    if (!from) { setError('請選擇開始日期'); return }
    if (!to)   { setError('請選擇結束日期'); return }
    if (from >= to) { setError('結束日期必須晚於開始日期'); return }
    setError(null)
    const id = `period_${t}_${from}_${Date.now()}`
    onAdd({ id, ticker: t, label: label.trim() || `${t} ${from}～${to}`, from, to, color: nextColor(), visible: true })
    setTicker('')
    setLabel('')
    setFrom('')
    setTo('')
  }

  const formContent = (
    <div className="px-4 py-4 space-y-3">
      <div>
        <p className="text-xs text-gray-500 mb-1">代碼</p>
        <input type="text" placeholder="TSM、AAPL、2330…" value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">名稱（選填）</p>
        <input type="text" placeholder="例：TSM 2018年" value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-xs text-gray-500 mb-1">開始</p>
          <input type="date" value={from} max={today}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-gray-800 text-gray-200 text-xs rounded-lg px-2 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-gray-500 mb-1">結束</p>
          <input type="date" value={to} max={today}
            onChange={(e) => setTo(e.target.value)}
            className="w-full bg-gray-800 text-gray-200 text-xs rounded-lg px-2 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={handleAdd}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg py-2 transition-colors">
        新增時段
      </button>

      {/* Quick presets */}
      <div>
        <p className="text-xs text-gray-600 mb-1.5">快速選取</p>
        <div className="flex flex-wrap gap-1">
          {[
            { label: '2020 熔斷', from: '2020-01-01', to: '2020-04-30' },
            { label: '2022 熊市', from: '2022-01-01', to: '2022-12-31' },
            { label: '2008 金融海嘯', from: '2008-01-01', to: '2009-03-31' },
            { label: '2018 Q4', from: '2018-10-01', to: '2018-12-31' },
            { label: '今年', from: `${new Date().getFullYear()}-01-01`, to: today },
          ].map((p) => (
            <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to) }}
              className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors border border-gray-700">
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const listContent = (
    <div className="px-3 pb-4">
      {segments.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-8">新增時段後會顯示在這裡</p>
      ) : (
        <div className="flex flex-col gap-2">
          {segments.map((s) => (
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <input type="color" value={s.color} onChange={(e) => onColorChange(s.id, e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug break-words ${s.visible === false ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                    {s.label}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5 font-mono">{s.from} ～ {s.to}</p>
                  {s.loading && <p className="text-xs text-gray-500 mt-0.5">載入中…</p>}
                  {s.error   && <p className="text-xs text-red-400 mt-0.5 break-words">{s.error}</p>}
                  {!s.loading && !s.error && s.data.length > 0 && (
                    <p className="text-xs text-gray-600 mt-0.5">{s.data.length} 個交易日</p>
                  )}
                </div>
                <button onClick={() => onToggleVisible(s.id)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-200 text-xs transition-colors">
                  {s.visible === false ? '🙈' : '👁'}
                </button>
                <button onClick={() => onRemove(s.id)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors text-lg leading-none">
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <aside className="flex shrink-0 h-screen border-r border-gray-800">

      {/* Mobile: single column */}
      <div className="flex lg:hidden w-[85vw] max-w-sm bg-gray-900 flex-col">
        <div className="flex items-center border-b border-gray-800 shrink-0 px-4 py-3 justify-between">
          <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">新增時段</p>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {formContent}
          {segments.length > 0 && (
            <>
              <div className="border-t border-gray-800 px-4 py-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">已加入 {segments.length}</p>
              </div>
              {listContent}
            </>
          )}
        </div>
      </div>

      {/* Desktop: two columns */}
      <div className="hidden lg:flex">
        <div className="w-64 bg-gray-900 flex flex-col overflow-y-auto border-r border-gray-800">
          <div className="px-4 pt-4 pb-2 shrink-0">
            <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">新增時段</p>
            <p className="text-xs text-gray-600 mt-0.5">輸入代碼與時間區間，起點對齊比較走勢</p>
          </div>
          {formContent}
        </div>
        <div className="w-56 bg-gray-950 flex flex-col overflow-y-auto">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
            <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">已加入時段</p>
            {segments.length > 0 && <span className="text-xs text-gray-600">{segments.length}</span>}
          </div>
          {listContent}
        </div>
      </div>

    </aside>
  )
}
