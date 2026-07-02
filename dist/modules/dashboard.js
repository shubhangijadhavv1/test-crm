"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mongoose_1 = require("mongoose");
const Project_1 = require("../models/Project");
const User_1 = require("../models/User");
const Task_1 = require("../models/Task");
const qa_1 = require("../models/qa");
const Attendance_1 = require("../models/Attendance");
const http_1 = require("../utils/http");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const cache_1 = require("../utils/cache");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const TTL = 30_000; // 30s snapshot cache
const scopeKey = (req) => `${req.user.role}:${(0, rbac_1.branchFilter)(req).branchId || 'all'}`;
// GET /dashboard/summary — one aggregated call (Blueprint A7.1 / Module 2), cached 30s
router.get('/summary', (0, http_1.asyncHandler)(async (req, res) => {
    const cacheKey = `dashboard:summary:${scopeKey(req)}`;
    const hit = (0, cache_1.cacheGet)(cacheKey);
    if (hit)
        return (0, http_1.ok)(res, hit);
    const scope = (0, rbac_1.branchFilter)(req);
    const today = new Date().toISOString().slice(0, 10);
    const [liveTotal, demoTotal, activeProjects, completedProjects, employees, presentToday, pendingQA, overdueTasks, taskByStatus, qaByState,] = await Promise.all([
        Project_1.Project.countDocuments({ ...scope, isDeleted: false, type: 'live' }),
        Project_1.Project.countDocuments({ ...scope, isDeleted: false, type: 'demo' }),
        Project_1.Project.countDocuments({ ...scope, isDeleted: false, status: { $nin: ['completed'] } }),
        Project_1.Project.countDocuments({ ...scope, isDeleted: false, status: 'completed' }),
        User_1.User.countDocuments({ ...scope, isDeleted: false }),
        Attendance_1.Attendance.countDocuments({ ...scope, date: today, status: { $ne: 'absent' } }),
        qa_1.QaProcess.countDocuments({ isDeleted: false, state: { $ne: 'passed' } }),
        Task_1.Task.countDocuments({ ...scope, isDeleted: false, status: 'overdue' }),
        Task_1.Task.aggregate([{ $match: { ...scope, isDeleted: false } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        qa_1.QaProcess.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$state', n: { $sum: 1 } } }]),
    ]);
    const taskMap = {};
    taskByStatus.forEach(t => (taskMap[t._id] = t.n));
    const qaMap = {};
    qaByState.forEach(q => (qaMap[q._id] = q.n));
    // employee overview by live status
    const empAgg = await User_1.User.aggregate([
        { $match: { ...scope, isDeleted: false } },
        { $group: { _id: null, total: { $sum: 1 }, wfh: { $sum: { $cond: [{ $eq: ['$workMode', 'wfh'] }, 1, 0] } }, office: { $sum: { $cond: [{ $eq: ['$workMode', 'office'] }, 1, 0] } } } },
    ]);
    const emp = empAgg[0] || { total: employees, wfh: 0, office: 0 };
    const payload = {
        stats: {
            liveProjects: liveTotal, demoProjects: demoTotal, activeEmployees: employees,
            presentToday, pendingQA, overdueTasks, activeProjects, completedProjects,
        },
        taskOverview: { todo: taskMap.todo || 0, inprogress: taskMap.inprogress || 0, done: taskMap.done || 0, overdue: taskMap.overdue || 0 },
        qaOverview: {
            pending: (qaMap.stage1 || 0) + (qaMap.stage2_ready || 0) + (qaMap.stage2_inprogress || 0) + (qaMap.stage2_locked || 0),
            stage1: qaMap.stage1 || 0,
            stage2: (qaMap.stage2_ready || 0) + (qaMap.stage2_inprogress || 0),
            completed: qaMap.passed || 0,
        },
        employeeOverview: { total: emp.total, wfh: emp.wfh, office: emp.office },
        attendanceOverview: { present: presentToday, total: employees },
    };
    (0, cache_1.cacheSet)(cacheKey, payload, TTL);
    (0, http_1.ok)(res, payload);
}));
// GET /dashboard/inventory?type=live|demo (cached 30s)
router.get('/inventory', (0, http_1.asyncHandler)(async (req, res) => {
    const type = req.query.type === 'demo' ? 'demo' : 'live';
    const invKey = `dashboard:inventory:${type}:${scopeKey(req)}`;
    const invHit = (0, cache_1.cacheGet)(invKey);
    if (invHit)
        return (0, http_1.ok)(res, invHit);
    // aggregate() does not auto-cast strings to ObjectId, so build the match explicitly
    const bf = (0, rbac_1.branchFilter)(req);
    const match = { isDeleted: false, type };
    if (bf.branchId)
        match.branchId = new mongoose_1.Types.ObjectId(bf.branchId);
    const rows = await Project_1.Project.aggregate([
        { $match: match },
        { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'cat' } },
        { $lookup: { from: 'subcategories', localField: 'subCategoryId', foreignField: '_id', as: 'sub' } },
        { $lookup: { from: 'websitetypes', localField: 'websiteTypeId', foreignField: '_id', as: 'wt' } },
        {
            $group: {
                _id: { cat: { $arrayElemAt: ['$cat.name', 0] }, sub: { $arrayElemAt: ['$sub.name', 0] }, type: { $arrayElemAt: ['$wt.name', 0] } },
                n: { $sum: 1 },
            },
        },
        { $project: { _id: 0, cat: '$_id.cat', sub: '$_id.sub', type: '$_id.type', n: 1 } },
    ]);
    (0, cache_1.cacheSet)(invKey, rows, TTL);
    (0, http_1.ok)(res, rows);
}));
exports.default = router;
//# sourceMappingURL=dashboard.js.map