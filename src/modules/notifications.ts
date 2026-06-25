import { Router } from 'express'
import { Notification } from '../models/misc'
import { ok, asyncHandler } from '../utils/http'
import { requireAuth } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

// GET /notifications
router.get('/', asyncHandler(async (req, res) => {
  const rows = await Notification.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50).lean()
  const unread = await Notification.countDocuments({ userId: req.user!.id, read: false })
  ok(res, rows, { total: unread })
}))

// PATCH /notifications/:id/read
router.patch('/:id/read', asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user!.id }, { read: true })
  ok(res, { read: true })
}))

// POST /notifications/read-all
router.post('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true })
  ok(res, { read: true })
}))

export default router
