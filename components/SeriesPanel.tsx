'use client'

import { useState } from 'react'
import { SeriesConfig, PRESET_GROUPS, COLORS, ChartType, CHART_TYPE_LABELS, PresetItem } from '@/lib/types'
import { validateFormula } from '@/lib/formula'

interface Props {
  series: SeriesConfig[]
  onAdd: (cfg: Omit<SeriesConfig, 'data' | 'loading'>) => void
  onRemove: (id: string) => void
  onToggleVisible: (id: string) => void
  onToggleAxis: (id: string) => void
  onToggleNormalize: (id: string) => void
  onColorChange: (id: string, color: string) => void
  onChartTypeChange: (id: string, type: ChartType) => void
}

const CHART_TYPE_ICONS: Record<ChartType, string> = { line: '〰', bar: '▊', area: '◭' }

export default function SeriesPanel({
  series, onAdd, onRemove, onToggleVisible, onToggleAxis, onToggleNormalize, onColorChange, onChartTypeChange,
}: Props) {
  const [customTicker, setCustomTicker] = useState('')
  const [customLabel, setCustomLabel]   = useState('')
  const [formulaExpr, setFormulaExpr]   = useState('')
  const [formulaLabel, setFormulaLabel] = useState('')
  const [formulaError, setFormulaError] = useState<string | null>(null)

  const addedIds  = new Set(series.map((s) => s.id))
  const nextColor = () => COLORS[series.length % COLORS.length]
  const knownIds  = new Set(series.map((s) => s.id))
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => { const s = new Set(prev); s.has(label) ? s.delete(label) : s.add(label); return s })

  const handleAddPreset = (preset: PresetItem) => {
    if (addedIds.has(preset.id)) return
    onAdd({ ...preset, normalize: false, chartType: 'line', visible: true })
  }

  const handleAddCustom = () => {
    const ticker = customTicker.trim().toUpperCase()
    if (!ticker) return
    const id = `custom_${ticker}_${Date.now()}`
    onAdd({ id, label: customLabel.trim() || ticker, type: 'stocks', ticker, color: nextColor(), axis: 'left', chartType: 'line', normalize: false, visible: true })
    setCustomTicker('')
    setCustomLabel('')
  }

  const handleAddFormula = () => {
    const expr = formulaExpr.trim()
    if (!expr) return
    const err = validateFormula(expr, knownIds)
    if (err) { setFormulaError(err); return }
    setFormulaError(null)
    const id = `formula_${Date.now()}`
    onAdd({ id, label: formulaLabel.trim() || expr, type: 'formula', formula: expr, color: nextColor(), axis: 'left', chartType: 'line', normalize: false, visible: true })
    setFormulaExpr('')
    setFormulaLabel('')
  }

  return (
    <aside className="flex shrink-0 h-full border-r border-gray-800">

      {/* ── 左欄：選取指標 ── */}
      <div className="w-60 bg-gray-900 flex flex-col overflow-y-auto border-r border-gray-800">

        <div className="px-4 pt-4 pb-2">
          <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">選取指標</p>
        </div>

        {/* Presets — collapsible groups */}
        <div className="border-b border-gray-800">
          {PRESET_GROUPS.map((group) => {
            const open = openGroups.has(group.label)
            const addedCount = group.items.filter((p) => addedIds.has(p.id)).length
            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/60 transition-colors text-left"
                >
                  <span className="text-xs font-semibold text-gray-400">{group.label}</span>
                  <div className="flex items-center gap-2">
                    {addedCount > 0 && (
                      <span className="text-xs text-green-500 font-mono">{addedCount}</span>
                    )}
                    <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
                  </div>
                </button>
                {open && (
                  <div className="flex flex-col pb-1 px-2">
                    {group.items.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleAddPreset(p)}
                        disabled={addedIds.has(p.id)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left
                          ${addedIds.has(p.id) ? 'opacity-40 cursor-default' : 'hover:bg-gray-700 cursor-pointer'}`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="text-gray-300 truncate text-xs">{p.label}</span>
                        {addedIds.has(p.id) && <span className="text-green-500 text-xs ml-auto">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Custom ticker */}
        <div className="px-4 py-4 border-b border-gray-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">自訂代碼</p>
          <input type="text" placeholder="代碼 (e.g. AAPL)" value={customTicker}
            onChange={(e) => setCustomTicker(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500 mb-2" />
          <input type="text" placeholder="名稱 (選填)" value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500 mb-2" />
          <button onClick={handleAddCustom}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg py-2 transition-colors">
            新增
          </button>
        </div>

        {/* Formula */}
        <div className="px-4 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">四則運算指標</p>
          <p className="text-xs text-gray-600 mb-2">用已加入的指標 ID 組合公式</p>

          {series.filter((s) => s.type !== 'formula').length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {series.filter((s) => s.type !== 'formula').map((s) => (
                <button key={s.id}
                  onClick={() => setFormulaExpr((v) => v ? `${v} ${s.id}` : s.id)}
                  className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-mono transition-colors">
                  {s.id}
                </button>
              ))}
            </div>
          )}

          <textarea rows={2} placeholder="例：US10Y - US2Y" value={formulaExpr}
            onChange={(e) => { setFormulaExpr(e.target.value); setFormulaError(null) }}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-purple-500 mb-2 resize-none font-mono" />
          <input type="text" placeholder="名稱 (選填)" value={formulaLabel}
            onChange={(e) => setFormulaLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFormula()}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-purple-500 mb-2" />
          {formulaError && <p className="text-xs text-red-400 mb-2">{formulaError}</p>}
          <button onClick={handleAddFormula}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg py-2 transition-colors">
            新增計算指標
          </button>
        </div>
      </div>

      {/* ── 右欄：已加入的指標 ── */}
      <div className="w-56 bg-gray-950 flex flex-col overflow-y-auto">

        <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
          <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">已加入的指標</p>
          {series.length > 0 && (
            <span className="text-xs text-gray-600">{series.length}</span>
          )}
        </div>

        {series.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-xs text-gray-600 text-center">從左側新增指標後<br />會顯示在這裡</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-3 pb-4">
            {series.map((s) => (
              <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">

                {/* Header row: color + name + visibility + delete */}
                <div className="flex items-start gap-2 mb-2">
                  <input type="color" value={s.color}
                    onChange={(e) => onColorChange(s.id, e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug break-words ${s.visible === false ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{s.label}</p>
                    {s.type === 'formula' && (
                      <p className="text-xs text-gray-500 font-mono mt-0.5 break-all">{s.formula}</p>
                    )}
                    {s.loading && <p className="text-xs text-gray-500 mt-0.5">載入中…</p>}
                    {s.error   && <p className="text-xs text-red-400 mt-0.5 break-words">{s.error}</p>}
                  </div>
                  <button onClick={() => onToggleVisible(s.id)}
                    title={s.visible === false ? '顯示' : '隱藏'}
                    className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors text-xs leading-none
                      ${s.visible === false ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-200'}`}>
                    {s.visible === false ? '👁️' : '👁'}
                  </button>
                  <button onClick={() => onRemove(s.id)}
                    title="刪除指標"
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-red-400 hover:bg-red-900/30 transition-colors text-base leading-none">
                    ×
                  </button>
                </div>

                {/* Chart type */}
                <div className="flex gap-1 mb-1.5">
                  {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((ct) => (
                    <button key={ct} onClick={() => onChartTypeChange(s.id, ct)} title={CHART_TYPE_LABELS[ct]}
                      className={`flex-1 text-xs py-0.5 rounded transition-colors flex items-center justify-center gap-0.5
                        ${s.chartType === ct ? 'bg-blue-700 text-blue-100' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300'}`}>
                      <span>{CHART_TYPE_ICONS[ct]}</span>
                    </button>
                  ))}
                </div>

                {/* Axis + normalize */}
                <div className="flex gap-1">
                  <button onClick={() => onToggleAxis(s.id)}
                    className={`flex-1 text-xs py-0.5 rounded transition-colors
                      ${s.axis === 'left' ? 'bg-blue-900/60 text-blue-300' : 'bg-orange-900/60 text-orange-300'}`}>
                    {s.axis === 'left' ? '左軸' : '右軸'}
                  </button>
                  <button onClick={() => onToggleNormalize(s.id)}
                    className={`flex-1 text-xs py-0.5 rounded transition-colors
                      ${s.normalize ? 'bg-green-900/60 text-green-300' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>
                    %變化
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
