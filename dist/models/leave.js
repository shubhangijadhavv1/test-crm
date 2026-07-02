"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeaveBalance = exports.LeaveRequest = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const leaveRequestSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch' },
    type: { type: String, enum: ['paid', 'sick', 'casual', 'halfday'], required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    days: { type: Number, default: 1 },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
leaveRequestSchema.index({ userId: 1, status: 1 });
const leaveBalanceSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    year: Number,
    allocated: { paid: Number, sick: Number, casual: Number },
    used: { paid: { type: Number, default: 0 }, sick: { type: Number, default: 0 }, casual: { type: Number, default: 0 } },
    pending: { paid: { type: Number, default: 0 }, sick: { type: Number, default: 0 }, casual: { type: Number, default: 0 } },
}, { timestamps: true });
leaveBalanceSchema.index({ userId: 1, year: 1 }, { unique: true });
exports.LeaveRequest = (0, mongoose_1.model)('LeaveRequest', leaveRequestSchema);
exports.LeaveBalance = (0, mongoose_1.model)('LeaveBalance', leaveBalanceSchema);
//# sourceMappingURL=leave.js.map