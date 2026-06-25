import { Schema, Types } from 'mongoose'

/** Audit fields present on every collection (Blueprint A4). */
export const auditFields = {
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date },
}

export const baseSchemaOptions = {
  timestamps: true, // createdAt, updatedAt
  versionKey: 'version' as const, // optimistic concurrency (Blueprint D1.8)
}

export type Ref = Types.ObjectId
