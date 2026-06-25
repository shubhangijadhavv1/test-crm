import { Schema, model } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const checklistTemplateSchema = new Schema(
  {
    category: { type: String, index: true },
    name: String,
    color: String,
    items: [
      {
        text: String,
        appliesTo: { type: String, enum: ['both', 'c1', 'c2'], default: 'both' },
        order: Number,
      },
    ],
    isActive: { type: Boolean, default: true },
    ...auditFields,
  },
  baseSchemaOptions
)

// Category/subcategory-scoped checklist points that seed a project's QA checklists.
// subCategoryId null/absent = applies to all subcategories of the category.
const checklistPointSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    subCategoryId: { type: Schema.Types.ObjectId, ref: 'Subcategory', index: true },
    text: { type: String, required: true },
    appliesTo: { type: String, enum: ['both', 'c1', 'c2'], default: 'both' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    ...auditFields,
  },
  baseSchemaOptions
)

const stageItem = {
  templateItemId: Schema.Types.ObjectId,
  text: String,
  checked: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'pass', 'fail', 'na'], default: 'pending' },
  failComment: String,
  checkedAt: Date,
}

const stageSchema = {
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['notstarted', 'inprogress', 'done', 'failed'], default: 'notstarted' },
  items: [stageItem],
  progress: { type: Number, default: 0 },
  completedAt: Date,
}

const qaProcessSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
    stage1: stageSchema,
    stage2: stageSchema,
    state: {
      type: String,
      enum: ['stage1', 'stage2_locked', 'stage2_ready', 'stage2_inprogress', 'passed'],
      default: 'stage1',
      index: true,
    },
    failures: [
      {
        stage: Number,
        text: String,
        comment: String,
        reviewerId: Schema.Types.ObjectId,
        at: Date,
      },
    ],
    ...auditFields,
  },
  baseSchemaOptions
)

// one QA process per project, reusable after soft delete
qaProcessSchema.index({ projectId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } })

export const ChecklistTemplate = model('ChecklistTemplate', checklistTemplateSchema)
export const ChecklistPoint = model('ChecklistPoint', checklistPointSchema)
export const QaProcess = model('QaProcess', qaProcessSchema)
