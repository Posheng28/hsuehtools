'use client'
import { useEffect, useState } from 'react'
import type { FundDef } from '@/lib/fund/types'
import type { DualRow } from '@/lib/fund/query'

// ── Types ──────────────────────────────────────────────────────────────────

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

type HoldingPeriodKey = '1m' | '3m' | '6m'

interface PeriodStats {
  n: number
  avg_return: number
  median_return: number
  avg_excess: number
  win_rate: number
  payoff_ratio: number
  profit_factor: number
  sharpe_annual: number
  sortino_annual: number
  beta: number
  alpha_annual: number
}

interface StrategyDef {
  name: string
  description: string
}

interface FundStrategiesData {
  run_at: string
  total_signals: number
  valid_trades: number
  holding_periods: number[]
  strategies: StrategyDef[]
  summary: Record<string, { trade_count: number; by_period: Record<HoldingPeriodKey, PeriodStats> }>
}

// ── Nav sections ───────────────────────────────────────────────────────────

type SectionId =
  | '策略績效'
  | '經理人動態'
  | '股票搜尋'
  | '雙軌比對'
  | '月季交叉'
  | '各基金持股分析'
  | '經理人 DNA'
  | '跨基金資金流向'

const NAV_ITEMS: SectionId[] = [
  '策略績效',
  '經理人動態',
  '股票搜尋',
  '雙軌比對',
  '月季交叉',
  '各基金持股分析',
  '經理人 DNA',
  '跨基金資金流向',
]

// ── Strategy name mapping ──────────────────────────────────────────────────

const STRATEGY_NAMES: Record<string, string> = {
  graduation: '季報→月報 TOP10 晉升',
  stealth_activation: '季報潛伏，ETF 激活',
  dual_track: '雙軌建倉',
  consensus: '多基金共識 TOP10',
  momentum: '連續加碼',
  lockup_surge: '雙軌加碼中',
  resonance: '共識形成',
  ceiling: '高權重減碼',
  disappearance: '核心出場',
}

// ── Formatting helpers ─────────────────────────────────────────────────────

// Backtest values are stored already as percentages (e.g. 63.54 = 63.54%), not fractions.
function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '–'
  return v.toFixed(2) + '%'
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '–'
  return v.toFixed(decimals)
}

// Taiwan color convention: positive = red, negative = emerald/green
function returnColor(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'var(--fd-muted)'
  if (v > 0) return 'var(--fd-red)'
  if (v < 0) return 'var(--fd-green)'
  return 'var(--fd-secondary)'
}

function sharpeColor(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'var(--fd-secondary)'
  if (v > 0) return 'var(--fd-green)'
  return 'var(--fd-secondary)'
}

// ── CSS variables injected via a wrapper ──────────────────────────────────
// We use a single wrapper div with data-theme="dark"|"light" and inject
// CSS custom properties via a <style> tag to keep theming DRY.

const THEME_STYLE = `
  [data-fd-theme="dark"] {
    --fd-page-bg: #0b0d14;
    --fd-card-bg: #12141f;
    --fd-card-hover: #1a1d2b;
    --fd-control-bg: #222639;
    --fd-border: rgba(255,255,255,0.06);
    --fd-border-solid: #222639;
    --fd-text: #e5e7eb;
    --fd-secondary: #9ca3af;
    --fd-muted: #6b7280;
    --fd-accent: #d08a4f;
    --fd-accent-active-bg: #b5733a;
    --fd-red: #f87171;
    --fd-green: #34d399;
    --fd-warn-bg: rgba(208,138,79,0.12);
    --fd-warn-border: #d08a4f;
    --fd-warn-text: #fcd98a;
    --fd-sidebar-bg: #0e1018;
    --fd-sidebar-border: rgba(255,255,255,0.07);
    --fd-active-nav-bg: rgba(208,138,79,0.12);
    --fd-active-nav-accent: #d08a4f;
    --fd-inactive-pill-bg: #222639;
    --fd-inactive-pill-text: #9ca3af;
  }
  [data-fd-theme="light"] {
    --fd-page-bg: #faf8f3;
    --fd-card-bg: #ffffff;
    --fd-card-hover: #f5f2ea;
    --fd-control-bg: #ede9df;
    --fd-border: #e7e2d8;
    --fd-border-solid: #e7e2d8;
    --fd-text: #1f2937;
    --fd-secondary: #6b7280;
    --fd-muted: #9ca3af;
    --fd-accent: #b5733a;
    --fd-accent-active-bg: #b5733a;
    --fd-red: #dc2626;
    --fd-green: #059669;
    --fd-warn-bg: rgba(181,115,58,0.10);
    --fd-warn-border: #b5733a;
    --fd-warn-text: #92400e;
    --fd-sidebar-bg: #f0ede4;
    --fd-sidebar-border: #e7e2d8;
    --fd-active-nav-bg: rgba(181,115,58,0.12);
    --fd-active-nav-accent: #b5733a;
    --fd-inactive-pill-bg: #ede9df;
    --fd-inactive-pill-text: #6b7280;
  }
`

