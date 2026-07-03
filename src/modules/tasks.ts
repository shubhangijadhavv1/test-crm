import { Router } from 'express'
import { z } from 'zod'
import { Task } from '../models/Task'
import { User } from '../models/User'
import { ok, created, asyncHandler, parsePaging } from '../utils/http'
import { cacheClear } from '../utils/cache'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { branchScope } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { notify } from '../utils/notify'
import { emitScoped } from '../realtime/socket'
import { versionFilter, hasIfMatch } from '../utils/concurrency'

const router = Router()
router.use(requireAuth)

const populate = [
  { path: 'assigneeId', select: 'fullName avatarColor' },
  { path: 'assignerId', select: 'fullName' },
]

/** Compute live seconds for a running timer. */
function liveSeconds(task: { timer?: { running?: boolean; startedAt?: Date | null; accumulatedSeconds?: number } | null }): number {
  const t = task.timer
  if (!t) return 0
  let s = t.accumulatedSeconds || 0
  if (t.running && t.startedAt) s += Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000)
  return s
}

/** Apply a status change to a task doc, managing the timer (shared by single + bulk move). */
function applyStatusTransition(task: { status: string; timer?: { running?: boolean; startedAt?: Date | null; accumulatedSeconds?: number } | null; actualSeconds?: number; completedAt?: Date }, status: string) {
  const prev = task.status
  const timer = task.timer || { running: false, accumulatedSeconds: 0 }
  if (timer.running && status !== 'inprogress' && timer.startedAt) {
    timer.accumulatedSeconds = (timer.accumulatedSeconds || 0) + Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000)
    timer.running = false
    timer.startedAt = null
  }
  if (status === 'inprogress' && prev !== 'inprogress') {
    timer.running = true
    timer.startedAt = new Date()
  }
  if (status === 'done') {
    timer.running = false
    task.actualSeconds = timer.accumulatedSeconds || 0
    task.completedAt = new Date()
  }
  task.timer = timer
  task.status = status
  return prev
}

/** Who may edit/move a task: superadmin, the assigner/assignee, or an admin of the task's branch. */
function canWriteTask(user: { id: string; role: string; branchId?: string | null }, task: { assigneeId?: unknown; assignerId?: unknown; branchId?: unknown }): boolean {
  if (user.role === 'superadmin') return true
  if (String(task.assigneeId) === user.id || String(task.assignerId) === user.id) return true
  if (user.role === 'admin' && (!user.branchId || String(task.branchId) === String(user.branchId))) return true
  return false
}

// GET /tasks?assignee=&status=&project=&priority=&branch=&range=today|week|overdue|all&page=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip, sort } = parsePaging(req.query as Record<string, unknown>)
  const filter: Record<string, unknown> = { isDeleted: false, ...branchScope(req) }
  // Employees see tasks they are assigned to OR tasks they created/assigned; managers/superadmin can filter by assignee.
  if (req.user!.role === 'employee') filter.$or = [{ assigneeId: req.user!.id }, { assignerId: req.user!.id }]
  else if (req.query.assignee) filter.assigneeId = req.query.assignee
  if (req.query.status) filter.status = req.query.status
  if (req.query.project) filter.projectId = req.query.project
  if (req.query.priority) filter.priority = req.query.priority
  // Branch filter is honoured only for superadmin (others are already branch-scoped).
  if (req.user!.role === 'superadmin' && req.query.branch) filter.branchId = req.query.branch
  // Time range — overdue keys off status, today/week off the due date.
  const range = req.query.range
  if (range === 'overdue') {
    filter.status = 'overdue'
  } else if (range === 'today' || range === 'week') {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    if (range === 'today') end.setDate(end.getDate() + 1)
    else end.setDate(end.getDate() + 7)
    filter.dueAt = { $gte: start, $lt: end }
  }
  const [rows, total] = await Promise.all([
    Task.find(filter).populate(populate).sort(sort).skip(skip).limit(limit).lean(),
    Task.countDocuments(filter),
  ])
  ok(res, rows.map(r => ({ ...r, liveSeconds: liveSeconds(r) })), { page, limit, total })
}))

const createBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  assigneeId: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  difficulty: z.number().min(1).max(5).optional(),
  dueAt: z.coerce.date().optional(),
})

router.post('/', validate(createBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createBody>
  // assignment authority: all authenticated users are permitted to create/assign tasks
  // (Previously restricted to superadmin/admin)
  // The task belongs to the assignee's branch so branch-scoped users can see their own tasks
  // (a superadmin assigner has no branch of their own).
  const assignee = await User.findById(body.assigneeId).select('branchId').lean()
  const doc = await Task.create({
    ...body,
    assignerId: req.user!.id,
    branchId: assignee?.branchId || req.user!.branchId,
    status: 'todo',
    timer: { running: false, accumulatedSeconds: 0 },
    createdBy: req.user!.id,
  })
  await notify(body.assigneeId, { type: 'task.assigned', title: 'New task assigned', body: body.title, color: 'info', link: '/kanban' })
  await audit(req.user, 'task.create', 'Task', doc._id)
  cacheClear('dashboard') // counters changed
  emitScoped('task:moved', { id: doc._id }, { branchId: doc.branchId, userId: doc.assigneeId })
  created(res, doc)
}))

