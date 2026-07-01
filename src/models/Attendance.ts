import { Schema, model } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const attendanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
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
      workSeconds: { type: Number, default: 0 }, // = net productive
      idleSeconds: { type: Number, default: 0 }, // exact pure idle (to the second)
      lunchSeconds: { type: Number, default: 0 }, // counted lunch (within allowance)
      teaSeconds: { type: Number, default: 0 }, // counted tea (within allowance)
      productiveSeconds: { type: Number, default: 0 }, // = net productive
      // Net Productive Hours model (engine.productiveTotals) — read live by dashboards.
      requiredSeconds: { type: Number, default: 0 }, // shift − allowed breaks
      remainingSeconds: { type: Number, default: 0 }, // required − net productive
      overtimeSeconds: { type: Number, default: 0 }, // net productive beyond required
      completionPct: { type: Number, default: 0 },
      shiftLenSeconds: { type: Number, default: 0 },
      actualLunchSeconds: { type: Number, default: 0 },
      actualTeaSeconds: { type: Number, default: 0 },
      allowedLunchSeconds: { type: Number, default: 0 },
      allowedTeaSeconds: { type: Number, default: 0 },
      extraLunchSeconds: { type: Number, default: 0 },
      extraTeaSeconds: { type: Number, default: 0 },
      extraBreakSeconds: { type: Number, default: 0 },
      expectedLogout: { type: Date },
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
    // Super-admin manual override of a day's record (correction). overrideNote explains why.
    overridden: { type: Boolean, default: false },
    overrideNote: { type: String, default: '' },
    source: { type: String, enum: ['web', 'agent'], default: 'web' },
    autoClosed: { type: Boolean, default: false },
    // Latest agent permission status (so the CRM can flag "permission not given").
    agentPermissions: {
      screen: { type: String, enum: ['granted', 'denied', 'restricted', 'not-determined', 'unknown'], default: 'unknown' },
      accessibility: { type: Boolean, default: false },
      at: Date,
    },
    ...auditFields,
  },
  baseSchemaOptions
)

attendanceSchema.index({ userId: 1, date: 1 }, { unique: true })
attendanceSchema.index({ branchId: 1, date: 1 })

export const Attendance = model('Attendance', attendanceSchema)
