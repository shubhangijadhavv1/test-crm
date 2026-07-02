"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const Branch_1 = require("../models/Branch");
const User_1 = require("../models/User");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const weekend_1 = require("../utils/weekend");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const branchBody = zod_1.z.object({
    name: zod_1.z.string().min(1),
    code: zod_1.z.string().optional(),
    timezone: zod_1.z.string().optional(),
    shift: zod_1.z.object({ startTime: zod_1.z.string(), endTime: zod_1.z.string(), graceMinutes: zod_1.z.number() }).partial().optional(),
    breaks: zod_1.z.object({ lunchMinutes: zod_1.z.number(), teaMinutes: zod_1.z.number() }).partial().optional(),
    weekend: zod_1.z.object({
        sundayOff: zod_1.z.boolean(),
        saturdayWeeks: zod_1.z.array(zod_1.z.number().int().min(1).max(5)),
    }).partial().optional(),
    leaveAllocation: zod_1.z.object({ paid: zod_1.z.number(), sick: zod_1.z.number(), casual: zod_1.z.number() }).partial().optional(),
    allowedIps: zod_1.z.array(zod_1.z.string()).optional(),
});
// GET /branches — list with employee counts
router.get('/', (0, http_1.asyncHandler)(async (_req, res) => {
    const branches = await Branch_1.Branch.find({ isDeleted: false }).sort({ name: 1 }).lean();
    const counts = await User_1.User.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$branchId', n: { $sum: 1 } } },
    ]);
    const map = {};
    counts.forEach(c => { if (c._id)
        map[String(c._id)] = c.n; });
    (0, http_1.ok)(res, branches.map(b => ({ ...b, emps: map[String(b._id)] || 0, weekendLabel: (0, weekend_1.weekendLabel)(b.weekend) })));
}));
router.post('/', (0, rbac_1.requireRole)('superadmin'), (0, validate_1.validate)(branchBody), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await Branch_1.Branch.create({ ...req.body, createdBy: req.user.id });
    await (0, audit_1.audit)(req.user, 'branch.create', 'Branch', doc._id, { after: doc });
    (0, http_1.created)(res, doc);
}));
router.patch('/:id', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const before = await Branch_1.Branch.findById(req.params.id).lean();
    const doc = await Branch_1.Branch.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user.id }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Branch not found');
    await (0, audit_1.audit)(req.user, 'branch.update', 'Branch', doc._id, { before, after: doc });
    (0, http_1.ok)(res, doc);
}));
// DELETE /branches/:id — soft-delete (Super Admin); blocked while employees are assigned
router.delete('/:id', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const branch = await Branch_1.Branch.findOne({ _id: req.params.id, isDeleted: false });
    if (!branch)
        throw ApiError_1.ApiError.notFound('Branch not found');
    const emps = await User_1.User.countDocuments({ branchId: branch._id, isDeleted: false });
    if (emps > 0)
        throw ApiError_1.ApiError.conflict(`Reassign or remove this branch's ${emps} employee(s) before deleting it`);
    branch.isDeleted = true;
    branch.isActive = false;
    branch.updatedBy = req.user.id;
    await branch.save();
    await (0, audit_1.audit)(req.user, 'branch.delete', 'Branch', branch._id);
    (0, http_1.ok)(res, { deleted: true });
}));
// Holidays
router.get('/:id/holidays', (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, await Branch_1.Holiday.find({ branchId: req.params.id }).sort({ date: 1 }).lean());
}));
router.post('/:id/holidays', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await Branch_1.Holiday.create({ ...req.body, branchId: req.params.id });
    (0, http_1.created)(res, doc);
}));
exports.default = router;
//# sourceMappingURL=branches.js.map