import { AuditLog } from '../models/misc'
import { AuthUser } from '../middleware/auth'

/** Append a sensitive-action record (Blueprint M1 §6 — append-only). */
export async function audit(
  actor: AuthUser | undefined,
  action: string,
  targetType: string,
  targetId: unknown,
  opts?: { before?: unknown; after?: unknown; ip?: string }
) {
  try {
    await AuditLog.create({
      actorId: actor?.id,
      actorRole: actor?.role,
      action,
      targetType,
      targetId,
      before: opts?.before,
      after: opts?.after,
      ip: opts?.ip,
      branchId: actor?.branchId || undefined,
    })
  } catch {
    /* never let audit failure break the request */
  }
}
