import { Schema, model } from 'mongoose'

// --- Notifications (Module 13) ---
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, index: true },
    title: String,
    body: String,
    link: String,
    color: String, // ui hint: ok|info|warn|bad|brand
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)
notificationSchema.index({ userId: 1, read: 1 })
notificationSchema.index({ userId: 1, createdAt: -1 })

// --- Sessions (Module 1) ---
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    device: String,
    userAgent: String,
    ip: String,
    refreshTokenHash: String,
    revoked: { type: Boolean, default: false },
    lastSeenAt: Date,
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true }
)

// --- Audit logs (Module 1) — append only ---
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: String,
    action: { type: String, index: true },
    targetType: String,
    targetId: { type: Schema.Types.ObjectId, index: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    branchId: Schema.Types.ObjectId,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

export const Notification = model('Notification', notificationSchema)
export const Session = model('Session', sessionSchema)
export const AuditLog = model('AuditLog', auditLogSchema)
