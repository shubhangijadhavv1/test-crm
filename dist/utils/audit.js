"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = audit;
const misc_1 = require("../models/misc");
/** Append a sensitive-action record (Blueprint M1 §6 — append-only). */
async function audit(actor, action, targetType, targetId, opts) {
    try {
        await misc_1.AuditLog.create({
            actorId: actor?.id,
            actorRole: actor?.role,
            action,
            targetType,
            targetId,
            before: opts?.before,
            after: opts?.after,
            ip: opts?.ip,
            branchId: actor?.branchId || undefined,
        });
    }
    catch {
        /* never let audit failure break the request */
    }
}
//# sourceMappingURL=audit.js.map