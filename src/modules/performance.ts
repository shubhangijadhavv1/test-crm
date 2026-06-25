import { Router } from 'express'
import { z } from 'zod'
import { User } from '../models/User'
import { Attendance } from '../models/Attendance'
import { Task } from '../models/Task'
import { Branch, Holiday } from '../models/Branch'
import { LeaveRequest } from '../models/leave'
import { ok, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole, branchScope } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { isWeeklyOff } from '../utils/weekend'

const router = Router()
router.use(requireAuth)

// Weighting of the 5 criteria (sums to 100).
const W = { attendance: 25, punctuality: 15, efficiency: 25, tasks: 20, behaviour: 15 }
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const fmtDate = (d: unknown) => new Date(d as Date).toISOString().slice(0, 10)

/** Compute every employee's performance for a month from attendance, lateness, idle, tasks & behaviour. */
async function compute(scope: Record<string, unknown>, month: string) {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = new Date().toISOString().slice(0, 10)
  const monthStart = new Date(y, m - 1, 1), monthEnd = new Date(y, m, 0)

  const [users, branches, attendance, tasks, holidays, leaves] = await Promise.all([
    User.find({ isDeleted: false, ...scope }).select('fullName department role branchId behaviourScore avatarColor').lean(),
    Branch.find({}).lean(),
    Attendance.find({ date: new RegExp('^' + month) }).lean(),
    Task.find({ isDeleted: false, createdAt: { $gte: monthStart, $lte: new Date(monthEnd.getTime() + 86400000) } }).select('assigneeId status').lean(),
    Holiday.find({}).lean(),
    LeaveRequest.find({ status: 'approved', isDeleted: false }).lean(),
  ])
  const branchMap = new Map(branches.map(b => [String(b._id), b]))
  const holidaySet = new Set(holidays.filter(h => h.date).map(h => String(h.branchId) + fmtDate(h.date)))

  return users.map(u => {
    const branch = branchMap.get(String(u.branchId))
    const recs = attendance.filter(a => String(a.userId) === String(u._id))
    const uLeaves = leaves.filter(l => String(l.userId) === String(u._id))
    const uTasks = tasks.filter(t => String(t.assigneeId) === String(u._id))

    // working days elapsed this month (exclude weekoff/holiday and approved leave)
    let workingDays = 0, leaveDays = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m - 1, d)
      const dateStr = `${month}-${String(d).padStart(2, '0')}`
      if (dateStr > todayStr) break
      if (isWeeklyOff(branch?.weekend as never, date)) continue
      if (holidaySet.has(String(u.branchId) + dateStr)) continue
      workingDays++
      if (uLeaves.some(l => dateStr >= fmtDate(l.fromDate) && dateStr <= fmtDate(l.toDate))) leaveDays++
    }
    const expected = Math.max(0, workingDays - leaveDays)
    const present = recs.filter(r => r.loginAt).length
    const late = recs.filter(r => r.lateMark).length
    const work = recs.reduce((s, r) => s + (r.totals?.workSeconds || 0), 0)
    const idle = recs.reduce((s, r) => s + (r.totals?.idleSeconds || 0), 0)
    const assigned = uTasks.length
    const done = uTasks.filter(t => t.status === 'done').length
    const overdue = uTasks.filter(t => t.status === 'overdue').length

    // criteria (0–100)
    const attendance100 = expected ? clamp((present / expected) * 100) : 100
    const punctuality100 = present ? clamp((1 - late / present) * 100) : 100
    const efficiency100 = (work + idle) ? clamp((work / (work + idle)) * 100) : (present ? 50 : 0)
    const tasks100 = assigned ? clamp(((done - overdue * 0.5) / assigned) * 100) : 100
    const behaviour100 = clamp(u.behaviourScore ?? 75)

    const score = clamp(
      (attendance100 * W.attendance + punctuality100 * W.punctuality + efficiency100 * W.efficiency +
        tasks100 * W.tasks + behaviour100 * W.behaviour) / 100,
    )
    return {
      userId: u._id, name: u.fullName, department: u.department, role: u.role, avatarColor: u.avatarColor,
      branchId: u.branchId, branch: branch?.name || '—',
      score,
      metrics: { attendance: attendance100, punctuality: punctuality100, efficiency: efficiency100, tasks: tasks100, behaviour: behaviour100 },
      raw: { workingDays, expected, present, late, overdue, assigned, done, workSeconds: work, idleSeconds: idle },
    }
  }).sort((a, b) => b.score - a.score)
}

// GET /performance?month=YYYY-MM (admin: all in scope; employee: self only)
router.get('/', asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7)
  let scope: Record<string, unknown>
  if (req.user!.role === 'employee') scope = { _id: req.user!.id }
  else if (req.user!.role === 'superadmin' && req.query.branchId) scope = { branchId: req.query.branchId }
  else scope = branchScope(req)
  const rows = await compute(scope, month)
  ok(res, { month, weights: W, employees: rows })
}))

// PATCH /performance/:userId/behaviour { score } — manager sets the behaviour rating
const behaviourBody = z.object({ score: z.number().min(0).max(100) })
router.patch('/:userId/behaviour', requireRole('superadmin', 'admin'), validate(behaviourBody), asyncHandler(async (req, res) => {
  const { score } = req.body as z.infer<typeof behaviourBody>
  const doc = await User.findByIdAndUpdate(req.params.userId, { behaviourScore: score, updatedBy: req.user!.id }, { new: true }).select('fullName behaviourScore')
  if (!doc) throw ApiError.notFound('Employee not found')
  await audit(req.user, 'performance.behaviour', 'User', doc._id, { after: { score } })
  ok(res, { ok: true, score })
}))

export default router
