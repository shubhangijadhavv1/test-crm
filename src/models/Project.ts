import { Schema, model, InferSchemaType } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const projectSchema = new Schema(
  {
    projectCode: { type: String },
    type: { type: String, enum: ['live', 'demo'], required: true, index: true },
    name: { type: String, required: true },
    url: String,
    clientName: String,
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    subCategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', index: true },
    websiteTypeId: { type: Schema.Types.ObjectId, ref: 'WebsiteType', index: true },
    serverId: { type: Schema.Types.ObjectId, ref: 'Server', index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['pending', 'development', 'qa', 'revision', 'completed', 'onhold', 'live', 'finished', 'domain_transfer'],
      default: 'pending',
      index: true,
    },
    qaProgress: { type: Number, default: 0, min: 0, max: 100 },
    startDate: Date,
    dueDate: { type: Date, index: true },
    completedAt: Date,
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
    notes: String,
    isOverdue: { type: Boolean, default: false },
    ...auditFields,
  },
  baseSchemaOptions
)

projectSchema.index({ type: 1, status: 1 })
projectSchema.index({ projectCode: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } })

export type ProjectDoc = InferSchemaType<typeof projectSchema>
export const Project = model('Project', projectSchema)

// Allowed status transitions (Blueprint M3 §6 state machine).
// LIVE projects go through the mandatory QA gate.
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['development', 'onhold'],
  development: ['qa', 'onhold'],
  qa: ['revision', 'completed', 'onhold'],
  revision: ['qa', 'development', 'onhold'],
  onhold: ['pending', 'development', 'qa'],
  completed: ['revision'],
}

// DEMO projects skip QA entirely (QA is only required for live projects).
export const DEMO_TRANSITIONS: Record<string, string[]> = {
  pending: ['development', 'onhold'],
  development: ['completed', 'revision', 'onhold'],
  revision: ['development', 'completed', 'onhold'],
  onhold: ['pending', 'development'],
  completed: ['revision'],
}
