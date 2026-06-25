import { Schema, model } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

const announcementSchema = new Schema(
  {
    title: { type: String, required: true },
    body: String,
    priority: { type: String, enum: ['info', 'important', 'urgent'], default: 'info' },
    audience: {
      scope: { type: String, enum: ['all', 'branch', 'department', 'role', 'users'], default: 'all' },
      branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
      departments: [String],
      roles: [String],
      userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    pinned: { type: Boolean, default: false },
    requireAck: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'scheduled', 'published', 'archived'], default: 'published', index: true },
    publishAt: { type: Date, index: true },
    expiresAt: { type: Date, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    authorName: String,
    ...auditFields,
  },
  baseSchemaOptions
)

const announcementReadSchema = new Schema(
  {
    announcementId: { type: Schema.Types.ObjectId, ref: 'Announcement', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    readAt: Date,
    acknowledgedAt: Date,
  },
  { timestamps: true }
)
announcementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true })

export const Announcement = model('Announcement', announcementSchema)
export const AnnouncementRead = model('AnnouncementRead', announcementReadSchema)
