import { Schema, model, InferSchemaType } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const taskSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    projectName: String, // denormalised label (prototype shows the short name)
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    difficulty: { type: Number, min: 1, max: 5, default: 2 },
    status: { type: String, enum: ['todo', 'inprogress', 'done', 'overdue'], default: 'todo', index: true },
    dueAt: { type: Date, index: true },
    timer: {
      running: { type: Boolean, default: false },
      startedAt: Date,
      accumulatedSeconds: { type: Number, default: 0 },
    },
    actualSeconds: { type: Number, default: 0 },
    completedAt: Date,
    reminderSentAt: Date, // T-24h deadline reminder guard (one per task)
    source: { type: String, enum: ['manual', 'checklist'], default: 'manual' },
    linkedQaId: { type: Schema.Types.ObjectId, ref: 'QaProcess' },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    ...auditFields,
  },
  baseSchemaOptions
)

taskSchema.index({ assigneeId: 1, status: 1 })
taskSchema.index({ status: 1, dueAt: 1 })

export type TaskDoc = InferSchemaType<typeof taskSchema>
export const Task = model('Task', taskSchema)
