"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Attendance = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const attendanceSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    date: { type: String, index: true }, // YYYY-MM-DD (shift-start date)
    loginAt: Date,
    logoutAt: Date,
    workMode: { type: String, enum: ['office', 'wfh', 'hybrid'], default: 'office' },
    segments: [
        {
            type: { type: String, enum: ['work', 'idle', 'lunch', 'tea'] },
            startAt: Date,
            endAt: Date,
            seconds: Number,
        },
    ],
    totals: {
        workSeconds: { type: Number, default: 0 },
        idleSeconds: { type: Number, default: 0 },
        lunchSeconds: { type: Number, default: 0 },
        teaSeconds: { type: Number, default: 0 },
        productiveSeconds: { type: Number, default: 0 },
    },
    lateMark: { type: Boolean, default: false },
    lateBySeconds: { type: Number, default: 0 },
    // Instant activity state pushed by the agent on each transition → exact, to-the-second live idle.
    liveState: {
        state: { type: String, enum: ['active', 'idle', 'break'], default: 'active' },
        since: Date, // when the current state began (server-stamped)
        idleStartedAt: Date, // exact idle-start from powerMonitor (agent-stamped)
    },
    status: { type: String, enum: ['present', 'absent', 'leave', 'holiday', 'weekoff'], default: 'present' },
    source: { type: String, enum: ['web', 'agent'], default: 'web' },
    autoClosed: { type: Boolean, default: false },
    // Latest agent permission status (so the CRM can flag "permission not given").
    agentPermissions: {
        screen: { type: String, enum: ['granted', 'denied', 'restricted', 'not-determined', 'unknown'], default: 'unknown' },
        accessibility: { type: Boolean, default: false },
        at: Date,
    },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ branchId: 1, date: 1 });
exports.Attendance = (0, mongoose_1.model)('Attendance', attendanceSchema);
//# sourceMappingURL=Attendance.js.map