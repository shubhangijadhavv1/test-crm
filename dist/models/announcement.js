"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnnouncementRead = exports.Announcement = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const announcementSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    body: String,
    priority: { type: String, enum: ['info', 'important', 'urgent'], default: 'info' },
    audience: {
        scope: { type: String, enum: ['all', 'branch', 'department', 'role', 'users'], default: 'all' },
        branchIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch' }],
        departments: [String],
        roles: [String],
        userIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'User' }],
    },
    pinned: { type: Boolean, default: false },
    requireAck: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'scheduled', 'published', 'archived'], default: 'published', index: true },
    publishAt: { type: Date, index: true },
    expiresAt: { type: Date, index: true },
    authorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    authorName: String,
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const announcementReadSchema = new mongoose_1.Schema({
    announcementId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Announcement', index: true },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    readAt: Date,
    acknowledgedAt: Date,
}, { timestamps: true });
announcementReadSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
exports.Announcement = (0, mongoose_1.model)('Announcement', announcementSchema);
exports.AnnouncementRead = (0, mongoose_1.model)('AnnouncementRead', announcementReadSchema);
//# sourceMappingURL=announcement.js.map