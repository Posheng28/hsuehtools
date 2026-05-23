'use client'

import { useState, useEffect } from 'react'
import { PeriodSegment, COLORS } from '@/lib/types'

interface Props {
  segments: PeriodSegment[]
  onAdd: (seg: Omit<PeriodSegment, 'data' | 'loading'>) => void
  onRemove: (id: string) => void
  onToggleVisible: (id: string) => void
  onColorChange: (id: string, color: string) => void
  onUpdate: (id: string, patch: Partial<Omit<PeriodSegment, 'data' | 'loading' | 'error'>>) => void
  onClose?: () => void
}

/* ── 歷史紀錄（localStorage 持久化，重整/重開瀏覽器仍保留）── */
interface HistoryItem { ticker: string; label: string; from: string; to: string }
const HISTORY_KEY = 'period_history_v1'
const MAX_HISTORY = 15
const histKey = (h: { ticker: string; from: string; to: string }) => `${h.ticker}|${h.from}|${h.to}`

export default function PeriodPanel({ segments, onAdd, onRemove, onToggleVisible, onColorChange, onUpdate, onClose }: Props) {
  const today = new Date().toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()
  const [ticker, setTicker]   = useState('')
  const [label, setLabel]     = useState('')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [showYears, setShowYears] = useState(false)   // 年份選單預設收合

  // 歷史紀錄：初始從 localStorage 載入（SSR 時為空）
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === 'undefined') return []
    try { const raw = localStorage.getItem(HISTORY_KEY); return raw ? JSON.parse(raw) as HistoryItem[] : [] }
    catch { return [] }
  })
  // 任何變動即寫回 localStorage
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch { /* 隱私模式等可能失敗，忽略 */ }
  }, [history])

  const pushHistory = (item: HistoryItem) => {
    setHistory(prev => {
      const k = histKey(item)
      const deduped = prev.filter(h => histKey(h) !== k)   // 相同時段移到最新
      const next = [...deduped, item]
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
    })
  }
  const removeHistory = (k: string) => setHistory(prev => prev.filter(h => histKey(h) !== k))
  const applyHistory  = (h: HistoryItem) => { setTicker(h.ticker); setLabel(h.label); setFrom(h.from); setTo(h.to); setError(null) }
  const applyYear     = (y: number) => { setFrom(`${y}-01-01`); setTo(y === currentYear ? today : `${y}-12-31`); setError(null) }
  const years = Array.from({ length: 12 }, (_, i) => currentYear - i)

  const nextColor = () => COLORS[segments.length % COLORS.length]

  // ── 卡片行內編輯 / 複製 ──
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ ticker: '', label: '', from: '', to: '' })
  const [editErr, setEditErr] = useState<string | null>(null)

  const startEdit = (s: { ticker: string; label: string; from: string; to: string }, id: string) => {
    setDraft({ ticker: s.ticker, label: s.label, from: s.from, to: s.to })  // 預填現有值，不清空
    setEditErr(null)
    setEditingId(id)
  }
  const cancelEdit = () => { setEditingId(null); setEditErr(null) }

  const saveEdit = (id: string) => {
    const t = draft.ticker.trim().toUpperCase()
    if (!t)                    { setEditErr('請輸入代碼'); return }
    if (!draft.from)           { setEditErr('請選擇開始日期'); return }
    if (!draft.to)             { setEditErr('請選擇結束日期'); return }
    if (draft.from >= draft.to){ setEditErr('結束日期必須晚於開始日期'); return }
    const finalLabel = draft.label.trim() || `${t} ${draft.from}～${draft.to}`
    onUpdate(id, { ticker: t, label: finalLabel, from: draft.from, to: draft.to })
    pushHistory({ ticker: t, label: draft.label.trim(), from: draft.from, to: draft.to })
    setEditingId(null)
    setEditErr(null)
  }

  // 複製：沿用同標的/名稱/時間，產生新卡，並立刻進入編輯（游標預填，方便只改時間或標的）
  const handleDuplicate = (s: PeriodSegment) => {
    const id = `period_${s.ticker}_${s.from}_${Date.now()}`
    onAdd({ id, ticker: s.ticker, label: s.label, from: s.from, to: s.to, color: nextColor(), visible: true })
    startEdit(s, id)
  }

  const handleAdd = () => {
    const t = ticker.trim().toUpperCase()
    if (!t)   { setError('請輸入代碼'); return }
    if (!from) { setError('請選擇開始日期'); return }
    if (!to)   { setError('請選擇結束日期'); return }
    if (from >= to) { setError('結束日期必須晚於開始日期'); return }
    setError(null)
    const finalLabel = label.trim() || `${t} ${from}～${to}`
    const id = `period_${t}_${from}_${Date.now()}`
    onAdd({ id, ticker: t, label: finalLabel, from, to, color: nextColor(), visible: true })
    pushHistory({ ticker: t, label: label.trim(), from, to })
    setTicker('')
    setLabel('')
    setFrom('')
    setTo('')
  }

  const formContent = (
    <div className="px-4 py-4 space-y-3">
      <div>
        <p className="text-sm text-gray-300 font-semibold mb-1">代碼</p>
        <input type="text" placeholder="TSM、AAPL、2330…" value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
      </div>
      <div>
        <p className="text-sm text-gray-300 font-semibold mb-1">名稱（選填）</p>
        <input type="text" placeholder="例：TSM 2018年" value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-sm text-gray-300 font-semibold mb-1">開始</p>
          <input type="date" value={from} max={today}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-2 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-300 font-semibold mb-1">結束</p>
          <input type="date" value={to} max={today}
            onChange={(e) => setTo(e.target.value)}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-2 py-2 border border-gray-700 focus:outline-none focus:border-blue-500" />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={handleAdd}
        className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg py-2 transition-colors">
        新增時段
      </button>

      {/* 第一類：年份快選（可展開） */}
      <div>
        {(() => {
          const activeYear = years.find(y => from === `${y}-01-01` && to === (y === currentYear ? today : `${y}-12-31`))
          return (
            <button onClick={() => setShowYears(v => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-gray-300 hover:text-white transition-colors">
              <span>📅 選擇年份{activeYear ? `：${activeYear === currentYear ? `${activeYear} 今年至今` : activeYear}` : ''}</span>
              <span className={`transition-transform ${showYears ? 'rotate-180' : ''}`}>▾</span>
            </button>
          )
        })()}
        {showYears && (
          <div className="flex flex-wrap gap-1 mt-2">
            {years.map((y) => {
              const active = from === `${y}-01-01` && to === (y === currentYear ? today : `${y}-12-31`)
              return (
                <button key={y} onClick={() => { applyYear(y); setShowYears(false) }}
                  className={`text-sm px-2 py-1 rounded border transition-colors ${
                    active
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border-gray-700'
                  }`}>
                  {y === currentYear ? `${y} 今年至今` : y}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 第二類：歷史紀錄（localStorage 持久化） */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-sm font-semibold text-gray-300">🕘 歷史紀錄</p>
          {history.length > 0 && <span className="text-xs text-gray-400">{history.length}/{MAX_HISTORY}</span>}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">新增時段後會記錄在這（重整網頁仍保留）</p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...history].reverse().map((h) => {
              const k = histKey(h)
              return (
                <div key={k} className="flex items-center gap-1 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                  <button onClick={() => applyHistory(h)} title="套用此時段"
                    className="flex-1 min-w-0 text-left px-2 py-1.5 hover:bg-gray-700/50 transition-colors">
                    <span className="text-sm text-gray-200 font-semibold">{h.ticker}</span>
                    {h.label && <span className="text-xs text-gray-400 ml-1 truncate">{h.label}</span>}
                    <span className="block text-xs text-gray-500 font-mono mt-0.5">{h.from} ～ {h.to}</span>
                  </button>
                  <button onClick={() => removeHistory(k)} title="刪除此紀錄"
                    className="shrink-0 self-start w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-900/30 text-base leading-none transition-colors">
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  const listContent = (
    <div className="px-3 pb-4">
      {segments.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">新增時段後會顯示在這裡</p>
      ) : (
        <div className="flex flex-col gap-2">
          {segments.map((s) => editingId === s.id ? (
            /* ── 編輯模式（預填現有值）── */
            <div key={s.id} className="bg-gray-900 border border-blue-600/60 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input type="color" value={s.color} onChange={(e) => onColorChange(s.id, e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0" />
                <input type="text" autoFocus placeholder="代碼" value={draft.ticker}
                  onChange={(e) => setDraft((d) => ({ ...d, ticker: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(s.id); if (e.key === 'Escape') cancelEdit() }}
                  className="flex-1 min-w-0 bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500" />
              </div>
              <input type="text" placeholder="名稱（選填）" value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(s.id); if (e.key === 'Escape') cancelEdit() }}
                className="w-full bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500" />
              <div className="flex gap-2">
                <input type="date" value={draft.from} max={today}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="flex-1 min-w-0 bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500" />
                <input type="date" value={draft.to} max={today}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="flex-1 min-w-0 bg-gray-800 text-gray-200 text-sm rounded px-2 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500" />
              </div>
              {editErr && <p className="text-sm text-red-400">{editErr}</p>}
              <div className="flex gap-2">
                <button onClick={() => saveEdit(s.id)}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded py-1.5 transition-colors">完成</button>
                <button onClick={cancelEdit}
                  className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded py-1.5 transition-colors">取消</button>
              </div>
            </div>
          ) : (
            /* ── 顯示模式 ── */
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <input type="color" value={s.color} onChange={(e) => onColorChange(s.id, e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug break-words ${s.visible === false ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                    {s.label}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5 font-mono">{s.from} ～ {s.to}</p>
                  {s.loading && <p className="text-sm text-gray-500 mt-0.5">載入中…</p>}
                  {s.error   && <p className="text-sm text-red-400 mt-0.5 break-words">{s.error}</p>}
                  {!s.loading && !s.error && s.data.length > 0 && (
                    <p className="text-sm text-gray-600 mt-0.5">{s.data.length} 個交易日</p>
                  )}
                </div>
                <button onClick={() => startEdit(s, s.id)} title="編輯（標的／名稱／時間）"
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-blue-400 text-sm transition-colors">
                  ✎
                </button>
                <button onClick={() => handleDuplicate(s)} title="複製此卡片並編輯"
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-green-400 text-sm transition-colors">
                  ⧉
                </button>
                <button onClick={() => onToggleVisible(s.id)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-200 text-sm transition-colors">
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
          <p className="text-sm font-bold text-gray-100 uppercase tracking-wider">新增時段</p>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {formContent}
          {segments.length > 0 && (
            <>
              <div className="border-t border-gray-800 px-4 py-2">
                <p className="text-sm font-semibold text-gray-300 uppercase tracking-wider">已加入 {segments.length}</p>
              </div>
              {listContent}
            </>
          )}
        </div>
      </div>

      {/* Desktop: two columns */}
      <div className="hidden lg:flex">
        <div className="w-72 bg-gray-900 flex flex-col overflow-y-auto border-r border-gray-800">
          <div className="px-4 pt-4 pb-2 shrink-0">
            <p className="text-sm font-bold text-gray-100 uppercase tracking-wider">新增時段</p>
            <p className="text-sm text-gray-400 mt-0.5">輸入代碼與時間區間，起點對齊比較走勢</p>
          </div>
          {formContent}
        </div>
        <div className="w-64 bg-gray-950 flex flex-col overflow-y-auto">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
            <p className="text-sm font-bold text-gray-100 uppercase tracking-wider">已加入時段</p>
            {segments.length > 0 && <span className="text-sm text-gray-600">{segments.length}</span>}
          </div>
          {listContent}
        </div>
      </div>

    </aside>
  )
}
