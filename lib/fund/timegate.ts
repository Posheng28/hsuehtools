// Taiwan is fixed UTC+8 (no DST). After 18:30 the day's data is finalized.
export function isAfterCutoff(now: Date = new Date(), cutoffMin = 18 * 60 + 30): boolean {
  const tst = new Date(now.getTime() + 8 * 3600 * 1000)
  const min = tst.getUTCHours() * 60 + tst.getUTCMinutes()
  return min >= cutoffMin
}
