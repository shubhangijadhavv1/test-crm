"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const mongoose_1 = require("mongoose");
const Project_1 = require("../models/Project");
const User_1 = require("../models/User");
const http_1 = require("../utils/http");
const regex_1 = require("../utils/regex");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const qa_1 = require("./qa");
const concurrency_1 = require("../utils/concurrency");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const populate = [
    { path: 'ownerId', select: 'fullName avatarColor' },
    { path: 'categoryId', select: 'name' },
    { path: 'subCategoryId', select: 'name' },
    { path: 'websiteTypeId', select: 'name' },
    { path: 'serverId', select: 'name' },
];
const createBody = zod_1.z.object({
    type: zod_1.z.enum(['live', 'demo']),
    name: zod_1.z.string().min(1),
    url: zod_1.z.string().optional(),
    clientName: zod_1.z.string().optional(),
    categoryId: zod_1.z.string().optional(),
    subCategoryId: zod_1.z.string().optional(),
    websiteTypeId: zod_1.z.string().optional(),
    serverId: zod_1.z.string().optional(),
    ownerId: zod_1.z.string().optional(),
    priority: zod_1.z.enum(['low', 'medium', 'high', 'critical']).optional(),
    startDate: zod_1.z.coerce.date().optional(),
    dueDate: zod_1.z.coerce.date().optional(),
    notes: zod_1.z.string().optional(),
    branchId: zod_1.z.string().optional(),
});
// GET /projects?type=&status=&q=&page=
/**
 * Project visibility: the project inventory is company-wide. A non-super-admin sees projects
 * in their own branch PLUS unassigned projects (no branchId) — the imported inventory has no
 * branch, so without this branch-scoped users would see nothing. Super admin sees all (or ?branchId).
 */
