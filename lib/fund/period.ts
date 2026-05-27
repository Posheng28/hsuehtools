// JOY88 period 'YYYYMM' (monthly = that month; quarterly = quarter-end month 03/06/09/12) → our format
export function joyPeriod(p: string, reportType: 'monthly' | 'quarterly'): string {
  const y = p.slice(0, 4), m = p.slice(4, 6)
  if (reportType === 'monthly') return `${y}-${m}`
  const q = { '03': 1, '06': 2, '09': 3, '12': 4 }[m]
  if (!q) throw new Error(`非季末月: ${p}`)
  return `${y}-Q${q}`
}
