import { Request } from 'express'

/**
 * Optimistic concurrency (Blueprint D1.8). If the client sends `If-Match: <version>`,
 * return a filter fragment that only matches when the document is still at that version.
 * Combine with `$inc: { version: 1 }` on update; a non-match → treat as a 409 conflict.
 */
export function versionFilter(req: Request): { version?: number } {
  const m = req.headers['if-match']
  if (m === undefined || m === '' || m === '*') return {}
  const n = Number(Array.isArray(m) ? m[0] : m)
  return Number.isNaN(n) ? {} : { version: n }
}

export function hasIfMatch(req: Request): boolean {
  const m = req.headers['if-match']
  return m !== undefined && m !== '' && m !== '*' && !Number.isNaN(Number(m))
}
