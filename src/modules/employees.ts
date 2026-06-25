import { Router } from 'express'
import { z } from 'zod'
import { User } from '../models/User'
import { Project } from '../models/Project'
import { Task } from '../models/Task'
import { ok, created, asyncHandler, parsePaging } from '../utils/http'
import { safeRegex } from '../utils/regex'
import { validate } from '../middleware/validate'
import { requireAuth, Role } from '../middleware/auth'
import { requireRole, branchScope, branchFilter } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { hashPassword } from '../utils/password'
import { audit } from '../utils/audit'
import { Session } from '../models/misc'
import { defaultModuleAccess, sanitizeModuleAccess } from '../utils/access'

const router = Router()
router.use(requireAuth)

const createBody = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  employeeId: z.string().optional(),
  role: z.enum(['superadmin', 'admin', 'employee']).default('employee'),
  branchId: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  workMode: z.enum(['office', 'wfh', 'hybrid']).optional(),
  moduleAccess: z.record(z.boolean()).optional(),
  allowedIps: z.array(z.string()).optional(),
  webPunchEnabled: z.boolean().optional(),
})

const roleRank: Record<Role, number> = { employee: 1, admin: 2, superadmin: 3 }

// GET /employees — directory (branch-scoped for non-SA; employees see only themselves)
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip, sort } = parsePaging(req.query as Record<string, unknown>)
  const filter: Record<string, unknown> = { isDeleted: false, ...branchFilter(req) }
  // Employees are strictly self-scoped (own profile / own performance only).
  if (req.user!.role === 'employee') filter._id = req.user!.id
  if (req.query.dept) filter.department = req.query.dept
  if (req.query.branch) filter.branchId = req.query.branch
  if (req.query.q) {
    const rx = safeRegex(req.query.q)
    filter.$or = [{ fullName: rx }, { email: rx }, { department: rx }, { designation: rx }]
  }
  const [rows, total] = await Promise.all([
    User.find(filter).select('-passwordHash -security.twoFactorSecret').populate('branchId', 'name').sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ])
  ok(res, rows, { page, limit, total })
}))

// GET /employees/options — minimal {_id, fullName} list for assignment dropdowns
// (QA reviewer, task assignee). Branch-scoped; available to any authenticated user.
// Defined before '/:id' so it isn't captured as an id param.
router.get('/options', asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { isDeleted: false, status: 'active', ...branchFilter(req) }
  const rows = await User.find(filter).select('fullName department branchId').sort({ fullName: 1 }).lean()
  ok(res, rows)
}))

// GET /employees/:id — aggregated profile (employees may only read their own)
router.get('/:id', asyncHandler(async (req, res) => {
  if (req.user!.role === 'employee' && req.params.id !== req.user!.id) throw ApiError.forbidden('You can only view your own profile')
  const user = await User.findOne({ _id: req.params.id, isDeleted: false })
    .select('-passwordHash -security.twoFactorSecret').populate('branchId', 'name').lean()
  if (!user) throw ApiError.notFound('Employee not found')
  const [projects, tasksTotal, tasksDone, tasksInProgress] = await Promise.all([
    Project.countDocuments({ ownerId: user._id, isDeleted: false }),
    Task.countDocuments({ assigneeId: user._id, isDeleted: false }),
    Task.countDocuments({ assigneeId: user._id, status: 'done', isDeleted: false }),
    Task.countDocuments({ assigneeId: user._id, status: 'inprogress', isDeleted: false }),
  ])
  ok(res, { ...user, stats: { projects, tasksTotal, tasksDone, tasksInProgress } })
}))

// POST /employees — create (admins cannot escalate above their own role)
router.post('/', requireRole('superadmin', 'admin'), validate(createBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createBody>
  if (roleRank[body.role] > roleRank[req.user!.role]) {
    throw ApiError.forbidden('You cannot create a user with a higher role than your own')
  }
  const passwordHash = await hashPassword(body.password)
  const count = await User.estimatedDocumentCount()
  // Super Admin decides module access; fall back to role defaults.
  const moduleAccess = body.moduleAccess ? sanitizeModuleAccess(body.moduleAccess) : defaultModuleAccess(body.role)
  const doc = await User.create({
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
    createdBy: req.user!.id,
  })
  await audit(req.user, 'employee.create', 'User', doc._id)
  const safe = await User.findById(doc._id).select('-passwordHash -security.twoFactorSecret').lean()
  created(res, safe)
}))

