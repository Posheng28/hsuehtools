import { describe, it, expect } from 'vitest'
import { joyPeriod } from '../period'

describe('joyPeriod', () => {
  it('月報 202604 → 2026-04', () => expect(joyPeriod('202604', 'monthly')).toBe('2026-04'))
  it('季報 202603 → 2026-Q1', () => expect(joyPeriod('202603', 'quarterly')).toBe('2026-Q1'))
  it('季報 202606 → 2026-Q2', () => expect(joyPeriod('202606', 'quarterly')).toBe('2026-Q2'))
  it('季報 202612 → 2026-Q4', () => expect(joyPeriod('202612', 'quarterly')).toBe('2026-Q4'))
})
