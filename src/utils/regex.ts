/** Escape a user string for safe use inside a RegExp (prevents regex injection / ReDoS). */
export function safeRegex(input: unknown, flags = 'i'): RegExp {
  const escaped = String(input ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100)
  return new RegExp(escaped, flags)
}
