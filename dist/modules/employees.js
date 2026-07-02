"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const User_1 = require("../models/User");
const Project_1 = require("../models/Project");
const Task_1 = require("../models/Task");
const http_1 = require("../utils/http");
const regex_1 = require("../utils/regex");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const password_1 = require("../utils/password");
const audit_1 = require("../utils/audit");
const misc_1 = require("../models/misc");
const access_1 = require("../utils/access");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const createBody = zod_1.z.object({
    fullName: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    employeeId: zod_1.z.string().optional(),
    role: zod_1.z.enum(['superadmin', 'admin', 'employee']).default('employee'),
    branchId: zod_1.z.string().optional(),
    department: zod_1.z.string().optional(),
    designation: zod_1.z.string().optional(),
    workMode: zod_1.z.enum(['office', 'wfh', 'hybrid']).optional(),
    moduleAccess: zod_1.z.record(zod_1.z.boolean()).optional(),
    allowedIps: zod_1.z.array(zod_1.z.string()).optional(),
    webPunchEnabled: zod_1.z.boolean().optional(),
});
const roleRank = { employee: 1, admin: 2, superadmin: 3 };
// GET /employees — directory (branch-scoped for non-SA; employees see only themselves)
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip, sort } = (0, http_1.parsePaging)(req.query);
    const filter = { isDeleted: false, ...(0, rbac_1.branchFilter)(req) };
    // Employees are strictly self-scoped (own profile / own performance only).
    if (req.user.role === 'employee')
        filter._id = req.user.id;
    if (req.query.dept)
        filter.department = req.query.dept;
    if (req.query.branch)
        filter.branchId = req.query.branch;
    if (req.query.q) {
        const rx = (0, regex_1.safeRegex)(req.query.q);
        filter.$or = [{ fullName: rx }, { email: rx }, { department: rx }, { designation: rx }];
    }
    const [rows, total] = await Promise.all([
        User_1.User.find(filter).select('-passwordHash -security.twoFactorSecret').populate('branchId', 'name').sort(sort).skip(skip).limit(limit).lean(),
        User_1.User.countDocuments(filter),
    ]);
    (0, http_1.ok)(res, rows, { page, limit, total });
}));
// GET /employees/options — minimal {_id, fullName} list for assignment dropdowns
// (QA reviewer, task assignee). Branch-scoped; available to any authenticated user.
// Defined before '/:id' so it isn't captured as an id param.
router.get('/options', (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false, status: 'active', ...(0, rbac_1.branchFilter)(req) };
    const rows = await User_1.User.find(filter).select('fullName department branchId').sort({ fullName: 1 }).lean();
    (0, http_1.ok)(res, rows);
}));
// GET /employees/:id — aggregated profile (employees may only read their own)
router.get('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    if (req.user.role === 'employee' && req.params.id !== req.user.id)
        throw ApiError_1.ApiError.forbidden('You can only view your own profile');
    const user = await User_1.User.findOne({ _id: req.params.id, isDeleted: false })
        .select('-passwordHash -security.twoFactorSecret').populate('branchId', 'name').lean();
    if (!user)
        throw ApiError_1.ApiError.notFound('Employee not found');
    const [projects, tasksTotal, tasksDone, tasksInProgress] = await Promise.all([
        Project_1.Project.countDocuments({ ownerId: user._id, isDeleted: false }),
        Task_1.Task.countDocuments({ assigneeId: user._id, isDeleted: false }),
        Task_1.Task.countDocuments({ assigneeId: user._id, status: 'done', isDeleted: false }),
        Task_1.Task.countDocuments({ assigneeId: user._id, status: 'inprogress', isDeleted: false }),
    ]);
    (0, http_1.ok)(res, { ...user, stats: { projects, tasksTotal, tasksDone, tasksInProgress } });
}));
// POST /employees — create (admins cannot escalate above their own role)
router.post('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(createBody), (0, http_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    if (roleRank[body.role] > roleRank[req.user.role]) {
        throw ApiError_1.ApiError.forbidden('You cannot create a user with a higher role than your own');
    }
    const passwordHash = await (0, password_1.hashPassword)(body.password);
    const count = await User_1.User.estimatedDocumentCount();
    // Super Admin decides module access; fall back to role defaults.
    const moduleAccess = body.moduleAccess ? (0, access_1.sanitizeModuleAccess)(body.moduleAccess) : (0, access_1.defaultModuleAccess)(body.role);
    const doc = await User_1.User.create({
        fullName: body.fullName,
        email: body.email.toLowerCase(),
        passwordHash,
        employeeId: body.employeeId || `GDC-${String(count + 1).padStart(4, '0')}`,
        role: body.role,
        branchId: body.branchId,
        department: body.department,
        designation: body.designation,
        workMode: body.workMode || 'office',
        moduleAccess,
        createdBy: req.user.id,
    });
    await (0, audit_1.audit)(req.user, 'employee.create', 'User', doc._id);
    const safe = await User_1.User.findById(doc._id).select('-passwordHash -security.twoFactorSecret').lean();
    (0, http_1.created)(res, safe);
}));
router.patch('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const update = { ...req.body };
    delete update.passwordHash;
    delete update.password;
    delete update.role; // role via dedicated path
    const doc = await User_1.User.findByIdAndUpdate(req.params.id, { ...update, updatedBy: req.user.id }, { new: true })
        .select('-passwordHash -security.twoFactorSecret');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    await (0, audit_1.audit)(req.user, 'employee.update', 'User', doc._id);
    (0, http_1.ok)(res, doc);
}));
// DELETE /:id — soft-delete an employee (superadmin / branch admin), revoke their sessions
router.delete('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    if (req.params.id === req.user.id)
        throw ApiError_1.ApiError.badRequest('You cannot delete your own account');
    const target = await User_1.User.findOne({ _id: req.params.id, isDeleted: false });
    if (!target)
        throw ApiError_1.ApiError.notFound('Employee not found');
    if (target.role === 'superadmin')
        throw ApiError_1.ApiError.forbidden('Super Admin cannot be deleted');
    if (req.user.role === 'admin' && req.user.branchId && String(target.branchId) !== String(req.user.branchId)) {
        throw ApiError_1.ApiError.forbidden('You can only delete employees in your branch');
    }
    target.isDeleted = true;
    target.status = 'suspended';
    target.updatedBy = req.user.id;
    await target.save();
    await misc_1.Session.updateMany({ userId: target._id }, { revoked: true });
    await (0, audit_1.audit)(req.user, 'employee.delete', 'User', target._id);
    (0, http_1.ok)(res, { deleted: true });
}));
// PATCH /:id/permissions — Super Admin sets module access (and optionally role).
router.patch('/:id/permissions', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const update = { updatedBy: req.user.id };
    if (req.body.moduleAccess)
        update.moduleAccess = (0, access_1.sanitizeModuleAccess)(req.body.moduleAccess);
    if (req.body.permissions)
        update.permissions = req.body.permissions;
    if (req.body.role) {
        if (roleRank[req.body.role] > roleRank[req.user.role])
            throw ApiError_1.ApiError.forbidden('Cannot assign a role higher than your own');
        update.role = req.body.role;
    }
    const doc = await User_1.User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-passwordHash');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    await (0, audit_1.audit)(req.user, 'employee.permissions', 'User', doc._id, { after: update });
    (0, http_1.ok)(res, doc);
}));
router.patch('/:id/status', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const status = req.body.status === 'suspended' ? 'suspended' : 'active';
    const doc = await User_1.User.findByIdAndUpdate(req.params.id, { status, updatedBy: req.user.id }, { new: true }).select('-passwordHash');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    if (status === 'suspended')
        await misc_1.Session.updateMany({ userId: doc._id }, { revoked: true });
    await (0, audit_1.audit)(req.user, 'employee.status', 'User', doc._id, { after: { status } });
    (0, http_1.ok)(res, doc);
}));
router.post('/:id/reset-password', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const temp = req.body.password || Math.random().toString(36).slice(2, 10) + 'A1!';
    const passwordHash = await (0, password_1.hashPassword)(temp);
    const doc = await User_1.User.findByIdAndUpdate(req.params.id, { passwordHash }, { new: true }).select('_id email');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    await misc_1.Session.updateMany({ userId: doc._id }, { revoked: true });
    await (0, audit_1.audit)(req.user, 'employee.reset_password', 'User', doc._id);
    (0, http_1.ok)(res, { reset: true, tempPassword: temp });
}));
router.post('/:id/reset-2fa', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await User_1.User.findByIdAndUpdate(req.params.id, { 'security.twoFactorEnabled': false, $unset: { 'security.twoFactorSecret': 1 } }, { new: true }).select('_id');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    await (0, audit_1.audit)(req.user, 'employee.reset_2fa', 'User', doc._id);
    (0, http_1.ok)(res, { reset: true });
}));
exports.default = router;
//# sourceMappingURL=employees.js.map