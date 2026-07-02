"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Holiday = exports.Branch = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const branchSchema = new mongoose_1.Schema({
    name: { type: String, required: true, index: true },
    code: String,
    timezone: { type: String, default: 'Asia/Kolkata' },
    shift: {
        startTime: { type: String, default: '09:00' },
        endTime: { type: String, default: '18:00' },
        graceMinutes: { type: Number, default: 15 },
    },
    breaks: {
        lunchMinutes: { type: Number, default: 45 },
        teaMinutes: { type: Number, default: 15 },
        // Break billing: 'B' = allowed breaks are paid, only overage penalised (default);
        // 'A' = every break minute is unpaid. (Agent work-time engine.)
        billingModel: { type: String, enum: ['A', 'B'], default: 'B' },
    },
    // Idle / half-day / screenshot settings for the desktop agent's work-time engine.
    monitoring: {
        // Idle threshold in SECONDS — how long with no keyboard/mouse before time counts as idle.
        // Kept in seconds (not minutes) so short, responsive thresholds like 10s are expressible.
        idleThresholdSeconds: { type: Number, default: 10 },
        idleThresholdMinutes: { type: Number, default: 5 }, // legacy; superseded by idleThresholdSeconds
        halfDayAfterMinutes: { type: Number, default: 0 }, // 0 = disabled
        screenshotIntervalMinutes: { type: Number, default: 10 },
    },
    // Branch-specific weekend policy (manually pick which Saturdays are off).
    weekend: {
        sundayOff: { type: Boolean, default: true },
        // ordinal Saturdays of the month that are off, e.g. [2,4] = 2nd & 4th Sat
        saturdayWeeks: { type: [Number], default: [] },
    },
    leaveAllocation: {
        paid: { type: Number, default: 24 },
        sick: { type: Number, default: 6 },
        casual: { type: Number, default: 6 },
    },
    isActive: { type: Boolean, default: true },
    // Branch-wide IP allowlist — applies to everyone in the branch (union with per-user IPs).
    allowedIps: { type: [String], default: [] },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const holidaySchema = new mongoose_1.Schema({
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    date: { type: Date, index: true },
    name: String,
    type: { type: String, enum: ['public', 'optional'], default: 'public' },
}, { timestamps: true });
exports.Branch = (0, mongoose_1.model)('Branch', branchSchema);
exports.Holiday = (0, mongoose_1.model)('Holiday', holidaySchema);
//# sourceMappingURL=Branch.js.map