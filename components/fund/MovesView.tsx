'use client'
import { useEffect, useState } from 'react'
import type { StockAgg } from '@/lib/fund/moves'

interface MovesData {
  currPeriod: string
  prevPeriod: string
  up: StockAgg[]
  down: StockAgg[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDelta(v: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

/** Show first 3 fund slugs, truncate rest */
function FundSlugs({
  add,
  enter,
  reduce,
  exit,
}: {
  add: string[]
  enter: string[]
  reduce: string[]
  exit: string[]
}) {
  const all = [
    ...add.map(f => ({ f, tag: '' })),
    ...enter.map(f => ({ f, tag: '新' })),
    ...reduce.map(f => ({ f, tag: '' })),
    ...exit.map(f => ({ f, tag: '出' })),
  ]
  const shown = all.slice(0, 3)
  const rest = all.length - shown.length
  const title = all.map(({ f, tag }) => (tag ? `[${tag}]${f}` : f)).join(' ')

  return (
    <span
      title={title}
      style={{ color: 'var(--txt-mute)', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, display: 'inline-block', verticalAlign: 'bottom' }}
    >
      {shown.map(({ f, tag }, i) => (
        <span key={i} style={{ marginRight: 3 }}>
          {tag && (
            <span
              style={{
                fontSize: '0.6rem',
                background: tag === '新' ? 'var(--up)' : 'var(--txt-mute)',
                color: '#fff',
                borderRadius: 2,
                padding: '0 2px',
                marginRight: 1,
                opacity: 0.85,
              }}
            >
              {tag}
            </span>
          )}
          {f}
        </span>
      ))}
      {rest > 0 && <span style={{ opacity: 0.6 }}>+{rest}</span>}
    </span>
  )
}

/** Tiny horizontal bar: red portion = upCount, green = downCount */
function ConsensusBar({ up, down }: { up: number; down: number }) {
  const total = up + down
  if (total === 0) return null
  const upPct = (up / total) * 100
  const downPct = (down / total) * 100
  return (
    <span
      style={{
        display: 'inline-flex',
        width: 40,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      <span style={{ width: `${upPct}%`, background: 'var(--up)', opacity: 0.75 }} />
      <span style={{ width: `${downPct}%`, background: 'var(--down)', opacity: 0.75 }} />
    </span>
  )
}

// ── StockRow ─────────────────────────────────────────────────────────────────
// Flex card: top row = accent-tick | glyph | code+name | count+delta (never clips)
//            bottom row = fund slugs (allowed to ellipsis)

function StockRow({
  agg,
  direction,
  rank,
}: {
  agg: StockAgg
  direction: 'up' | 'down'
  rank: number
}) {
  const isUp = direction === 'up'
  const glyph = isUp ? '▲' : '▼'
  const glyphColor = isUp ? 'var(--up)' : 'var(--down)'
  const count = isUp ? agg.upCount : agg.downCount
  const countColor = glyphColor
  const deltaColor = agg.totalDelta > 0 ? 'var(--up)' : 'var(--down)'
  const isTop3 = rank <= 3

  return (
    <div
      style={{
        borderTop: '1px solid var(--line)',
        padding: '7px 10px',
        transition: 'background 0.1s',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--panel2)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent'
      }}
    >
      {/* Top row: fixed-size items + code+name (grows) + count+delta (shrink-0) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {/* Accent tick for top 3 */}
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: 16,
            background: isTop3 ? 'var(--accent)' : 'transparent',
            borderRadius: 1,
            flexShrink: 0,
          }}
        />
        {/* Glyph */}
        <span style={{ color: glyphColor, fontSize: '0.72rem', flexShrink: 0 }}>{glyph}</span>
        {/* Code + Name — allowed to shrink but not clip the numbers on the right */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 5,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--txt)',
              fontSize: '0.82rem',
              flexShrink: 0,
            }}
          >
            {agg.code}
          </span>
          <span
            style={{
              color: 'var(--txt-dim)',
              fontSize: '0.8rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {agg.name}
          </span>
        </span>
        {/* Count badge — never shrinks */}
        <span
          style={{
            fontWeight: 700,
            color: countColor,
            fontSize: '0.8rem',
            fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {count} 檔
        </span>
        {/* Delta — never shrinks */}
        <span
          style={{
            color: deltaColor,
            fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.8rem',
            fontWeight: 500,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {fmtDelta(agg.totalDelta)}
        </span>
        {/* Consensus bar */}
        <ConsensusBar up={agg.upCount} down={agg.downCount} />
      </div>
      {/* Bottom row: fund slugs — only this is allowed to ellipsis */}
      <div style={{ paddingLeft: 14, marginTop: 2, minWidth: 0, overflow: 'hidden' }}>
        <FundSlugs
          add={agg.addFunds}
          enter={agg.enterFunds}
          reduce={agg.reduceFunds}
          exit={agg.exitFunds}
        />
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Panel({
  title,
  underlineColor,
  rows,
  direction,
  loading,
}: {
  title: string
  underlineColor: string
  rows: StockAgg[]
  direction: 'up' | 'down'
  loading: boolean
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        width: '100%',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            color: 'var(--txt)',
            borderBottom: `2px solid ${underlineColor}`,
            paddingBottom: 2,
          }}
        >
          {title}
        </span>
      </div>

      {loading && (
        <div
          style={{
            padding: '32px 0',
            textAlign: 'center',
            color: 'var(--txt-mute)',
            fontSize: '0.82rem',
          }}
        >
          載入中…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            padding: '32px 0',
            textAlign: 'center',
            color: 'var(--txt-mute)',
            fontSize: '0.82rem',
          }}
        >
          無資料
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows.map((agg, i) => (
            <StockRow key={agg.code} agg={agg} direction={direction} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── MovesView (main export) ───────────────────────────────────────────────────

export default function MovesView() {
  const [data, setData] = useState<MovesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetch('/api/fund?moves=1', { signal: ac.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: MovesData) => {
        setData(d)
      })
      .catch(e => {
        if (e.name !== 'AbortError') setError(e.message ?? '載入失敗')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
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
            本期動向
          </h1>
        </div>

        {/* Period chip */}
        {data && (
          <div
            style={{
              alignSelf: 'center',
              border: '1px solid var(--accent)',
              borderRadius: 20,
              padding: '3px 12px',
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '0.78rem',
              color: 'var(--accent)',
              whiteSpace: 'nowrap',
            }}
          >
            {data.currPeriod} ← {data.prevPeriod}
          </div>
        )}
      </div>

      {/* Subtitle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--txt-dim)', margin: 0 }}>
          投信月報 Top10 本期 vs 上期持股變化，跨 13 檔基金聚合
        </p>
        {/* Caveat chip */}
        <span
          style={{
            display: 'inline-block',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '3px 10px',
            fontSize: '0.72rem',
            color: 'var(--txt-mute)',
            alignSelf: 'flex-start',
          }}
        >
          月頻資料（非每日）；ETF 每日動向待資料累積
        </span>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ color: 'var(--up)', fontSize: '0.85rem', padding: '16px 0' }}>
          載入失敗：{error}
        </div>
      )}

      {/* Two panels side by side — stacks to single column when container is narrow */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
          gap: 16,
          minWidth: 0,
        }}
      >
        <Panel
          title="加碼／新進"
          underlineColor="var(--up)"
          rows={data?.up ?? []}
          direction="up"
          loading={loading}
        />
        <Panel
          title="減碼／落榜"
          underlineColor="var(--down)"
          rows={data?.down ?? []}
          direction="down"
          loading={loading}
        />
      </div>
    </div>
  )
}
