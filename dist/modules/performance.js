"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const User_1 = require("../models/User");
const Attendance_1 = require("../models/Attendance");
const Task_1 = require("../models/Task");
const Branch_1 = require("../models/Branch");
const leave_1 = require("../models/leave");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const weekend_1 = require("../utils/weekend");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// Weighting of the 5 criteria (sums to 100).
const W = { attendance: 25, punctuality: 15, efficiency: 25, tasks: 20, behaviour: 15 };
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
/** Compute every employee's performance for a month from attendance, lateness, idle, tasks & behaviour. */
async function compute(scope, month) {
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayStr = new Date().toISOString().slice(0, 10);
    const monthStart = new Date(y, m - 1, 1), monthEnd = new Date(y, m, 0);
    const [users, branches, attendance, tasks, holidays, leaves] = await Promise.all([
        User_1.User.find({ isDeleted: false, ...scope }).select('fullName department role branchId behaviourScore avatarColor').lean(),
        Branch_1.Branch.find({}).lean(),
        Attendance_1.Attendance.find({ date: new RegExp('^' + month) }).lean(),
        Task_1.Task.find({ isDeleted: false, createdAt: { $gte: monthStart, $lte: new Date(monthEnd.getTime() + 86400000) } }).select('assigneeId status').lean(),
        Branch_1.Holiday.find({}).lean(),
        leave_1.LeaveRequest.find({ status: 'approved', isDeleted: false }).lean(),
    ]);
    const branchMap = new Map(branches.map(b => [String(b._id), b]));
    const holidaySet = new Set(holidays.filter(h => h.date).map(h => String(h.branchId) + fmtDate(h.date)));
    return users.map(u => {
        const branch = branchMap.get(String(u.branchId));
        const recs = attendance.filter(a => String(a.userId) === String(u._id));
        const uLeaves = leaves.filter(l => String(l.userId) === String(u._id));
        const uTasks = tasks.filter(t => String(t.assigneeId) === String(u._id));
        // working days elapsed this month (exclude weekoff/holiday and approved leave)
        let workingDays = 0, leaveDays = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(y, m - 1, d);
            const dateStr = `${month}-${String(d).padStart(2, '0')}`;
            if (dateStr > todayStr)
                break;
            if ((0, weekend_1.isWeeklyOff)(branch?.weekend, date))
                continue;
            if (holidaySet.has(String(u.branchId) + dateStr))
                continue;
            workingDays++;
            if (uLeaves.some(l => dateStr >= fmtDate(l.fromDate) && dateStr <= fmtDate(l.toDate)))
                leaveDays++;
        }
        const expected = Math.max(0, workingDays - leaveDays);
        const present = recs.filter(r => r.loginAt).length;
        const late = recs.filter(r => r.lateMark).length;
        const work = recs.reduce((s, r) => s + (r.totals?.workSeconds || 0), 0);
        const idle = recs.reduce((s, r) => s + (r.totals?.idleSeconds || 0), 0);
        const assigned = uTasks.length;
        const done = uTasks.filter(t => t.status === 'done').length;
        const overdue = uTasks.filter(t => t.status === 'overdue').length;
        // criteria (0–100)
        const attendance100 = expected ? clamp((present / expected) * 100) : 100;
        const punctuality100 = present ? clamp((1 - late / present) * 100) : 100;
        const efficiency100 = (work + idle) ? clamp((work / (work + idle)) * 100) : (present ? 50 : 0);
        const tasks100 = assigned ? clamp(((done - overdue * 0.5) / assigned) * 100) : 100;
        const behaviour100 = clamp(u.behaviourScore ?? 75);
        const score = clamp((attendance100 * W.attendance + punctuality100 * W.punctuality + efficiency100 * W.efficiency +
            tasks100 * W.tasks + behaviour100 * W.behaviour) / 100);
        return {
            userId: u._id, name: u.fullName, department: u.department, role: u.role, avatarColor: u.avatarColor,
            branchId: u.branchId, branch: branch?.name || '—',
            score,
            metrics: { attendance: attendance100, punctuality: punctuality100, efficiency: efficiency100, tasks: tasks100, behaviour: behaviour100 },
            raw: { workingDays, expected, present, late, overdue, assigned, done, workSeconds: work, idleSeconds: idle },
        };
    }).sort((a, b) => b.score - a.score);
}
// GET /performance?month=YYYY-MM (admin: all in scope; employee: self only)
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    let scope;
    if (req.user.role === 'employee')
        scope = { _id: req.user.id };
    else if (req.user.role === 'superadmin' && req.query.branchId)
        scope = { branchId: req.query.branchId };
    else
        scope = (0, rbac_1.branchScope)(req);
    const rows = await compute(scope, month);
    (0, http_1.ok)(res, { month, weights: W, employees: rows });
}));
// PATCH /performance/:userId/behaviour { score } — manager sets the behaviour rating
const behaviourBody = zod_1.z.object({ score: zod_1.z.number().min(0).max(100) });
router.patch('/:userId/behaviour', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(behaviourBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { score } = req.body;
    const doc = await User_1.User.findByIdAndUpdate(req.params.userId, { behaviourScore: score, updatedBy: req.user.id }, { new: true }).select('fullName behaviourScore');
    if (!doc)
        throw ApiError_1.ApiError.notFound('Employee not found');
    await (0, audit_1.audit)(req.user, 'performance.behaviour', 'User', doc._id, { after: { score } });
    (0, http_1.ok)(res, { ok: true, score });
}));
exports.default = router;
//# sourceMappingURL=performance.js.map