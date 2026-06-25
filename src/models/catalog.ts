import { Schema, model } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const categorySchema = new Schema(
  {
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ...auditFields,
  },
  baseSchemaOptions
)

const subcategorySchema = new Schema(
  {
    name: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ...auditFields,
  },
  baseSchemaOptions
)

const websiteTypeSchema = new Schema(
  {
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    ...auditFields,
  },
  baseSchemaOptions
)

const serverSchema = new Schema(
  {
    name: { type: String, required: true },
    provider: String,
    type: { type: String, default: 'cloud' },
    region: String,
    status: { type: String, enum: ['ok', 'warning', 'down'], default: 'ok' },
    ...auditFields,
  },
  baseSchemaOptions
)

// Unique names among active (non-deleted) records; reusable after soft delete.
const activeOnly = { partialFilterExpression: { isDeleted: false } }
categorySchema.index({ name: 1 }, { unique: true, ...activeOnly })
subcategorySchema.index({ categoryId: 1, name: 1 }, { unique: true, ...activeOnly })
websiteTypeSchema.index({ name: 1 }, { unique: true, ...activeOnly })
serverSchema.index({ name: 1 }, { unique: true, ...activeOnly })

export const Category = model('Category', categorySchema)
export const Subcategory = model('Subcategory', subcategorySchema)
export const WebsiteType = model('WebsiteType', websiteTypeSchema)
export const ServerModel = model('Server', serverSchema)
