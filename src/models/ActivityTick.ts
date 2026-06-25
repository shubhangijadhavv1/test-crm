import { Schema, model, InferSchemaType } from 'mongoose'

/**
 * Raw per-heartbeat fact from the desktop agent (source of truth for recompute).
 * Counts only — never keystrokes (DPDP-friendly). The aggregation engine derives
 * Attendance.totals from these; they are recomputable, never hand-edited.
 */
const activityTickSchema = new Schema(
  {
    attendanceId: { type: Schema.Types.ObjectId, ref: 'Attendance', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    ts: { type: Date, required: true }, // agent-stamped (immune to upload delay)
    isIdle: { type: Boolean, default: false },
    state: { type: String, enum: ['active', 'idle', 'break'], default: 'active' },
    activeApp: String,
    activeTitle: String, // foreground window title
    activeUrl: String, // browser domain (hostname only — not full URL/content)
    keyCount: { type: Number, default: 0 }, // counts, not content
    mouseCount: { type: Number, default: 0 },
    agentVersion: String,
  },
  { timestamps: true }
)

activityTickSchema.index({ attendanceId: 1, ts: 1 })
activityTickSchema.index({ userId: 1, ts: 1 })

const screenshotSchema = new Schema(
  {
    attendanceId: { type: Schema.Types.ObjectId, ref: 'Attendance', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    ts: { type: Date, required: true },
    url: String,
    thumbnailUrl: String,
    blurred: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export type ActivityTickDoc = InferSchemaType<typeof activityTickSchema>
export const ActivityTick = model('ActivityTick', activityTickSchema)
export const Screenshot = model('Screenshot', screenshotSchema)
