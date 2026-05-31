// lib/disposal/__tests__/noticeLevel.test.ts
import { describe, it, expect } from 'vitest'
import { classifyNoticeLevel } from '@/lib/disposal/noticeLevel'

// 真實注意文字節錄（3042 晶技，2026/05；對照官方注意交易資訊表）
// 處置計數「任一款」依 FL007225 第6條第1項第2款 = 第一款～第八款；款九~十四（如第十三款當沖）不計入。
describe('classifyNoticeLevel', () => {
  it('含第一款 → 1（計入規則①與②③④）', () => {
    // 05/28：六日漲幅40.32% 且起迄價差57.50元（第一款）
    expect(classifyNoticeLevel('最近六個營業日累積收盤價漲幅達40.32%。且六個營業日起迄兩個營業日收盤價價差達57.50元（第一款）。')).toBe(1)
  })

  it('款二~款八（無第一款）→ 2（只計入規則②③④）', () => {
    // 05/29：六日漲幅31.31% 且週轉率14.71%（第四款）
    expect(classifyNoticeLevel('最近六個營業日累積收盤價漲幅達31.31%。且05月29日之週轉率為14.71%（第四款）。')).toBe(2)
    expect(classifyNoticeLevel('（第三款）')).toBe(2)
    expect(classifyNoticeLevel('（第八款）')).toBe(2)
  })

  it('僅第十三款（當日沖銷）→ 0（不計入任何處置規則）', () => {
    // 05/25：當日沖銷成交量占比（第十三款）— 屬款九~十四，不在「第一款至第八款」內
    expect(classifyNoticeLevel('05月22日之最近六個營業日之當日沖銷成交量占最近六個營業日總成交量比率61.04%，且05月22日當日沖銷成交量占該日總成交量比率62.04%（第十三款）。')).toBe(0)
  })

  it('其他款九~十四皆 → 0', () => {
    expect(classifyNoticeLevel('（第九款）')).toBe(0)
    expect(classifyNoticeLevel('（第十款）')).toBe(0)
    expect(classifyNoticeLevel('（第十一款）')).toBe(0)
    expect(classifyNoticeLevel('（第十二款）')).toBe(0)
    expect(classifyNoticeLevel('（第十四款）')).toBe(0)
  })

  it('混款取最高優先：第一款 > 款二~八 > 款九~十四', () => {
    // 同時含第一款與第十三款 → 1（有可計入的第一款）
    expect(classifyNoticeLevel('…（第一款）。…（第十三款）。')).toBe(1)
    // 含第三款與第十三款（無第一款）→ 2（有可計入的第三款）
    expect(classifyNoticeLevel('…（第三款）。…（第十三款）。')).toBe(2)
  })

  it('無可辨識款別 → 保守當 2（沿用舊行為，避免漏算）', () => {
    expect(classifyNoticeLevel('')).toBe(2)
    expect(classifyNoticeLevel('最近六個營業日累積收盤價漲幅達25%。')).toBe(2)
  })

  it('第十一款不可誤判為第一款（子字串陷阱）', () => {
    expect(classifyNoticeLevel('（第十一款）')).not.toBe(1)
  })
})