// ── Sub-sections ───────────────────────────────────────────────────────────

function PlaceholderSection({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <div
        style={{
          background: 'var(--fd-card-bg)',
          border: '1px solid var(--fd-border)',
          color: 'var(--fd-muted)',
          borderRadius: '12px',
          padding: '48px 64px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--fd-secondary)', marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: '0.85rem' }}>建置中</div>
      </div>
    </div>
  )
}

// ── 策略績效 section ───────────────────────────────────────────────────────

function StrategyPerformanceSection() {
  const [data, setData] = useState<FundStrategiesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<HoldingPeriodKey>('6m')

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/fund-strategies', { signal: ac.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: FundStrategiesData) => {
        setData(d)
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? '載入失敗')
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [])

  const periodLabels: { key: HoldingPeriodKey; label: string }[] = [
    { key: '1m', label: '1 個月' },
    { key: '3m', label: '3 個月' },
    { key: '6m', label: '6 個月' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* H1 + subtitle */}
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--fd-text)', margin: 0 }}>
          策略績效
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--fd-secondary)', marginTop: 4 }}>
          真實股價回測（資料來源：Yahoo Finance）
        </p>
      </div>

      {/* Warning banner */}
      <div
        style={{
          background: 'var(--fd-warn-bg)',
          borderLeft: '3px solid var(--fd-warn-border)',
          borderRadius: '8px',
          padding: '10px 14px',
          color: 'var(--fd-warn-text)',
          fontSize: '0.8rem',
          lineHeight: 1.5,
        }}
      >
        ⚠ 樣本偏多頭：回測區間為強牛市，Alpha/Sharpe 普遍偏高，需等空頭資料再驗證。
      </div>

      {/* Info bar */}
      <div
        style={{
          background: 'var(--fd-card-bg)',
          border: '1px solid var(--fd-border)',
          borderRadius: '8px',
          padding: '10px 14px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px 20px',
          fontSize: '0.78rem',
          color: 'var(--fd-secondary)',
        }}
      >
        <span>💸 已扣交易成本</span>
        <span>📊 CI：Bootstrap</span>
        <span>🎲 蒙地卡羅檢定</span>
        <span>⚠ 策略間約 60% 重疊</span>
      </div>

      {/* Period toggle + meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {periodLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              style={{
                padding: '5px 14px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: period === key ? 600 : 400,
                background: period === key ? 'var(--fd-accent-active-bg)' : 'var(--fd-inactive-pill-bg)',
                color: period === key ? '#ffffff' : 'var(--fd-inactive-pill-text)',
                transition: 'background 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {data && (
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--fd-muted)' }}>
            回測執行：{data.run_at.slice(0, 10)} ／ {data.valid_trades} 筆有效交易
          </span>
        )}
      </div>

      {/* Loading / error */}
      {loading && (
        <div style={{ color: 'var(--fd-muted)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          載入中…
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--fd-red)', fontSize: '0.85rem', padding: '16px 0' }}>
          載入失敗：{error}
        </div>
      )}

      {/* Strategy table */}
      {data && !loading && (
        <div
          style={{
            background: 'var(--fd-card-bg)',
            border: '1px solid var(--fd-border)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.82rem',
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--fd-border)',
                  color: 'var(--fd-muted)',
                  fontSize: '0.75rem',
                }}
              >
                <th style={{ textAlign: 'left', padding: '9px 14px', fontWeight: 500 }}>策略</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>N</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>報酬</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>超額</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>勝率</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>賠賺</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>獲利</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>SHARPE</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>SORTINO</th>
                <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>β</th>
                <th style={{ textAlign: 'right', padding: '9px 14px', fontWeight: 500 }}>α年</th>
              </tr>
            </thead>
            <tbody>
              {data.strategies.map((strat, idx) => {
                const stats = data.summary[strat.name]?.by_period?.[period]
                const zhName = STRATEGY_NAMES[strat.name]
                const displayName = zhName ?? strat.description

                return (
                  <tr
                    key={strat.name}
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid var(--fd-border)',
                      cursor: 'default',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'var(--fd-card-hover)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                    }}
                  >
                    {/* 策略 */}
                    <td style={{ padding: '10px 14px', minWidth: 200 }}>
                      <div style={{ fontWeight: 600, color: 'var(--fd-text)' }}>
                        {idx + 1} {displayName}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--fd-muted)', marginTop: 2 }}>
                        {strat.description}
                      </div>
                    </td>
                    {/* N */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: 'var(--fd-text)',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {stats?.n ?? '–'}
                    </td>
                    {/* 報酬 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: returnColor(stats?.avg_return),
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {fmtPct(stats?.avg_return)}
                    </td>
                    {/* 超額 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: returnColor(stats?.avg_excess),
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {fmtPct(stats?.avg_excess)}
                    </td>
                    {/* 勝率 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: 'var(--fd-text)',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtPct(stats?.win_rate)}
                    </td>
                    {/* 賠賺 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: 'var(--fd-text)',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtNum(stats?.payoff_ratio)}
                    </td>
                    {/* 獲利 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: 'var(--fd-text)',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtNum(stats?.profit_factor)}
                    </td>
                    {/* SHARPE */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: sharpeColor(stats?.sharpe_annual),
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {fmtNum(stats?.sharpe_annual)}
                    </td>
                    {/* SORTINO */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: sharpeColor(stats?.sortino_annual),
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {fmtNum(stats?.sortino_annual)}
                    </td>
                    {/* β */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 10px',
                        color: 'var(--fd-secondary)',
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtNum(stats?.beta)}
                    </td>
                    {/* α年 */}
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '10px 14px',
                        color: returnColor(stats?.alpha_annual),
                        fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 500,
                      }}
                    >
                      {fmtPct(stats?.alpha_annual)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 各基金持股分析 section (existing FundView holdings logic) ──────────────

function HoldingsSection() {
  const [funds, setFunds] = useState<FundDef[]>([])
  const [sel, setSel] = useState<string>('uni-benteng')
  const [def, setDef] = useState<FundDef | null>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const [dualRows, setDualRows] = useState<DualRow[]>([])
  const [dualLoading, setDualLoading] = useState(false)
  const [showDual, setShowDual] = useState(false)

  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

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
    setSnap(null)
    setDef(null)
    setDualRows([])
    setShowDual(false)
    setUpdateMsg(null)
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => {
        setSnap(d.monthly ?? d.quarterly ?? null)
        setDef(d.def ?? null)
      })
      .catch(e => { if (e.name !== 'AbortError') setSnap(null) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [sel])

  useEffect(() => {
    if (!showDual || !def?.relatedEtf) return
    const ac = new AbortController()
    setDualRows([])
    setDualLoading(true)
    fetch(`/api/fund?pair=${sel},${def.relatedEtf}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => setDualRows(d.rows ?? []))
      .catch(e => { if (e.name !== 'AbortError') setDualRows([]) })
      .finally(() => { if (!ac.signal.aborted) setDualLoading(false) })
    return () => ac.abort()
  }, [showDual, sel, def])

  function refetchSnap() {
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/fund?fund=${sel}`, { signal: ac.signal })
      .then(r => r.json())
      .then(d => { setSnap(d.monthly ?? d.quarterly ?? null); setDef(d.def ?? null) })
      .catch(() => {})
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
  }

  async function handleUpdate() {
    setUpdating(true)
    setUpdateMsg(null)
    try {
      const res = await fetch('/api/fund-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundId: sel }),
      })
      if (res.status === 425) {
        setUpdateMsg('資料當日尚未定案（18:30 後再試）')
      } else if (res.status === 501) {
        setUpdateMsg('此來源的 live 更新尚未啟用（目前為歷史種子資料）')
      } else if (res.ok) {
        setUpdateMsg('更新成功')
        refetchSnap()
      } else {
        const d = await res.json().catch(() => ({}))
        setUpdateMsg(d.error ?? `錯誤 ${res.status}`)
      }
    } catch {
      setUpdateMsg('網路錯誤，請稍後再試')
    } finally {
      setUpdating(false)
    }
  }

  const relatedEtf = def?.relatedEtf

  const cardBg: React.CSSProperties = {
    background: 'var(--fd-card-bg)',
    border: '1px solid var(--fd-border)',
    borderRadius: '10px',
    overflow: 'hidden',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--fd-text)', margin: 0 }}>
        各基金持股分析
      </h1>

      {/* 基金選擇 + 更新按鈕 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <select
          value={sel}
          onChange={e => setSel(e.target.value)}
          style={{
            background: 'var(--fd-control-bg)',
            color: 'var(--fd-text)',
            borderRadius: '8px',
            padding: '6px 12px',
            border: '1px solid var(--fd-border-solid)',
            fontSize: '0.85rem',
            outline: 'none',
          }}
        >
          {funds.map(f => (
            <option key={f.fundId} value={f.fundId}>
              {f.fundId}
            </option>
          ))}
        </select>
        {snap && (
          <span style={{ color: 'var(--fd-muted)', fontSize: '0.75rem' }}>
            {snap.period}
            {snap.reportType === 'monthly_top10' ? '　月報 Top10' : '　季報全持股'}
            {snap.meta?.manager && <span>　經理人：{snap.meta.manager}</span>}
          </span>
        )}
        {loading && <span style={{ color: 'var(--fd-muted)', fontSize: '0.75rem' }}>載入中…</span>}

        <button
          onClick={handleUpdate}
          disabled={updating}
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            padding: '5px 12px',
            borderRadius: '8px',
            background: 'var(--fd-control-bg)',
            border: '1px solid var(--fd-border-solid)',
            color: 'var(--fd-secondary)',
            cursor: updating ? 'not-allowed' : 'pointer',
            opacity: updating ? 0.5 : 1,
          }}
        >
          {updating ? '更新中…' : '更新本期'}
        </button>
      </div>

      {/* 更新狀態提示 */}
      {updateMsg && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--fd-secondary)',
            background: 'var(--fd-card-bg)',
            border: '1px solid var(--fd-border)',
            borderRadius: '6px',
            padding: '8px 12px',
          }}
        >
          {updateMsg}
        </div>
      )}

      {/* 持股表格 */}
      {snap && snap.holdings.length > 0 && (
        <div style={cardBg}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  color: 'var(--fd-muted)',
                  borderBottom: '1px solid var(--fd-border)',
                  background: 'var(--fd-card-bg)',
                  fontSize: '0.75rem',
                }}
              >
                <th style={{ padding: '8px 12px', width: 32 }}>#</th>
                <th style={{ padding: '8px 12px', width: 80 }}>代號</th>
                <th style={{ padding: '8px 12px' }}>名稱</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', width: 80 }}>權重%</th>
              </tr>
            </thead>
            <tbody>
              {snap.holdings.map((h, i) => (
                <tr
                  key={h.code}
                  style={{ borderTop: '1px solid var(--fd-border)', transition: 'background 0.1s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--fd-card-hover)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                >
                  <td style={{ padding: '6px 12px', color: 'var(--fd-muted)' }}>{h.rank ?? i + 1}</td>
                  <td
                    style={{
                      padding: '6px 12px',
                      color: 'var(--fd-accent)',
                      fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {h.code}
                  </td>
                  <td style={{ padding: '6px 12px', color: 'var(--fd-text)' }}>{h.name}</td>
                  <td
                    style={{
                      padding: '6px 12px',
                      textAlign: 'right',
                      color: 'var(--fd-text)',
                      fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {h.weightPct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {snap && snap.holdings.length === 0 && (
        <div style={{ color: 'var(--fd-muted)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          無持股資料
        </div>
      )}

      {!snap && !loading && funds.length > 0 && (
        <div style={{ color: 'var(--fd-muted)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          無資料
        </div>
      )}

      {/* 雙軌比較 */}
      {relatedEtf && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => setShowDual(v => !v)}
            style={{
              alignSelf: 'flex-start',
              fontSize: '0.75rem',
              padding: '5px 12px',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: showDual ? 'var(--fd-accent)' : 'var(--fd-border-solid)',
              background: showDual ? 'var(--fd-active-nav-bg)' : 'var(--fd-control-bg)',
              color: showDual ? 'var(--fd-accent)' : 'var(--fd-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {showDual ? '▾ 雙軌比較' : '▸ 雙軌比較'} vs {relatedEtf}
          </button>

          {showDual && (
            <div style={cardBg}>
              {dualLoading && (
                <div style={{ color: 'var(--fd-muted)', fontSize: '0.75rem', padding: '12px' }}>載入中…</div>
              )}
              {!dualLoading && dualRows.length === 0 && (
                <div style={{ color: 'var(--fd-muted)', fontSize: '0.75rem', padding: '12px' }}>無雙軌資料</div>
              )}
              {!dualLoading && dualRows.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr
                      style={{
                        textAlign: 'left',
                        color: 'var(--fd-muted)',
                        borderBottom: '1px solid var(--fd-border)',
                        fontSize: '0.75rem',
                      }}
                    >
                      <th style={{ padding: '8px 12px', width: 80 }}>代號</th>
                      <th style={{ padding: '8px 12px' }}>名稱</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: 72 }}>基金%</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: 72 }}>ETF%</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: 72 }}>差異</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dualRows.map(r => {
                      const diffColor =
                        r.diff == null ? 'var(--fd-muted)'
                        : r.diff > 0 ? 'var(--fd-red)'
                        : r.diff < 0 ? 'var(--fd-green)'
                        : 'var(--fd-secondary)'
                      return (
                        <tr
                          key={r.code}
                          style={{ borderTop: '1px solid var(--fd-border)', transition: 'background 0.1s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--fd-card-hover)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                        >
                          <td
                            style={{
                              padding: '6px 12px',
                              color: 'var(--fd-accent)',
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.code}
                          </td>
                          <td style={{ padding: '6px 12px', color: 'var(--fd-text)' }}>{r.name}</td>
                          <td
                            style={{
                              padding: '6px 12px',
                              textAlign: 'right',
                              color: 'var(--fd-text)',
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.fundWeight != null ? r.fundWeight.toFixed(2) : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 12px',
                              textAlign: 'right',
                              color: 'var(--fd-text)',
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.etfWeight != null ? r.etfWeight.toFixed(2) : '—'}
                          </td>
                          <td
                            style={{
                              padding: '6px 12px',
                              textAlign: 'right',
                              color: diffColor,
                              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {r.diff != null ? (r.diff > 0 ? '+' : '') + r.diff.toFixed(2) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main FundView shell ────────────────────────────────────────────────────

export default function FundView() {
  const [section, setSection] = useState<SectionId>('策略績效')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  function renderSection() {
    switch (section) {
      case '策略績效':
        return <StrategyPerformanceSection />
      case '各基金持股分析':
        return <HoldingsSection />
      case '雙軌比對':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--fd-text)', margin: 0 }}>雙軌比對</h1>
            <div
              style={{
                background: 'var(--fd-card-bg)',
                border: '1px solid var(--fd-border)',
                borderRadius: '10px',
                padding: '20px 24px',
                color: 'var(--fd-secondary)',
                fontSize: '0.85rem',
              }}
            >
              （見各基金持股分析的雙軌比較）
            </div>
          </div>
        )
      default:
        return <PlaceholderSection title={section} />
    }
  }

  return (
    <>
      {/* Inject CSS variables */}
      <style>{THEME_STYLE}</style>

      <div
        data-fd-theme={theme}
        style={{
          display: 'flex',
          height: '100%',
          background: 'var(--fd-page-bg)',
          color: 'var(--fd-text)',
          fontFamily: 'inherit',
          overflow: 'hidden',
        }}
      >
        {/* ── Sidebar ── */}
        <aside
          style={{
            width: 230,
            flexShrink: 0,
            background: 'var(--fd-sidebar-bg)',
            borderRight: '1px solid var(--fd-sidebar-border)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Brand */}
          <div style={{ padding: '20px 18px 16px' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--fd-accent)', lineHeight: 1.2 }}>
              持股追蹤
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--fd-muted)', marginTop: 4 }}>
              基金經理人訊號
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
            {NAV_ITEMS.map(item => {
              const isActive = section === item
              return (
                <button
                  key={item}
                  onClick={() => setSection(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '9px 10px',
                    marginBottom: 2,
                    borderRadius: '7px',
                    border: 'none',
                    background: isActive ? 'var(--fd-active-nav-bg)' : 'transparent',
                    color: isActive ? 'var(--fd-active-nav-accent)' : 'var(--fd-secondary)',
                    fontSize: '0.83rem',
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderLeft: isActive ? '3px solid var(--fd-active-nav-accent)' : '3px solid transparent',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--fd-control-bg)'
                  }}
                  onMouseLeave={e => {
                    if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                >
                  {item}
                </button>
              )
            })}
          </nav>

          {/* Theme toggle */}
          <div style={{ padding: '8px 10px' }}>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--fd-border-solid)',
                background: 'var(--fd-control-bg)',
                color: 'var(--fd-secondary)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {theme === 'dark' ? '☾ Dark' : '☀ Light'}
            </button>
          </div>

          {/* Data source footer */}
          <div
            style={{
              padding: '12px 18px 14px',
              borderTop: '1px solid var(--fd-border)',
              fontSize: '0.68rem',
              color: 'var(--fd-muted)',
              lineHeight: 1.8,
            }}
          >
            <div style={{ fontWeight: 500, marginBottom: 2 }}>資料來源</div>
            <div>月報：前十大持股</div>
            <div>季報：占淨值 1% 以上</div>
            <div>更新：每月第 10 營業日</div>
            <div style={{ marginTop: 6, color: 'var(--fd-muted)', opacity: 0.7 }}>v0.1.0</div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            minWidth: 0,
          }}
        >
          {renderSection()}
        </main>
      </div>
    </>
  )
}