router.patch('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const update = { ...req.body }
  delete update.passwordHash; delete update.password; delete update.role // role via dedicated path
  const doc = await User.findByIdAndUpdate(req.params.id, { ...update, updatedBy: req.user!.id }, { new: true })
    .select('-passwordHash -security.twoFactorSecret')
  if (!doc) throw ApiError.notFound('Employee not found')
  await audit(req.user, 'employee.update', 'User', doc._id)
  ok(res, doc)
}))

// DELETE /:id — soft-delete an employee (superadmin / branch admin), revoke their sessions
router.delete('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  if (req.params.id === req.user!.id) throw ApiError.badRequest('You cannot delete your own account')
  const target = await User.findOne({ _id: req.params.id, isDeleted: false })
  if (!target) throw ApiError.notFound('Employee not found')
  if (target.role === 'superadmin') throw ApiError.forbidden('Super Admin cannot be deleted')
  if (req.user!.role === 'admin' && req.user!.branchId && String(target.branchId) !== String(req.user!.branchId)) {
    throw ApiError.forbidden('You can only delete employees in your branch')
  }
  target.isDeleted = true as never
  target.status = 'suspended' as never
  target.updatedBy = req.user!.id as never
  await target.save()
  await Session.updateMany({ userId: target._id }, { revoked: true })
  await audit(req.user, 'employee.delete', 'User', target._id)
  ok(res, { deleted: true })
}))

// PATCH /:id/permissions — Super Admin sets module access (and optionally role).
router.patch('/:id/permissions', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const update: Record<string, unknown> = { updatedBy: req.user!.id }
  if (req.body.moduleAccess) update.moduleAccess = sanitizeModuleAccess(req.body.moduleAccess)
  if (req.body.permissions) update.permissions = req.body.permissions
  if (req.body.role) {
    if (roleRank[req.body.role as Role] > roleRank[req.user!.role]) throw ApiError.forbidden('Cannot assign a role higher than your own')
    update.role = req.body.role
  }
  const doc = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-passwordHash')
  if (!doc) throw ApiError.notFound('Employee not found')
  await audit(req.user, 'employee.permissions', 'User', doc._id, { after: update })
  ok(res, doc)
}))

router.patch('/:id/status', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const status = req.body.status === 'suspended' ? 'suspended' : 'active'
  const doc = await User.findByIdAndUpdate(req.params.id, { status, updatedBy: req.user!.id }, { new: true }).select('-passwordHash')
  if (!doc) throw ApiError.notFound('Employee not found')
  if (status === 'suspended') await Session.updateMany({ userId: doc._id }, { revoked: true })
  await audit(req.user, 'employee.status', 'User', doc._id, { after: { status } })
  ok(res, doc)
}))

router.post('/:id/reset-password', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const temp = req.body.password || Math.random().toString(36).slice(2, 10) + 'A1!'
  const passwordHash = await hashPassword(temp)
  const doc = await User.findByIdAndUpdate(req.params.id, { passwordHash }, { new: true }).select('_id email')
  if (!doc) throw ApiError.notFound('Employee not found')
  await Session.updateMany({ userId: doc._id }, { revoked: true })
  await audit(req.user, 'employee.reset_password', 'User', doc._id)
  ok(res, { reset: true, tempPassword: temp })
}))

router.post('/:id/reset-2fa', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const doc = await User.findByIdAndUpdate(
    req.params.id,
    { 'security.twoFactorEnabled': false, $unset: { 'security.twoFactorSecret': 1 } },
    { new: true }
  ).select('_id')
  if (!doc) throw ApiError.notFound('Employee not found')
  await audit(req.user, 'employee.reset_2fa', 'User', doc._id)
  ok(res, { reset: true })
}))

export default router
