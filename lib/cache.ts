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

// Rotating user agents to reduce fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}
