import { Router } from 'express'
import { z } from 'zod'
import { Types } from 'mongoose'
import { Project } from '../models/Project'
import { User } from '../models/User'
import { ok, created, asyncHandler, parsePaging } from '../utils/http'
import { safeRegex } from '../utils/regex'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole, branchFilter } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { ensureQaProcess } from './qa'
import { versionFilter, hasIfMatch } from '../utils/concurrency'

const router = Router()
router.use(requireAuth)

const populate = [
  { path: 'ownerId', select: 'fullName avatarColor' },
  { path: 'categoryId', select: 'name' },
  { path: 'subCategoryId', select: 'name' },
  { path: 'websiteTypeId', select: 'name' },
  { path: 'serverId', select: 'name' },
]

const createBody = z.object({
  type: z.enum(['live', 'demo']),
  name: z.string().min(1),
  url: z.string().optional(),
  clientName: z.string().optional(),
  categoryId: z.string().optional(),
  subCategoryId: z.string().optional(),
  websiteTypeId: z.string().optional(),
  serverId: z.string().optional(),
  ownerId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
})

// GET /projects?type=&status=&q=&page=
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip, sort } = parsePaging(req.query as Record<string, unknown>)
  const filter: Record<string, unknown> = { isDeleted: false, ...branchFilter(req) }
  if (req.query.type) filter.type = req.query.type
  if (req.query.status) filter.status = req.query.status
  if (req.query.priority) filter.priority = req.query.priority
  if (req.query.categoryId) filter.categoryId = req.query.categoryId
  if (req.query.serverId) filter.serverId = req.query.serverId
  // own/assigned projects ('me' resolves to the caller)
  if (req.query.owner) filter.ownerId = req.query.owner === 'me' ? req.user!.id : req.query.owner
  if (req.query.q) { const rx = safeRegex(req.query.q); filter.$or = [{ name: rx }, { url: rx }] }
  const [rows, total] = await Promise.all([
    Project.find(filter).populate(populate).sort(sort).skip(skip).limit(limit).lean(),
    Project.countDocuments(filter),
  ])
  ok(res, rows, { page, limit, total })
}))

// aggregate() does not auto-cast strings to ObjectId, so build the branch match explicitly
function aggMatch(req: import('express').Request): Record<string, unknown> {
  const bf = branchFilter(req) as { branchId?: string }
  const match: Record<string, unknown> = { isDeleted: false }
  if (bf.branchId) match.branchId = new Types.ObjectId(bf.branchId)
  return match
}

router.get('/analytics/by-employee', asyncHandler(async (req, res) => {
  const rows = await Project.aggregate([
    { $match: aggMatch(req) },
    { $group: { _id: { ownerId: '$ownerId', type: '$type' }, n: { $sum: 1 } } },
  ])
  ok(res, rows)
}))

router.get('/analytics/by-server', asyncHandler(async (req, res) => {
  const rows = await Project.aggregate([
    { $match: aggMatch(req) },
    { $group: { _id: { serverId: '$serverId', type: '$type' }, n: { $sum: 1 } } },
  ])
  ok(res, rows)
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await Project.findOne({ _id: req.params.id, isDeleted: false }).populate(populate).lean()
  if (!doc) throw ApiError.notFound('Project not found')
  ok(res, doc)
}))

router.post('/', requireRole('superadmin', 'admin'), validate(createBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createBody>
  if (body.dueDate && body.startDate && body.dueDate < body.startDate) throw ApiError.badRequest('dueDate must be on or after startDate')
  const count = await Project.estimatedDocumentCount()
  // A project belongs to its assigned employee's branch (so the owner can see it),
  // else an explicit branch, else the creator's branch.
  const owner = body.ownerId ? await User.findById(body.ownerId).select('branchId').lean() : null
  const branchId = body.branchId || owner?.branchId || req.user!.branchId
  const doc = await Project.create({
    ...body,
    projectCode: `${body.type === 'live' ? 'LIV' : 'DEM'}-${String(count + 1).padStart(4, '0')}`,
    branchId,
    createdBy: req.user!.id,
  })
  await audit(req.user, 'project.create', 'Project', doc._id, { after: doc })
  created(res, doc)
}))

router.patch('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const update = { ...req.body }
  delete update.status // status only via guarded route
  // Reassigning the employee moves the project to that employee's branch (unless branch set explicitly).
  if (update.ownerId && update.branchId === undefined) {
    const owner = await User.findById(update.ownerId).select('branchId').lean()
    if (owner?.branchId) update.branchId = owner.branchId
  }
  const doc = await Project.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false, ...versionFilter(req) },
    { ...update, updatedBy: req.user!.id, $inc: { version: 1 } },
    { new: true }
  )
  if (!doc) {
    if (hasIfMatch(req) && await Project.exists({ _id: req.params.id, isDeleted: false })) {
      throw ApiError.conflict('This project was changed elsewhere — reload and try again.')
    }
    throw ApiError.notFound('Project not found')
  }
  await audit(req.user, 'project.update', 'Project', doc._id)
  ok(res, doc)
}))

// PATCH /projects/:id/status — guarded state machine
const statusBody = z.object({ status: z.enum(['pending', 'development', 'qa', 'revision', 'completed', 'onhold', 'live', 'finished', 'domain_transfer']) })
router.patch('/:id/status', validate(statusBody), asyncHandler(async (req, res) => {
  const { status } = req.body as z.infer<typeof statusBody>
  const doc = await Project.findOne({ _id: req.params.id, isDeleted: false })
  if (!doc) throw ApiError.notFound('Project not found')

  // Employees may only update the status of their own projects.
  if (req.user!.role === 'employee' && String(doc.ownerId) !== req.user!.id) {
    throw ApiError.forbidden('You can only update the status of your own projects')
  }

  const isDemo = doc.type === 'demo'
  // QA only applies to live projects.
  if (status === 'qa' && isDemo) throw ApiError.badRequest('QA is only required for live projects — demo projects skip QA')
  // Live projects complete automatically when both QA checklists reach 100% — no manual completion.
  if (status === 'completed' && !isDemo) throw ApiError.badRequest('Live projects complete automatically once both QA checklists reach 100%')

  // Statuses a user may set manually (any-to-any within the allowed set for the type).
  // 'completed' for live is excluded above (auto via QA).
  const allowed = isDemo
    ? ['pending', 'development', 'revision', 'onhold', 'completed', 'finished', 'domain_transfer']
    : ['pending', 'development', 'qa', 'revision', 'onhold', 'live', 'finished']
  if (!allowed.includes(status)) throw ApiError.badRequest(`Status "${status}" is not allowed for ${isDemo ? 'demo' : 'live'} projects`)

  const from = doc.status as string
  if (from === status) return ok(res, doc)

  doc.status = status as never
  if (status === 'completed') { doc.completedAt = new Date(); if (isDemo) doc.qaProgress = 100 as never }
  doc.updatedBy = req.user!.id as never
  await doc.save()

  // Entering QA creates/links the QA process (live only)
  if (status === 'qa' && !isDemo) await ensureQaProcess(String(doc._id), doc.branchId ? String(doc.branchId) : null)

  await audit(req.user, 'project.status', 'Project', doc._id, { before: { status: from }, after: { status } })
  ok(res, doc)
}))

router.delete('/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const doc = await Project.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true })
  if (!doc) throw ApiError.notFound('Project not found')
  await audit(req.user, 'project.delete', 'Project', doc._id)
  ok(res, { deleted: true })
}))

export default router
