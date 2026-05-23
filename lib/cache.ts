// Server-side in-memory cache with TTL to reduce API calls and avoid rate limiting

interface CacheEntry {
  data: unknown
  expiry: number
}

const store = new Map<string, CacheEntry>()

export function getCached(key: string): unknown | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    store.delete(key)
    return null
  }
  return entry.data
}

export function setCached(key: string, data: unknown, ttlMs = 30 * 60 * 1000): void {
  store.set(key, { data, expiry: Date.now() + ttlMs })
}

export function deleteCachePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

// Per-source request throttle: enforce minimum interval between calls
const lastRequestTime: Record<string, number> = {}

export async function throttle(source: string, minMs = 600, jitterMs = 400): Promise<void> {
  const now = Date.now()
  const last = lastRequestTime[source] ?? 0
  const elapsed = now - last
  const wait = minMs + Math.random() * jitterMs - elapsed
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestTime[source] = Date.now()
}
