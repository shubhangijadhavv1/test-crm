import { Notification } from '../models/misc'
import { emitToUser } from '../realtime/socket'
import { sendPush } from '../services/webpush'

/** Create an in-app notification, push over WebSocket, and fan out to browser Web Push (Module 13). */
export async function notify(
  userId: string,
  data: { type: string; title: string; body?: string; link?: string; color?: string }
) {
  const doc = await Notification.create({ userId, read: false, ...data })
  emitToUser(String(userId), 'notification:new', doc)
  // Background browser push (works even when the CRM tab is closed). Fire-and-forget.
  sendPush(String(userId), data).catch(() => {})
  return doc
}
