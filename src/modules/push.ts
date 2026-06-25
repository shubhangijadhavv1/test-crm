import { Router } from 'express'
import { z } from 'zod'
import { PushSubscription } from '../models/push'
import { env } from '../config/env'
import { ok, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { sendPush } from '../services/webpush'

const router = Router()

// Public: the VAPID public key the browser needs to subscribe.
router.get('/vapid', (_req, res) => ok(res, { publicKey: env.vapid.publicKey }))

router.use(requireAuth)

const subBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
})

// Save / refresh this browser's push subscription for the current user.
router.post('/subscribe', validate(subBody), asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body as z.infer<typeof subBody>
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { userId: req.user!.id, endpoint, keys, userAgent: req.headers['user-agent'] },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
  ok(res, { subscribed: true })
}))

// Remove this browser's subscription.
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const endpoint = (req.body as { endpoint?: string }).endpoint
  if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: req.user!.id })
  ok(res, { unsubscribed: true })
}))

// Send a test push to the current user (verifies the whole pipeline).
router.post('/test', asyncHandler(async (req, res) => {
  const sent = await sendPush(req.user!.id, { type: 'test', title: 'GDC CRM', body: 'Push notifications are working 🎉', link: '/' })
  ok(res, { sent })
}))

export default router
