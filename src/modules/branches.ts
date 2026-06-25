import { Router } from 'express'
import { z } from 'zod'
import { Branch, Holiday } from '../models/Branch'
import { User } from '../models/User'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { weekendLabel } from '../utils/weekend'

const router = Router()
router.use(requireAuth)

const branchBody = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  timezone: z.string().optional(),
  shift: z.object({ startTime: z.string(), endTime: z.string(), graceMinutes: z.number() }).partial().optional(),
  breaks: z.object({ lunchMinutes: z.number(), teaMinutes: z.number() }).partial().optional(),
  weekend: z.object({
    sundayOff: z.boolean(),
    saturdayWeeks: z.array(z.number().int().min(1).max(5)),
  }).partial().optional(),
  leaveAllocation: z.object({ paid: z.number(), sick: z.number(), casual: z.number() }).partial().optional(),
  allowedIps: z.array(z.string()).optional(),
})

// GET /branches — list with employee counts
router.get('/', asyncHandler(async (_req, res) => {
  const branches = await Branch.find({ isDeleted: false }).sort({ name: 1 }).lean()
  const counts = await User.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$branchId', n: { $sum: 1 } } },
  ])
  const map: Record<string, number> = {}
  counts.forEach(c => { if (c._id) map[String(c._id)] = c.n })
  ok(res, branches.map(b => ({ ...b, emps: map[String(b._id)] || 0, weekendLabel: weekendLabel(b.weekend) })))
}))

router.post('/', requireRole('superadmin'), validate(branchBody), asyncHandler(async (req, res) => {
  const doc = await Branch.create({ ...req.body, createdBy: req.user!.id })
  await audit(req.user, 'branch.create', 'Branch', doc._id, { after: doc })
  created(res, doc)
}))

router.patch('/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const before = await Branch.findById(req.params.id).lean()
  const doc = await Branch.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user!.id }, { new: true })
  if (!doc) throw ApiError.notFound('Branch not found')
  await audit(req.user, 'branch.update', 'Branch', doc._id, { before, after: doc })
  ok(res, doc)
}))

// DELETE /branches/:id — soft-delete (Super Admin); blocked while employees are assigned
router.delete('/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const branch = await Branch.findOne({ _id: req.params.id, isDeleted: false })
  if (!branch) throw ApiError.notFound('Branch not found')
  const emps = await User.countDocuments({ branchId: branch._id, isDeleted: false })
  if (emps > 0) throw ApiError.conflict(`Reassign or remove this branch's ${emps} employee(s) before deleting it`)
  branch.isDeleted = true as never
  branch.isActive = false as never
  branch.updatedBy = req.user!.id as never
  await branch.save()
  await audit(req.user, 'branch.delete', 'Branch', branch._id)
  ok(res, { deleted: true })
}))

// Holidays
router.get('/:id/holidays', asyncHandler(async (req, res) => {
  ok(res, await Holiday.find({ branchId: req.params.id }).sort({ date: 1 }).lean())
}))
router.post('/:id/holidays', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const doc = await Holiday.create({ ...req.body, branchId: req.params.id })
  created(res, doc)
}))

export default router
