'use client'
import { useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Strategy name mapping ─────────────────────────────────────────────────────

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

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '–'
  return v.toFixed(2) + '%'
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '–'
  return v.toFixed(decimals)
}

function returnColor(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'var(--txt-mute)'
  if (v > 0) return 'var(--up)'
  if (v < 0) return 'var(--down)'
  return 'var(--txt-dim)'
}

function sharpeColor(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'var(--txt-dim)'
  if (v > 0) return 'var(--down)'
  return 'var(--txt-dim)'
}

// ── StrategiesView ────────────────────────────────────────────────────────────

export default function StrategiesView() {
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
      .then((d: FundStrategiesData) => setData(d))
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? '載入失敗')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [])

  const periodLabels: { key: HoldingPeriodKey; label: string }[] = [
    { key: '1m', label: '1個月' },
    { key: '3m', label: '3個月' },
    { key: '6m', label: '6個月' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h1
          style={{
            fontSize: '1.4rem',
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            borderBottom: '2px solid var(--accent)',
            paddingBottom: 3,
            display: 'inline-block',
          }}
        >
          策略績效
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--txt-dim)', marginTop: 6 }}>
          真實股價回測（資料來源：Yahoo Finance）
        </p>
      </div>

      {/* Muted note — our own copy */}
      <p
        style={{
          margin: 0,
          fontSize: '0.78rem',
          color: 'var(--txt-mute)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '7px 12px',
          display: 'inline-block',
          alignSelf: 'flex-start',
        }}
      >
        回測區間為強牛市，績效偏樂觀，僅供參考。資料：Yahoo Finance
      </p>

      {/* Period toggle + meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {periodLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: period === key ? 600 : 400,
                background: period === key ? 'var(--accent)' : 'var(--panel2)',
                color: period === key ? '#0e1116' : 'var(--txt-dim)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {data && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.72rem',
              color: 'var(--txt-mute)',
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            回測執行：{data.run_at.slice(0, 10)} ／ {data.valid_trades} 筆有效交易
          </span>
        )}
      </div>

      {/* Loading / error */}
      {loading && (
        <div style={{ color: 'var(--txt-mute)', fontSize: '0.85rem', padding: '32px 0', textAlign: 'center' }}>
          載入中…
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--up)', fontSize: '0.85rem', padding: '16px 0' }}>
          載入失敗：{error}
        </div>
      )}

      {/* Strategy table */}
      {data && !loading && (
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            overflow: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--line)',
                  color: 'var(--txt-mute)',
                  fontSize: '0.72rem',
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
                const mono = {
                  fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                  fontVariantNumeric: 'tabular-nums' as const,
                }

                return (
                  <tr
                    key={strat.name}
                    style={{
                      borderTop: idx === 0 ? 'none' : '1px solid var(--line)',
                      cursor: 'default',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'var(--panel2)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                    }}
                  >
                    <td style={{ padding: '10px 14px', minWidth: 200 }}>
                      <div style={{ fontWeight: 600, color: 'var(--txt)' }}>
                        {idx + 1} {displayName}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--txt-mute)', marginTop: 2 }}>
                        {strat.description}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--txt)', ...mono }}>
                      {stats?.n ?? '–'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: returnColor(stats?.avg_return), fontWeight: 500, ...mono }}>
                      {fmtPct(stats?.avg_return)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: returnColor(stats?.avg_excess), fontWeight: 500, ...mono }}>
                      {fmtPct(stats?.avg_excess)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--txt)', ...mono }}>
                      {fmtPct(stats?.win_rate)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--txt)', ...mono }}>
                      {fmtNum(stats?.payoff_ratio)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--txt)', ...mono }}>
                      {fmtNum(stats?.profit_factor)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: sharpeColor(stats?.sharpe_annual), fontWeight: 500, ...mono }}>
                      {fmtNum(stats?.sharpe_annual)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: sharpeColor(stats?.sortino_annual), fontWeight: 500, ...mono }}>
                      {fmtNum(stats?.sortino_annual)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 10px', color: 'var(--txt-dim)', ...mono }}>
                      {fmtNum(stats?.beta)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 14px', color: returnColor(stats?.alpha_annual), fontWeight: 500, ...mono }}>
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
