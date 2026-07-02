"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const announcement_1 = require("../models/announcement");
const User_1 = require("../models/User");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const socket_1 = require("../realtime/socket");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
/** Does this user match an announcement's audience? (server-side scoping, M15 §10) */
function matchesAudience(a, user) {
    const aud = a.audience;
    if (!aud || aud.scope === 'all')
        return true;
    if (aud.scope === 'branch')
        return (aud.branchIds || []).map(String).includes(String(user.branchId));
    if (aud.scope === 'role')
        return (aud.roles || []).includes(user.role);
    if (aud.scope === 'department')
        return !!user.department && (aud.departments || []).includes(user.department);
    if (aud.scope === 'users')
        return (aud.userIds || []).map(String).includes(user.id);
    return false;
}
// GET /announcements — targeted feed (admins see all)
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const me = await User_1.User.findById(req.user.id).select('role branchId department').lean();
    const all = await announcement_1.Announcement.find({ isDeleted: false, status: 'published' }).sort({ pinned: -1, createdAt: -1 }).lean();
    const isAdmin = req.user.role !== 'employee';
    const visible = isAdmin ? all : all.filter(a => matchesAudience(a, { id: req.user.id, role: req.user.role, branchId: req.user.branchId, department: me?.department }));
    const reads = await announcement_1.AnnouncementRead.find({ userId: req.user.id }).lean();
    const readMap = new Map(reads.map(r => [String(r.announcementId), r]));
    (0, http_1.ok)(res, visible.map(a => {
        const r = readMap.get(String(a._id));
        return { ...a, read: !!r?.readAt, acked: !!r?.acknowledgedAt };
    }));
}));
const createBody = zod_1.z.object({
    title: zod_1.z.string().min(1),
    body: zod_1.z.string().optional(),
    priority: zod_1.z.enum(['info', 'important', 'urgent']).optional(),
    pinned: zod_1.z.boolean().optional(),
    requireAck: zod_1.z.boolean().optional(),
    audience: zod_1.z.object({
        scope: zod_1.z.enum(['all', 'branch', 'department', 'role', 'users']),
        branchIds: zod_1.z.array(zod_1.z.string()).optional(),
        departments: zod_1.z.array(zod_1.z.string()).optional(),
        roles: zod_1.z.array(zod_1.z.string()).optional(),
        userIds: zod_1.z.array(zod_1.z.string()).optional(),
    }).optional(),
});
router.post('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(createBody), (0, http_1.asyncHandler)(async (req, res) => {
    const me = await User_1.User.findById(req.user.id).lean();
    const doc = await announcement_1.Announcement.create({
        ...req.body,
        status: 'published',
        publishAt: new Date(),
        authorId: req.user.id,
        authorName: me?.fullName,
        createdBy: req.user.id,
    });
    await (0, audit_1.audit)(req.user, 'announcement.publish', 'Announcement', doc._id);
    (0, socket_1.emitAll)('announcement:new', { id: doc._id, title: doc.title });
    (0, http_1.created)(res, doc);
}));
router.post('/:id/read', (0, http_1.asyncHandler)(async (req, res) => {
    await announcement_1.AnnouncementRead.findOneAndUpdate({ announcementId: req.params.id, userId: req.user.id }, { $setOnInsert: { readAt: new Date() } }, { upsert: true, new: true });
    (0, http_1.ok)(res, { read: true });
}));
router.post('/:id/ack', (0, http_1.asyncHandler)(async (req, res) => {
    const now = new Date();
    await announcement_1.AnnouncementRead.findOneAndUpdate({ announcementId: req.params.id, userId: req.user.id }, { readAt: now, acknowledgedAt: now }, { upsert: true, new: true });
    (0, http_1.ok)(res, { acknowledged: true });
}));
router.get('/:id/receipts', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const reads = await announcement_1.AnnouncementRead.find({ announcementId: req.params.id }).populate('userId', 'fullName').lean();
    (0, http_1.ok)(res, { reads, readCount: reads.filter(r => r.readAt).length, ackCount: reads.filter(r => r.acknowledgedAt).length });
}));
router.delete('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await announcement_1.Announcement.findByIdAndUpdate(req.params.id, { isDeleted: true, status: 'archived' }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Announcement not found');
    await (0, audit_1.audit)(req.user, 'announcement.delete', 'Announcement', doc._id);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=announcements.js.map