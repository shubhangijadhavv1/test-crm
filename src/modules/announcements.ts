import { Router } from 'express'
import { z } from 'zod'
import { Announcement, AnnouncementRead } from '../models/announcement'
import { User } from '../models/User'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { emitAll } from '../realtime/socket'

const router = Router()
router.use(requireAuth)

/** Does this user match an announcement's audience? (server-side scoping, M15 §10) */
function matchesAudience(a: { audience?: { scope?: string; branchIds?: unknown[]; departments?: string[]; roles?: string[]; userIds?: unknown[] } }, user: { id: string; role: string; branchId: string | null; department?: string | null }): boolean {
  const aud = a.audience
  if (!aud || aud.scope === 'all') return true
  if (aud.scope === 'branch') return (aud.branchIds || []).map(String).includes(String(user.branchId))
  if (aud.scope === 'role') return (aud.roles || []).includes(user.role)
  if (aud.scope === 'department') return !!user.department && (aud.departments || []).includes(user.department)
  if (aud.scope === 'users') return (aud.userIds || []).map(String).includes(user.id)
  return false
}

// GET /announcements — targeted feed (admins see all)
router.get('/', asyncHandler(async (req, res) => {
  const me = await User.findById(req.user!.id).select('role branchId department').lean()
  const all = await Announcement.find({ isDeleted: false, status: 'published' }).sort({ pinned: -1, createdAt: -1 }).lean()
  const isAdmin = req.user!.role !== 'employee'
  const visible = isAdmin ? all : all.filter(a => matchesAudience(a as never, { id: req.user!.id, role: req.user!.role, branchId: req.user!.branchId, department: me?.department }))
  const reads = await AnnouncementRead.find({ userId: req.user!.id }).lean()
  const readMap = new Map(reads.map(r => [String(r.announcementId), r]))
  ok(res, visible.map(a => {
    const r = readMap.get(String(a._id))
    return { ...a, read: !!r?.readAt, acked: !!r?.acknowledgedAt }
  }))
}))

const createBody = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  priority: z.enum(['info', 'important', 'urgent']).optional(),
  pinned: z.boolean().optional(),
  requireAck: z.boolean().optional(),
  audience: z.object({
    scope: z.enum(['all', 'branch', 'department', 'role', 'users']),
    branchIds: z.array(z.string()).optional(),
    departments: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
  }).optional(),
})

router.post('/', requireRole('superadmin', 'admin'), validate(createBody), asyncHandler(async (req, res) => {
  const me = await User.findById(req.user!.id).lean()
  const doc = await Announcement.create({
    ...req.body,
    status: 'published',
    publishAt: new Date(),
    authorId: req.user!.id,
    authorName: me?.fullName,
    createdBy: req.user!.id,
  })
  await audit(req.user, 'announcement.publish', 'Announcement', doc._id)
  emitAll('announcement:new', { id: doc._id, title: doc.title })
  created(res, doc)
}))

router.post('/:id/read', asyncHandler(async (req, res) => {
  await AnnouncementRead.findOneAndUpdate(
    { announcementId: req.params.id, userId: req.user!.id },
    { $setOnInsert: { readAt: new Date() } },
    { upsert: true, new: true }
  )
  ok(res, { read: true })
}))

router.post('/:id/ack', asyncHandler(async (req, res) => {
  const now = new Date()
  await AnnouncementRead.findOneAndUpdate(
    { announcementId: req.params.id, userId: req.user!.id },
    { readAt: now, acknowledgedAt: now },
    { upsert: true, new: true }
  )
  ok(res, { acknowledged: true })
}))

router.get('/:id/receipts', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const reads = await AnnouncementRead.find({ announcementId: req.params.id }).populate('userId', 'fullName').lean()
  ok(res, { reads, readCount: reads.filter(r => r.readAt).length, ackCount: reads.filter(r => r.acknowledgedAt).length })
}))

router.delete('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const doc = await Announcement.findByIdAndUpdate(req.params.id, { isDeleted: true, status: 'archived' }, { new: true })
  if (!doc) throw ApiError.notFound('Announcement not found')
  await audit(req.user, 'announcement.delete', 'Announcement', doc._id)
  ok(res, { deleted: true })
}))

export default router
