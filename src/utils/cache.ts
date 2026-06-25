/**
 * Tiny in-memory TTL cache for read snapshots (e.g. dashboard).
 * Single-instance friendly and dependency-free; swap the get/set/clear bodies
 * for Redis (ioredis) when running multiple instances — call sites stay the same.
 */
type Entry = { value: unknown; expires: number }
const store = new Map<string, Entry>()

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key)
  if (!e) return undefined
  if (Date.now() > e.expires) { store.delete(key); return undefined }
  return e.value as T
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs })
}

/** Clear everything, or only keys starting with `prefix`. */
export function cacheClear(prefix?: string): void {
  if (!prefix) { store.clear(); return }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}
