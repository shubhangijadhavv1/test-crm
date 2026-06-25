import webpush from 'web-push'
import { env } from '../config/env'
import { PushSubscription } from '../models/push'

let configured = false

/** Configure web-push with the VAPID keys (once). Returns false if keys are missing. */
export function initWebPush(): boolean {
  if (configured) return true
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    console.warn('[push] VAPID keys not configured — browser push disabled')
    return false
  }
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
  configured = true
  return true
}

export function isPushEnabled(): boolean { return configured }

export interface PushPayload { type: string; title: string; body?: string; link?: string; color?: string }

/**
 * Send a Web Push notification to every subscription a user has. Dead subscriptions
 * (410 Gone / 404) are pruned automatically. Never throws.
 */
export async function sendPush(userId: string, payload: PushPayload): Promise<number> {
  if (!configured && !initWebPush()) return 0
  const subs = await PushSubscription.find({ userId }).lean()
  if (!subs.length) return 0
  const data = JSON.stringify(payload)
  let sent = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, data)
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      // 404/410 = expired/unsubscribed; 403 = subscription bound to a stale VAPID key → unusable, drop it
      if (code === 404 || code === 410 || code === 403) await PushSubscription.deleteOne({ _id: s._id })
    }
  }))
  return sent
}
