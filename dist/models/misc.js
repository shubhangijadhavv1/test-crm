"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = exports.Session = exports.Notification = void 0;
const mongoose_1 = require("mongoose");
// --- Notifications (Module 13) ---
const notificationSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, index: true },
    title: String,
    body: String,
    link: String,
    color: String, // ui hint: ok|info|warn|bad|brand
    read: { type: Boolean, default: false, index: true },
}, { timestamps: true });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
// --- Sessions (Module 1) ---
const sessionSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    device: String,
    userAgent: String,
    ip: String,
    refreshTokenHash: String,
    revoked: { type: Boolean, default: false },
    lastSeenAt: Date,
    expiresAt: { type: Date, index: true },
}, { timestamps: true });
// --- Audit logs (Module 1) — append only ---
const auditLogSchema = new mongoose_1.Schema({
    actorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: String,
    action: { type: String, index: true },
    targetType: String,
    targetId: { type: mongoose_1.Schema.Types.ObjectId, index: true },
    before: mongoose_1.Schema.Types.Mixed,
    after: mongoose_1.Schema.Types.Mixed,
    ip: String,
    branchId: mongoose_1.Schema.Types.ObjectId,
}, { timestamps: { createdAt: true, updatedAt: false } });
exports.Notification = (0, mongoose_1.model)('Notification', notificationSchema);
exports.Session = (0, mongoose_1.model)('Session', sessionSchema);
exports.AuditLog = (0, mongoose_1.model)('AuditLog', auditLogSchema);
//# sourceMappingURL=misc.js.map