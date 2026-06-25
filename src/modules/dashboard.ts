import { Router } from 'express'
import { Types } from 'mongoose'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { Task } from '../models/Task'
import { QaProcess } from '../models/qa'
import { Attendance } from '../models/Attendance'
import { ok, asyncHandler } from '../utils/http'
import { requireAuth } from '../middleware/auth'
import { branchFilter } from '../middleware/rbac'
import { cacheGet, cacheSet } from '../utils/cache'

const router = Router()
router.use(requireAuth)

const TTL = 30_000 // 30s snapshot cache
const scopeKey = (req: import('express').Request) => `${req.user!.role}:${(branchFilter(req) as { branchId?: string }).branchId || 'all'}`

// GET /dashboard/summary — one aggregated call (Blueprint A7.1 / Module 2), cached 30s
router.get('/summary', asyncHandler(async (req, res) => {
  const cacheKey = `dashboard:summary:${scopeKey(req)}`
  const hit = cacheGet(cacheKey)
  if (hit) return ok(res, hit)
  const scope = branchFilter(req)
  const today = new Date().toISOString().slice(0, 10)

  const [
    liveTotal, demoTotal, activeProjects, completedProjects,
    employees, presentToday, pendingQA, overdueTasks,
    taskByStatus, qaByState,
  ] = await Promise.all([
    Project.countDocuments({ ...scope, isDeleted: false, type: 'live' }),
    Project.countDocuments({ ...scope, isDeleted: false, type: 'demo' }),
    Project.countDocuments({ ...scope, isDeleted: false, status: { $nin: ['completed'] } }),
    Project.countDocuments({ ...scope, isDeleted: false, status: 'completed' }),
    User.countDocuments({ ...scope, isDeleted: false }),
    Attendance.countDocuments({ ...scope, date: today, status: { $ne: 'absent' } }),
    QaProcess.countDocuments({ isDeleted: false, state: { $ne: 'passed' } }),
    Task.countDocuments({ ...scope, isDeleted: false, status: 'overdue' }),
    Task.aggregate([{ $match: { ...scope, isDeleted: false } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    QaProcess.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: '$state', n: { $sum: 1 } } }]),
  ])

  const taskMap: Record<string, number> = {}
  taskByStatus.forEach(t => (taskMap[t._id] = t.n))
  const qaMap: Record<string, number> = {}
  qaByState.forEach(q => (qaMap[q._id] = q.n))

  // employee overview by live status
  const empAgg = await User.aggregate([
    { $match: { ...scope, isDeleted: false } },
    { $group: { _id: null, total: { $sum: 1 }, wfh: { $sum: { $cond: [{ $eq: ['$workMode', 'wfh'] }, 1, 0] } }, office: { $sum: { $cond: [{ $eq: ['$workMode', 'office'] }, 1, 0] } } } },
  ])
  const emp = empAgg[0] || { total: employees, wfh: 0, office: 0 }

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
  }
  cacheSet(cacheKey, payload, TTL)
  ok(res, payload)
}))

// GET /dashboard/inventory?type=live|demo (cached 30s)
router.get('/inventory', asyncHandler(async (req, res) => {
  const type = req.query.type === 'demo' ? 'demo' : 'live'
  const invKey = `dashboard:inventory:${type}:${scopeKey(req)}`
  const invHit = cacheGet(invKey)
  if (invHit) return ok(res, invHit)
  // aggregate() does not auto-cast strings to ObjectId, so build the match explicitly
  const bf = branchFilter(req) as { branchId?: string }
  const match: Record<string, unknown> = { isDeleted: false, type }
  if (bf.branchId) match.branchId = new Types.ObjectId(bf.branchId)
  const rows = await Project.aggregate([
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
  ])
  cacheSet(invKey, rows, TTL)
  ok(res, rows)
}))

export default router
