import { Router } from 'express'
import { z } from 'zod'
import { LeaveRequest, LeaveBalance } from '../models/leave'
import { User } from '../models/User'
import { Branch } from '../models/Branch'
import { Attendance } from '../models/Attendance'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { notify } from '../utils/notify'

const router = Router()
router.use(requireAuth)

function daysBetween(from: Date, to: Date, half: boolean): number {
  if (half) return 0.5
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
}

// half-day is counted against the casual bucket
const balKey = (type: string) => (type === 'halfday' ? 'casual' : type)

/** Ensure a yearly balance doc exists (seeded from branch allocation). */
async function ensureBalance(userId: unknown, year: number, branchId: unknown) {
  const existing = await LeaveBalance.findOne({ userId, year })
  if (existing) return existing
  const branch = branchId ? await Branch.findById(branchId).lean() : null
  return LeaveBalance.create({ userId, year, allocated: branch?.leaveAllocation || { paid: 24, sick: 6, casual: 6 } })
}

/** All YYYY-MM-DD dates in an inclusive range (UTC, timezone-safe). */
function eachDate(from: Date, to: Date): string[] {
  const out: string[] = []
  let d = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  while (d <= end) { out.push(new Date(d).toISOString().slice(0, 10)); d += 86400000 }
  return out
}

const applyBody = z.object({
  type: z.enum(['paid', 'sick', 'casual', 'halfday']),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  reason: z.string().optional(),
})

// POST /leaves — apply
router.post('/', validate(applyBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof applyBody>
  if (body.toDate < body.fromDate) throw ApiError.badRequest('toDate must be on or after fromDate')
  const days = daysBetween(body.fromDate, body.toDate, body.type === 'halfday')
  const user = await User.findById(req.user!.id).lean()
  const doc = await LeaveRequest.create({
    userId: req.user!.id, branchId: user?.branchId, type: body.type,
    fromDate: body.fromDate, toDate: body.toDate, days, reason: body.reason, status: 'pending', createdBy: req.user!.id,
  })
  // hold the days against the pending balance
  const year = body.fromDate.getFullYear()
  await ensureBalance(req.user!.id, year, user?.branchId)
  await LeaveBalance.updateOne({ userId: req.user!.id, year }, { $inc: { [`pending.${balKey(body.type)}`]: days } })
  // notify managers of the same branch
  const managers = await User.find({ role: { $in: ['admin', 'superadmin'] }, isDeleted: false }).select('_id').lean()
  await Promise.all(managers.map(m => notify(String(m._id), { type: 'leave.requested', title: 'Leave request', body: `${user?.fullName} requested ${days} day(s) ${body.type}`, color: 'info', link: '/attendance' })))
  await audit(req.user, 'leave.apply', 'LeaveRequest', doc._id)
  created(res, doc)
}))

// GET /leaves/me — own balance + history
router.get('/me', asyncHandler(async (req, res) => {
  const year = new Date().getFullYear()
  const user = await User.findById(req.user!.id).lean()
  let balance = await LeaveBalance.findOne({ userId: req.user!.id, year }).lean()
  if (!balance) {
    const branch = user?.branchId ? await Branch.findById(user.branchId).lean() : null
    const alloc = branch?.leaveAllocation || { paid: 24, sick: 6, casual: 6 }
    balance = (await LeaveBalance.create({ userId: req.user!.id, year, allocated: alloc })).toObject()
  }
  const history = await LeaveRequest.find({ userId: req.user!.id, isDeleted: false }).sort({ createdAt: -1 }).lean()
  ok(res, { balance, history })
}))

// GET /leaves?status=pending — manager inbox
router.get('/', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { isDeleted: false }
  if (req.query.status) filter.status = req.query.status
  if (req.user!.role !== 'superadmin' && req.user!.branchId) filter.branchId = req.user!.branchId
  const rows = await LeaveRequest.find(filter).populate('userId', 'fullName department avatarColor').sort({ createdAt: -1 }).lean()
  ok(res, rows)
}))

// PATCH /leaves/:id/decision — approve/reject
const decisionBody = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().optional() })
router.patch('/:id/decision', requireRole('superadmin', 'admin'), validate(decisionBody), asyncHandler(async (req, res) => {
  const { decision, note } = req.body as z.infer<typeof decisionBody>
  const lr = await LeaveRequest.findById(req.params.id)
  if (!lr) throw ApiError.notFound('Leave request not found')
  if (lr.status !== 'pending') throw ApiError.conflict('Leave request already decided')
  lr.status = decision as never
  lr.decidedBy = req.user!.id as never
  lr.decidedAt = new Date()
  lr.decisionNote = note
  await lr.save()

  const year = new Date(lr.fromDate as Date).getFullYear()
  const key = balKey(lr.type as string)
  if (decision === 'approved') {
    // move the held days from pending → used and mark the calendar days as leave
    await LeaveBalance.updateOne({ userId: lr.userId, year }, { $inc: { [`used.${key}`]: lr.days, [`pending.${key}`]: -lr.days } })
    const dates = eachDate(lr.fromDate as Date, lr.toDate as Date)
    await Promise.all(dates.map(date =>
      Attendance.updateOne(
        { userId: lr.userId, date },
        { $set: { status: 'leave', branchId: lr.branchId }, $setOnInsert: { source: 'web' } },
        { upsert: true }
      )
    ))
  } else {
    // release the pending hold
    await LeaveBalance.updateOne({ userId: lr.userId, year }, { $inc: { [`pending.${key}`]: -lr.days } })
  }
  await notify(String(lr.userId), { type: 'leave.decision', title: `Leave ${decision}`, body: note || `Your ${lr.type} leave was ${decision}`, color: decision === 'approved' ? 'ok' : 'bad', link: '/my-workspace' })
  await audit(req.user, 'leave.decision', 'LeaveRequest', lr._id, { after: { decision } })
  ok(res, lr)
}))

export default router
