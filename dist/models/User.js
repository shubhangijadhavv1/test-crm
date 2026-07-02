"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const permissionActions = { view: Boolean, create: Boolean, edit: Boolean, delete: Boolean };
const userSchema = new mongoose_1.Schema({
    employeeId: { type: String },
    fullName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['superadmin', 'admin', 'employee'], default: 'employee', index: true },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    department: String,
    designation: String,
    workMode: { type: String, enum: ['office', 'wfh', 'hybrid'], default: 'office' },
    workModePermission: { type: String, enum: ['office', 'wfh', 'hybrid'], default: 'office' },
    permissions: {
        projects: permissionActions,
        tasks: { ...permissionActions, assignScope: { type: String, enum: ['none', 'team', 'branch'], default: 'none' } },
        qa: permissionActions,
        attendance: permissionActions,
        reports: permissionActions,
        monitoring: permissionActions,
    },
    security: {
        twoFactorEnabled: { type: Boolean, default: false },
        twoFactorSecret: { type: String, select: false },
        ipAllowList: [String],
        failedLoginCount: { type: Number, default: 0 },
        lockedUntil: Date,
        lastPasswordChangeAt: Date,
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    avatarColor: String,
    // Manual behaviour rating (0–100) set by managers; feeds the performance score.
    behaviourScore: { type: Number, min: 0, max: 100, default: 75 },
    // IP allowlist — if non-empty, the employee can only log in from these IPs.
    allowedIps: { type: [String], default: [] },
    // Whether the employee may punch in/out from the web (My Workspace). Off → desktop agent only.
    webPunchEnabled: { type: Boolean, default: true },
    // Per-user module visibility/access decided by Super Admin (Blueprint A3).
    // Super Admin ignores this (full access). Keys map to nav module groups.
    moduleAccess: {
        dashboard: { type: Boolean, default: false },
        noticeBoard: { type: Boolean, default: true },
        projects: { type: Boolean, default: false },
        qa: { type: Boolean, default: false },
        tasks: { type: Boolean, default: false },
        attendance: { type: Boolean, default: true },
        employees: { type: Boolean, default: false },
        performance: { type: Boolean, default: false },
        monitoring: { type: Boolean, default: false },
        config: { type: Boolean, default: false },
    },
    // Derived/denormalised fields used by the prototype's UI.
    perf: { type: Number, default: 0 },
    qaScore: { type: Number, default: 0 },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
// Partial-unique: a value must be unique among non-deleted users, but can be reused
// after a soft delete (Blueprint D2.1).
const activeOnly = { partialFilterExpression: { isDeleted: false } };
userSchema.index({ email: 1 }, { unique: true, ...activeOnly });
userSchema.index({ employeeId: 1 }, { unique: true, ...activeOnly });
exports.User = (0, mongoose_1.model)('User', userSchema);
//# sourceMappingURL=User.js.map