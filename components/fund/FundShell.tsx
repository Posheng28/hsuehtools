'use client'
import { useState } from 'react'
import MovesView from './MovesView'
import StrategiesView from './StrategiesView'
import HoldingsView from './HoldingsView'

type SectionId = '01' | '02' | '03' | '04' | '05' | '06'

interface NavItem {
  id: SectionId
  index: string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: '01', index: '01', label: '動向' },
  { id: '02', index: '02', label: '持股' },
  { id: '03', index: '03', label: '雙軌' },
  { id: '04', index: '04', label: '策略' },
  { id: '05', index: '05', label: '經理人' },
  { id: '06', index: '06', label: '資金流' },
]

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
      }}
    >
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '48px 64px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--txt-dim)', marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--txt-mute)' }}>建置中</div>
      </div>
    </div>
  )
}

export default function FundShell() {
  const [section, setSection] = useState<SectionId>('01')

  function renderSection() {
    switch (section) {
      case '01': return <MovesView />
      case '02': return <HoldingsView />
      case '03': return <HoldingsView />
      case '04': return <StrategiesView />
      case '05': return <PlaceholderCard label="經理人" />
      case '06': return <PlaceholderCard label="資金流" />
    }
  }

  return (
    <div
      className="fund-term"
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--bg)',
        color: 'var(--txt)',
        fontFamily: 'inherit',
        overflow: 'hidden',
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 200,
          flexShrink: 0,
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Brand */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              color: 'var(--accent)',
              letterSpacing: '0.02em',
              fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
            }}
          >
            訊號台
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--txt-mute)', marginTop: 4 }}>
            投信持股動向
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {NAV_ITEMS.map(item => {
            const isActive = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 10px',
                  marginBottom: 2,
                  border: 'none',
                  borderLeft: isActive
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  borderRadius: '0 7px 7px 0',
                  background: isActive ? 'var(--accent-dim)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--txt-dim)',
                  fontSize: '0.85rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel2)'
                }}
                onMouseLeave={e => {
                  if (!isActive)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)',
                    fontSize: '0.72rem',
                    color: isActive ? 'var(--accent)' : 'var(--txt-mute)',
                    flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.index}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px 16px',
            borderTop: '1px solid var(--line)',
            fontSize: '0.66rem',
            color: 'var(--txt-mute)',
            lineHeight: 1.9,
          }}
        >
          <div>資料：投信投顧公會 月/季報</div>
          <div>月報 Top10・季報 ≥1%</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>v0.1.0</div>
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
  )
}