// PATCH /tasks/:id — edit; only assigner may change dueAt
router.patch('/:id', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, isDeleted: false })
  if (!task) throw ApiError.notFound('Task not found')
  if (!canWriteTask(req.user!, task)) throw ApiError.forbidden('You are not permitted to edit this task')
  if (hasIfMatch(req) && (task as unknown as { version: number }).version !== versionFilter(req).version) {
    throw ApiError.conflict('This task was changed elsewhere — reload and try again.')
  }
  const body = { ...req.body }
  if (body.dueAt !== undefined && String(task.assignerId) !== req.user!.id && req.user!.role === 'employee') {
    throw ApiError.forbidden('Only the assigner can change the due date')
  }
  const reassigned = body.assigneeId !== undefined && String(body.assigneeId) !== String(task.assigneeId)
  for (const k of ['title', 'description', 'priority', 'difficulty', 'assigneeId', 'dueAt'] as const) {
    if (body[k] !== undefined) (task as unknown as Record<string, unknown>)[k] = body[k]
  }
  // Reassignment moves the task to the new assignee's branch so it stays in their scope.
  if (reassigned) {
    const assignee = await User.findById(body.assigneeId).select('branchId').lean()
    if (assignee?.branchId) task.branchId = assignee.branchId as never
    await notify(String(body.assigneeId), { type: 'task.assigned', title: 'Task assigned to you', body: task.title, color: 'info', link: '/kanban' })
  }
  task.updatedBy = req.user!.id as never
  task.increment() // bump version for optimistic concurrency
  await task.save()
  await audit(req.user, 'task.update', 'Task', task._id)
  cacheClear('dashboard')
  emitScoped('task:updated', { id: task._id }, { branchId: task.branchId, userId: task.assigneeId })
  ok(res, task)
}))

// PATCH /tasks/:id/move — change state; manages the timer (Blueprint M6 §6)
const moveBody = z.object({ status: z.enum(['todo', 'inprogress', 'done', 'overdue']) })
router.patch('/:id/move', validate(moveBody), asyncHandler(async (req, res) => {
  const { status } = req.body as z.infer<typeof moveBody>
  const task = await Task.findOne({ _id: req.params.id, isDeleted: false })
  if (!task) throw ApiError.notFound('Task not found')
  if (!canWriteTask(req.user!, task)) throw ApiError.forbidden('You are not permitted to move this task')
  if (status === 'overdue') throw ApiError.badRequest('Overdue is system-managed and cannot be set manually')

  const prev = applyStatusTransition(task as never, status)
  await task.save()

  cacheClear('dashboard') // status counts changed
  emitScoped('task:moved', { id: task._id, status }, { branchId: task.branchId, userId: task.assigneeId })
  // Keep the assigner informed of progress they didn't make themselves.
  if (status !== prev && task.assignerId && String(task.assignerId) !== req.user!.id) {
    await notify(String(task.assignerId), { type: 'task.status', title: 'Task status changed', body: `${task.title} → ${status}`, color: status === 'done' ? 'ok' : 'info', link: '/kanban' })
  }
  await audit(req.user, 'task.move', 'Task', task._id, { before: { status: prev }, after: { status } })
  ok(res, { ...task.toObject(), liveSeconds: liveSeconds(task) })
}))

// DELETE /tasks/:id — soft delete
router.delete('/:id', asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.id, isDeleted: false })
  if (!task) throw ApiError.notFound('Task not found')
  if (!canWriteTask(req.user!, task)) throw ApiError.forbidden('You are not permitted to delete this task')
  task.isDeleted = true as never
  task.updatedBy = req.user!.id as never
  await task.save()
  await audit(req.user, 'task.delete', 'Task', task._id)
  cacheClear('dashboard')
  emitScoped('task:moved', { id: task._id, deleted: true }, { branchId: task.branchId, userId: task.assigneeId })
  ok(res, { deleted: true })
}))

// POST /tasks/bulk — bulk move / reassign / delete (per-task authorization)
const bulkBody = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(['move', 'reassign', 'delete']),
  status: z.enum(['todo', 'inprogress', 'done']).optional(),
  assigneeId: z.string().optional(),
})
router.post('/bulk', validate(bulkBody), asyncHandler(async (req, res) => {
  const { ids, action, status, assigneeId } = req.body as z.infer<typeof bulkBody>
  if (action === 'move' && !status) throw ApiError.badRequest('status is required for a bulk move')
  if (action === 'reassign' && !assigneeId) throw ApiError.badRequest('assigneeId is required for a bulk reassign')

  const tasks = await Task.find({ _id: { $in: ids }, isDeleted: false, ...branchScope(req) })
  const newBranch = action === 'reassign'
    ? (await User.findById(assigneeId).select('branchId').lean())?.branchId
    : undefined

  let affected = 0, skipped = 0
  for (const task of tasks) {
    if (!canWriteTask(req.user!, task)) { skipped++; continue }
    if (action === 'delete') {
      task.isDeleted = true as never
    } else if (action === 'move') {
      applyStatusTransition(task as never, status as string)
    } else if (action === 'reassign') {
      task.assigneeId = assigneeId as never
      if (newBranch) task.branchId = newBranch as never
    }
    task.updatedBy = req.user!.id as never
    await task.save()
    affected++
    emitScoped('task:moved', { id: task._id }, { branchId: task.branchId, userId: task.assigneeId })
    if (action === 'reassign') await notify(String(assigneeId), { type: 'task.assigned', title: 'Task assigned to you', body: task.title, color: 'info', link: '/kanban' })
  }
  await audit(req.user, `task.bulk.${action}`, 'Task', ids.join(','), { after: { affected, skipped } })
  if (affected) cacheClear('dashboard')
  ok(res, { affected, skipped })
}))

export default router
