import { describe, it, expect } from 'vitest'
import { isAfterCutoff } from '../timegate'

describe('isAfterCutoff (台灣 18:30)', () => {
  it('18:29 → false', () => expect(isAfterCutoff(new Date('2026-05-27T10:29:00Z'))).toBe(false))
  it('18:30 → true', () => expect(isAfterCutoff(new Date('2026-05-27T10:30:00Z'))).toBe(true))
  it('22:00 → true', () => expect(isAfterCutoff(new Date('2026-05-27T14:00:00Z'))).toBe(true))
})
