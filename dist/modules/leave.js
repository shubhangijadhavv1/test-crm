"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const leave_1 = require("../models/leave");
const User_1 = require("../models/User");
const Branch_1 = require("../models/Branch");
const Attendance_1 = require("../models/Attendance");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const notify_1 = require("../utils/notify");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
function daysBetween(from, to, half) {
    if (half)
        return 0.5;
    return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
}
// half-day is counted against the casual bucket
const balKey = (type) => (type === 'halfday' ? 'casual' : type);
/** Ensure a yearly balance doc exists (seeded from branch allocation). */
async function ensureBalance(userId, year, branchId) {
    const existing = await leave_1.LeaveBalance.findOne({ userId, year });
    if (existing)
        return existing;
    const branch = branchId ? await Branch_1.Branch.findById(branchId).lean() : null;
    return leave_1.LeaveBalance.create({ userId, year, allocated: branch?.leaveAllocation || { paid: 24, sick: 6, casual: 6 } });
}
/** All YYYY-MM-DD dates in an inclusive range (UTC, timezone-safe). */
function eachDate(from, to) {
    const out = [];
    let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    while (d <= end) {
        out.push(new Date(d).toISOString().slice(0, 10));
        d += 86400000;
    }
    return out;
}
const applyBody = zod_1.z.object({
    type: zod_1.z.enum(['paid', 'sick', 'casual', 'halfday']),
    fromDate: zod_1.z.coerce.date(),
    toDate: zod_1.z.coerce.date(),
    reason: zod_1.z.string().optional(),
});
// POST /leaves — apply
router.post('/', (0, validate_1.validate)(applyBody), (0, http_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    if (body.toDate < body.fromDate)
        throw ApiError_1.ApiError.badRequest('toDate must be on or after fromDate');
    const days = daysBetween(body.fromDate, body.toDate, body.type === 'halfday');
    const user = await User_1.User.findById(req.user.id).lean();
    const doc = await leave_1.LeaveRequest.create({
        userId: req.user.id, branchId: user?.branchId, type: body.type,
        fromDate: body.fromDate, toDate: body.toDate, days, reason: body.reason, status: 'pending', createdBy: req.user.id,
    });
    // hold the days against the pending balance
    const year = body.fromDate.getFullYear();
    await ensureBalance(req.user.id, year, user?.branchId);
    await leave_1.LeaveBalance.updateOne({ userId: req.user.id, year }, { $inc: { [`pending.${balKey(body.type)}`]: days } });
    // notify managers of the same branch
    const managers = await User_1.User.find({ role: { $in: ['admin', 'superadmin'] }, isDeleted: false }).select('_id').lean();
    await Promise.all(managers.map(m => (0, notify_1.notify)(String(m._id), { type: 'leave.requested', title: 'Leave request', body: `${user?.fullName} requested ${days} day(s) ${body.type}`, color: 'info' })));
    await (0, audit_1.audit)(req.user, 'leave.apply', 'LeaveRequest', doc._id);
    (0, http_1.created)(res, doc);
}));
// GET /leaves/me — own balance + history
router.get('/me', (0, http_1.asyncHandler)(async (req, res) => {
    const year = new Date().getFullYear();
    const user = await User_1.User.findById(req.user.id).lean();
    let balance = await leave_1.LeaveBalance.findOne({ userId: req.user.id, year }).lean();
    if (!balance) {
        const branch = user?.branchId ? await Branch_1.Branch.findById(user.branchId).lean() : null;
        const alloc = branch?.leaveAllocation || { paid: 24, sick: 6, casual: 6 };
        balance = (await leave_1.LeaveBalance.create({ userId: req.user.id, year, allocated: alloc })).toObject();
    }
    const history = await leave_1.LeaveRequest.find({ userId: req.user.id, isDeleted: false }).sort({ createdAt: -1 }).lean();
    (0, http_1.ok)(res, { balance, history });
}));
// GET /leaves?status=pending — manager inbox
router.get('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.status)
        filter.status = req.query.status;
    if (req.user.role !== 'superadmin' && req.user.branchId)
        filter.branchId = req.user.branchId;
    const rows = await leave_1.LeaveRequest.find(filter).populate('userId', 'fullName department avatarColor').sort({ createdAt: -1 }).lean();
    (0, http_1.ok)(res, rows);
}));
// PATCH /leaves/:id/decision — approve/reject
const decisionBody = zod_1.z.object({ decision: zod_1.z.enum(['approved', 'rejected']), note: zod_1.z.string().optional() });
router.patch('/:id/decision', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(decisionBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { decision, note } = req.body;
    const lr = await leave_1.LeaveRequest.findById(req.params.id);
    if (!lr)
        throw ApiError_1.ApiError.notFound('Leave request not found');
    if (lr.status !== 'pending')
        throw ApiError_1.ApiError.conflict('Leave request already decided');
    lr.status = decision;
    lr.decidedBy = req.user.id;
    lr.decidedAt = new Date();
    lr.decisionNote = note;
    await lr.save();
    const year = new Date(lr.fromDate).getFullYear();
    const key = balKey(lr.type);
    if (decision === 'approved') {
        // move the held days from pending → used and mark the calendar days as leave
        await leave_1.LeaveBalance.updateOne({ userId: lr.userId, year }, { $inc: { [`used.${key}`]: lr.days, [`pending.${key}`]: -lr.days } });
        const dates = eachDate(lr.fromDate, lr.toDate);
        await Promise.all(dates.map(date => Attendance_1.Attendance.updateOne({ userId: lr.userId, date }, { $set: { status: 'leave', branchId: lr.branchId }, $setOnInsert: { source: 'web' } }, { upsert: true })));
    }
    else {
        // release the pending hold
        await leave_1.LeaveBalance.updateOne({ userId: lr.userId, year }, { $inc: { [`pending.${key}`]: -lr.days } });
    }
    await (0, notify_1.notify)(String(lr.userId), { type: 'leave.decision', title: `Leave ${decision}`, body: note || `Your ${lr.type} leave was ${decision}`, color: decision === 'approved' ? 'ok' : 'bad' });
    await (0, audit_1.audit)(req.user, 'leave.decision', 'LeaveRequest', lr._id, { after: { decision } });
    (0, http_1.ok)(res, lr);
}));
exports.default = router;
//# sourceMappingURL=leave.js.map