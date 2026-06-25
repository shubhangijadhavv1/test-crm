import { Schema, model } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const leaveRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    type: { type: String, enum: ['paid', 'sick', 'casual', 'halfday'], required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    days: { type: Number, default: 1 },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: String,
    ...auditFields,
  },
  baseSchemaOptions
)
leaveRequestSchema.index({ userId: 1, status: 1 })

const leaveBalanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    year: Number,
    allocated: { paid: Number, sick: Number, casual: Number },
    used: { paid: { type: Number, default: 0 }, sick: { type: Number, default: 0 }, casual: { type: Number, default: 0 } },
    pending: { paid: { type: Number, default: 0 }, sick: { type: Number, default: 0 }, casual: { type: Number, default: 0 } },
  },
  { timestamps: true }
)
leaveBalanceSchema.index({ userId: 1, year: 1 }, { unique: true })

export const LeaveRequest = model('LeaveRequest', leaveRequestSchema)
export const LeaveBalance = model('LeaveBalance', leaveBalanceSchema)
