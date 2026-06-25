// Canonical module-access keys decided by Super Admin (shared meaning with the client).
export const MODULE_KEYS = [
  'dashboard', 'noticeBoard', 'projects', 'qa', 'tasks',
  'attendance', 'employees', 'performance', 'monitoring', 'config',
] as const
export type ModuleKey = (typeof MODULE_KEYS)[number]

const ALL = (v: boolean) => Object.fromEntries(MODULE_KEYS.map((k) => [k, v])) as Record<ModuleKey, boolean>

/** Sensible defaults per role when Super Admin doesn't specify. */
export function defaultModuleAccess(role: string): Record<ModuleKey, boolean> {
  if (role === 'superadmin') return ALL(true)
  if (role === 'admin') {
    return { ...ALL(true), monitoring: false } // admin: broad, no monitoring by default
  }
  // employee: limited self-service set
  return {
    ...ALL(false),
    noticeBoard: true,
    attendance: true,
    tasks: true,
    qa: true,
  }
}

/** Normalise an arbitrary access object to the known keys. */
export function sanitizeModuleAccess(input: unknown): Record<ModuleKey, boolean> {
  const obj = (input || {}) as Record<string, unknown>
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, !!obj[k]])) as Record<ModuleKey, boolean>
}