function projectScope(req) {
    if (req.user.role === 'superadmin') {
        const b = req.query.branchId || '';
        return b ? { branchId: b } : null;
    }
    const ors = [{ branchId: { $exists: false } }, { branchId: null }];
    if (req.user.branchId)
        ors.push({ branchId: req.user.branchId });
    return { $or: ors };
}
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip, sort } = (0, http_1.parsePaging)(req.query);
    const filter = { isDeleted: false };
    if (req.query.type)
        filter.type = req.query.type;
    if (req.query.status)
        filter.status = req.query.status;
    if (req.query.priority)
        filter.priority = req.query.priority;
    if (req.query.categoryId)
        filter.categoryId = req.query.categoryId;
    if (req.query.serverId)
        filter.serverId = req.query.serverId;
    if (req.query.owner)
        filter.ownerId = req.query.owner === 'me' ? req.user.id : req.query.owner;
    // Combine branch scope + text search via $and so their $or clauses don't clobber each other.
    const and = [];
    const scope = projectScope(req);
    if (scope)
        and.push(scope);
    if (req.query.q) {
        const rx = (0, regex_1.safeRegex)(req.query.q);
        and.push({ $or: [{ name: rx }, { url: rx }] });
    }
    if (and.length)
        filter.$and = and;
    const [rows, total] = await Promise.all([
        Project_1.Project.find(filter).populate(populate).sort(sort).skip(skip).limit(limit).lean(),
        Project_1.Project.countDocuments(filter),
    ]);
    (0, http_1.ok)(res, rows, { page, limit, total });
}));
// aggregate() does not auto-cast strings to ObjectId, so build the branch match explicitly
function aggMatch(req) {
    const match = { isDeleted: false };
    if (req.user.role === 'superadmin') {
        const b = req.query.branchId || '';
        if (b)
            match.branchId = new mongoose_1.Types.ObjectId(b);
    }
    else {
        const ors = [{ branchId: { $exists: false } }, { branchId: null }];
        if (req.user.branchId)
            ors.push({ branchId: new mongoose_1.Types.ObjectId(req.user.branchId) });
        match.$or = ors;
    }
    return match;
}
router.get('/analytics/by-employee', (0, http_1.asyncHandler)(async (req, res) => {
    const rows = await Project_1.Project.aggregate([
        { $match: aggMatch(req) },
        { $group: { _id: { ownerId: '$ownerId', type: '$type' }, n: { $sum: 1 } } },
    ]);
    (0, http_1.ok)(res, rows);
}));
router.get('/analytics/by-server', (0, http_1.asyncHandler)(async (req, res) => {
    const rows = await Project_1.Project.aggregate([
        { $match: aggMatch(req) },
        { $group: { _id: { serverId: '$serverId', type: '$type' }, n: { $sum: 1 } } },
    ]);
    (0, http_1.ok)(res, rows);
}));
router.get('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await Project_1.Project.findOne({ _id: req.params.id, isDeleted: false }).populate(populate).lean();
    if (!doc)
        throw ApiError_1.ApiError.notFound('Project not found');
    (0, http_1.ok)(res, doc);
}));
router.post('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(createBody), (0, http_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    if (body.dueDate && body.startDate && body.dueDate < body.startDate)
        throw ApiError_1.ApiError.badRequest('dueDate must be on or after startDate');
    const count = await Project_1.Project.estimatedDocumentCount();
    // A project belongs to its assigned employee's branch (so the owner can see it),
    // else an explicit branch, else the creator's branch.
    const owner = body.ownerId ? await User_1.User.findById(body.ownerId).select('branchId').lean() : null;
    const branchId = body.branchId || owner?.branchId || req.user.branchId;
    const doc = await Project_1.Project.create({
        ...body,
        projectCode: `${body.type === 'live' ? 'LIV' : 'DEM'}-${String(count + 1).padStart(4, '0')}`,
        branchId,
        createdBy: req.user.id,
    });
    await (0, audit_1.audit)(req.user, 'project.create', 'Project', doc._id, { after: doc });
    (0, http_1.created)(res, doc);
}));
router.patch('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const update = { ...req.body };
    delete update.status; // status only via guarded route
    // Reassigning the employee moves the project to that employee's branch (unless branch set explicitly).
    if (update.ownerId && update.branchId === undefined) {
        const owner = await User_1.User.findById(update.ownerId).select('branchId').lean();
        if (owner?.branchId)
            update.branchId = owner.branchId;
    }
    const doc = await Project_1.Project.findOneAndUpdate({ _id: req.params.id, isDeleted: false, ...(0, concurrency_1.versionFilter)(req) }, { ...update, updatedBy: req.user.id, $inc: { version: 1 } }, { new: true });
    if (!doc) {
        if ((0, concurrency_1.hasIfMatch)(req) && await Project_1.Project.exists({ _id: req.params.id, isDeleted: false })) {
            throw ApiError_1.ApiError.conflict('This project was changed elsewhere — reload and try again.');
        }
        throw ApiError_1.ApiError.notFound('Project not found');
    }
    await (0, audit_1.audit)(req.user, 'project.update', 'Project', doc._id);
    (0, http_1.ok)(res, doc);
}));
// PATCH /projects/:id/status — guarded state machine
const statusBody = zod_1.z.object({ status: zod_1.z.enum(['pending', 'development', 'qa', 'revision', 'completed', 'onhold', 'live', 'finished', 'domain_transfer']) });
router.patch('/:id/status', (0, validate_1.validate)(statusBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { status } = req.body;
    const doc = await Project_1.Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Project not found');
    // Employees may only update the status of their own projects.
    if (req.user.role === 'employee' && String(doc.ownerId) !== req.user.id) {
        throw ApiError_1.ApiError.forbidden('You can only update the status of your own projects');
    }
    const isDemo = doc.type === 'demo';
    // QA only applies to live projects.
    if (status === 'qa' && isDemo)
        throw ApiError_1.ApiError.badRequest('QA is only required for live projects — demo projects skip QA');
    // Live projects complete automatically when both QA checklists reach 100% — no manual completion.
    if (status === 'completed' && !isDemo)
        throw ApiError_1.ApiError.badRequest('Live projects complete automatically once both QA checklists reach 100%');
    // Statuses a user may set manually (any-to-any within the allowed set for the type).
    // 'completed' for live is excluded above (auto via QA).
    const allowed = isDemo
        ? ['pending', 'development', 'revision', 'onhold', 'completed', 'finished', 'domain_transfer']
        : ['pending', 'development', 'qa', 'revision', 'onhold', 'live', 'finished'];
    if (!allowed.includes(status))
        throw ApiError_1.ApiError.badRequest(`Status "${status}" is not allowed for ${isDemo ? 'demo' : 'live'} projects`);
    const from = doc.status;
    if (from === status)
        return (0, http_1.ok)(res, doc);
    doc.status = status;
    if (status === 'completed') {
        doc.completedAt = new Date();
        if (isDemo)
            doc.qaProgress = 100;
    }
    doc.updatedBy = req.user.id;
    await doc.save();
    // Entering QA creates/links the QA process (live only)
    if (status === 'qa' && !isDemo)
        await (0, qa_1.ensureQaProcess)(String(doc._id), doc.branchId ? String(doc.branchId) : null);
    await (0, audit_1.audit)(req.user, 'project.status', 'Project', doc._id, { before: { status: from }, after: { status } });
    (0, http_1.ok)(res, doc);
}));
router.delete('/:id', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await Project_1.Project.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Project not found');
    await (0, audit_1.audit)(req.user, 'project.delete', 'Project', doc._id);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=projects.js.map