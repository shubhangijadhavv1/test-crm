"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const Task_1 = require("../models/Task");
const User_1 = require("../models/User");
const http_1 = require("../utils/http");
const cache_1 = require("../utils/cache");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const notify_1 = require("../utils/notify");
const socket_1 = require("../realtime/socket");
const concurrency_1 = require("../utils/concurrency");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const populate = [
    { path: 'assigneeId', select: 'fullName avatarColor' },
    { path: 'assignerId', select: 'fullName' },
];
/** Compute live seconds for a running timer. */
function liveSeconds(task) {
    const t = task.timer;
    if (!t)
        return 0;
    let s = t.accumulatedSeconds || 0;
    if (t.running && t.startedAt)
        s += Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000);
    return s;
}
/** Apply a status change to a task doc, managing the timer (shared by single + bulk move). */
function applyStatusTransition(task, status) {
    const prev = task.status;
    const timer = task.timer || { running: false, accumulatedSeconds: 0 };
    if (timer.running && status !== 'inprogress' && timer.startedAt) {
        timer.accumulatedSeconds = (timer.accumulatedSeconds || 0) + Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000);
        timer.running = false;
        timer.startedAt = null;
    }
    if (status === 'inprogress' && prev !== 'inprogress') {
        timer.running = true;
        timer.startedAt = new Date();
    }
    if (status === 'done') {
        timer.running = false;
        task.actualSeconds = timer.accumulatedSeconds || 0;
        task.completedAt = new Date();
    }
    task.timer = timer;
    task.status = status;
    return prev;
}
/** Who may edit/move a task: superadmin, the assigner/assignee, or an admin of the task's branch. */
function canWriteTask(user, task) {
    if (user.role === 'superadmin')
        return true;
    if (String(task.assigneeId) === user.id || String(task.assignerId) === user.id)
        return true;
    if (user.role === 'admin' && (!user.branchId || String(task.branchId) === String(user.branchId)))
        return true;
    return false;
}
// GET /tasks?assignee=&status=&project=&priority=&branch=&range=today|week|overdue|all&page=&limit=
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip, sort } = (0, http_1.parsePaging)(req.query);
    const filter = { isDeleted: false, ...(0, rbac_1.branchScope)(req) };
    // Employees see only their own tasks; managers/superadmin can filter by assignee.
    if (req.user.role === 'employee')
        filter.assigneeId = req.user.id;
    else if (req.query.assignee)
        filter.assigneeId = req.query.assignee;
    if (req.query.status)
        filter.status = req.query.status;
    if (req.query.project)
        filter.projectId = req.query.project;
    if (req.query.priority)
        filter.priority = req.query.priority;
    // Branch filter is honoured only for superadmin (others are already branch-scoped).
    if (req.user.role === 'superadmin' && req.query.branch)
        filter.branchId = req.query.branch;
    // Time range — overdue keys off status, today/week off the due date.
    const range = req.query.range;
    if (range === 'overdue') {
        filter.status = 'overdue';
    }
    else if (range === 'today' || range === 'week') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        if (range === 'today')
            end.setDate(end.getDate() + 1);
        else
            end.setDate(end.getDate() + 7);
        filter.dueAt = { $gte: start, $lt: end };
    }
    const [rows, total] = await Promise.all([
        Task_1.Task.find(filter).populate(populate).sort(sort).skip(skip).limit(limit).lean(),
        Task_1.Task.countDocuments(filter),
    ]);
    (0, http_1.ok)(res, rows.map(r => ({ ...r, liveSeconds: liveSeconds(r) })), { page, limit, total });
}));
const createBody = zod_1.z.object({
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    projectId: zod_1.z.string().optional(),
    projectName: zod_1.z.string().optional(),
    assigneeId: zod_1.z.string(),
    priority: zod_1.z.enum(['low', 'medium', 'high', 'critical']).optional(),
    difficulty: zod_1.z.number().min(1).max(5).optional(),
    dueAt: zod_1.z.coerce.date().optional(),
});
router.post('/', (0, validate_1.validate)(createBody), (0, http_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    // assignment authority: employees need tasks.assign scope (simplified: superadmin/admin always allowed)
    if (req.user.role === 'employee')
        throw ApiError_1.ApiError.forbidden('You are not permitted to assign tasks');
    // The task belongs to the assignee's branch so branch-scoped users can see their own tasks
    // (a superadmin assigner has no branch of their own).
    const assignee = await User_1.User.findById(body.assigneeId).select('branchId').lean();
    const doc = await Task_1.Task.create({
        ...body,
        assignerId: req.user.id,
        branchId: assignee?.branchId || req.user.branchId,
        status: 'todo',
        timer: { running: false, accumulatedSeconds: 0 },
        createdBy: req.user.id,
    });
    await (0, notify_1.notify)(body.assigneeId, { type: 'task.assigned', title: 'New task assigned', body: body.title, color: 'info', link: '/kanban' });
    await (0, audit_1.audit)(req.user, 'task.create', 'Task', doc._id);
    (0, cache_1.cacheClear)('dashboard'); // counters changed
    (0, socket_1.emitScoped)('task:moved', { id: doc._id }, { branchId: doc.branchId, userId: doc.assigneeId });
    (0, http_1.created)(res, doc);
}));
// PATCH /tasks/:id — edit; only assigner may change dueAt
router.patch('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const task = await Task_1.Task.findOne({ _id: req.params.id, isDeleted: false });
    if (!task)
        throw ApiError_1.ApiError.notFound('Task not found');
    if (!canWriteTask(req.user, task))
        throw ApiError_1.ApiError.forbidden('You are not permitted to edit this task');
    if ((0, concurrency_1.hasIfMatch)(req) && task.version !== (0, concurrency_1.versionFilter)(req).version) {
        throw ApiError_1.ApiError.conflict('This task was changed elsewhere — reload and try again.');
    }
    const body = { ...req.body };
    if (body.dueAt !== undefined && String(task.assignerId) !== req.user.id && req.user.role === 'employee') {
        throw ApiError_1.ApiError.forbidden('Only the assigner can change the due date');
    }
    const reassigned = body.assigneeId !== undefined && String(body.assigneeId) !== String(task.assigneeId);
    for (const k of ['title', 'description', 'priority', 'difficulty', 'assigneeId', 'dueAt']) {
        if (body[k] !== undefined)
            task[k] = body[k];
    }
    // Reassignment moves the task to the new assignee's branch so it stays in their scope.
    if (reassigned) {
        const assignee = await User_1.User.findById(body.assigneeId).select('branchId').lean();
        if (assignee?.branchId)
            task.branchId = assignee.branchId;
        await (0, notify_1.notify)(String(body.assigneeId), { type: 'task.assigned', title: 'Task assigned to you', body: task.title, color: 'info', link: '/kanban' });
    }
    task.updatedBy = req.user.id;
    task.increment(); // bump version for optimistic concurrency
    await task.save();
    await (0, audit_1.audit)(req.user, 'task.update', 'Task', task._id);
    (0, cache_1.cacheClear)('dashboard');
    (0, socket_1.emitScoped)('task:updated', { id: task._id }, { branchId: task.branchId, userId: task.assigneeId });
    (0, http_1.ok)(res, task);
}));
// PATCH /tasks/:id/move — change state; manages the timer (Blueprint M6 §6)
const moveBody = zod_1.z.object({ status: zod_1.z.enum(['todo', 'inprogress', 'done', 'overdue']) });
router.patch('/:id/move', (0, validate_1.validate)(moveBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { status } = req.body;
    const task = await Task_1.Task.findOne({ _id: req.params.id, isDeleted: false });
    if (!task)
        throw ApiError_1.ApiError.notFound('Task not found');
    if (!canWriteTask(req.user, task))
        throw ApiError_1.ApiError.forbidden('You are not permitted to move this task');
    if (status === 'overdue')
        throw ApiError_1.ApiError.badRequest('Overdue is system-managed and cannot be set manually');
    const prev = applyStatusTransition(task, status);
    await task.save();
    (0, cache_1.cacheClear)('dashboard'); // status counts changed
    (0, socket_1.emitScoped)('task:moved', { id: task._id, status }, { branchId: task.branchId, userId: task.assigneeId });
    // Keep the assigner informed of progress they didn't make themselves.
    if (status !== prev && task.assignerId && String(task.assignerId) !== req.user.id) {
        await (0, notify_1.notify)(String(task.assignerId), { type: 'task.status', title: 'Task status changed', body: `${task.title} → ${status}`, color: status === 'done' ? 'ok' : 'info', link: '/kanban' });
    }
    await (0, audit_1.audit)(req.user, 'task.move', 'Task', task._id, { before: { status: prev }, after: { status } });
    (0, http_1.ok)(res, { ...task.toObject(), liveSeconds: liveSeconds(task) });
}));
// DELETE /tasks/:id — soft delete
router.delete('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const task = await Task_1.Task.findOne({ _id: req.params.id, isDeleted: false });
    if (!task)
        throw ApiError_1.ApiError.notFound('Task not found');
    if (!canWriteTask(req.user, task))
        throw ApiError_1.ApiError.forbidden('You are not permitted to delete this task');
    task.isDeleted = true;
    task.updatedBy = req.user.id;
    await task.save();
    await (0, audit_1.audit)(req.user, 'task.delete', 'Task', task._id);
    (0, cache_1.cacheClear)('dashboard');
    (0, socket_1.emitScoped)('task:moved', { id: task._id, deleted: true }, { branchId: task.branchId, userId: task.assigneeId });
    (0, http_1.ok)(res, { deleted: true });
}));
// POST /tasks/bulk — bulk move / reassign / delete (per-task authorization)
const bulkBody = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string()).min(1).max(200),
    action: zod_1.z.enum(['move', 'reassign', 'delete']),
    status: zod_1.z.enum(['todo', 'inprogress', 'done']).optional(),
    assigneeId: zod_1.z.string().optional(),
});
router.post('/bulk', (0, validate_1.validate)(bulkBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { ids, action, status, assigneeId } = req.body;
    if (action === 'move' && !status)
        throw ApiError_1.ApiError.badRequest('status is required for a bulk move');
    if (action === 'reassign' && !assigneeId)
        throw ApiError_1.ApiError.badRequest('assigneeId is required for a bulk reassign');
    const tasks = await Task_1.Task.find({ _id: { $in: ids }, isDeleted: false, ...(0, rbac_1.branchScope)(req) });
    const newBranch = action === 'reassign'
        ? (await User_1.User.findById(assigneeId).select('branchId').lean())?.branchId
        : undefined;
    let affected = 0, skipped = 0;
    for (const task of tasks) {
        if (!canWriteTask(req.user, task)) {
            skipped++;
            continue;
        }
        if (action === 'delete') {
            task.isDeleted = true;
        }
        else if (action === 'move') {
            applyStatusTransition(task, status);
        }
        else if (action === 'reassign') {
            task.assigneeId = assigneeId;
            if (newBranch)
                task.branchId = newBranch;
        }
        task.updatedBy = req.user.id;
        await task.save();
        affected++;
        (0, socket_1.emitScoped)('task:moved', { id: task._id }, { branchId: task.branchId, userId: task.assigneeId });
        if (action === 'reassign')
            await (0, notify_1.notify)(String(assigneeId), { type: 'task.assigned', title: 'Task assigned to you', body: task.title, color: 'info', link: '/kanban' });
    }
    await (0, audit_1.audit)(req.user, `task.bulk.${action}`, 'Task', ids.join(','), { after: { affected, skipped } });
    if (affected)
        (0, cache_1.cacheClear)('dashboard');
    (0, http_1.ok)(res, { affected, skipped });
}));
exports.default = router;
//# sourceMappingURL=tasks.js.map