import { Server as HttpServer } from 'http'
import { Server as IOServer } from 'socket.io'
import { verifyAccess } from '../utils/jwt'
import { env } from '../config/env'

let io: IOServer | null = null

/** Initialise Socket.IO. Clients authenticate with the access token and join
 *  per-user and per-branch rooms (Blueprint A7 / D2.5). */
export function initSocket(server: HttpServer): IOServer {
  io = new IOServer(server, { cors: { origin: env.clientOrigin, credentials: true } })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next() // allow anonymous connect; rooms gated below
    try {
      const payload = verifyAccess(token)
      socket.data.userId = payload.sub
      socket.data.branchId = payload.branchId
      socket.data.role = payload.role
    } catch {
      /* ignore invalid token; connection stays unauthenticated */
    }
    next()
  })

  io.on('connection', (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`)
    if (socket.data.branchId) socket.join(`branch:${socket.data.branchId}`)
    // superadmins have no branch room — give them an org-wide room so they still get scoped events
    if (socket.data.role === 'superadmin') socket.join('role:superadmin')
  })

  return io
}

/** Emit to a specific user's room. */
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload)
}

/**
 * Scoped task/board event: reaches the task's branch, the assignee, and all superadmins
 * (who aren't in any branch room) — instead of flooding every connected client.
 */
export function emitScoped(event: string, payload: unknown, opts: { branchId?: unknown; userId?: unknown } = {}) {
  if (!io) return
  let chan = io.to('role:superadmin')
  if (opts.branchId) chan = chan.to(`branch:${opts.branchId}`)
  if (opts.userId) chan = chan.to(`user:${opts.userId}`)
  chan.emit(event, payload)
}

/** Broadcast to everyone (used for org-wide events such as announcements). */
export function emitAll(event: string, payload: unknown) {
  io?.emit(event, payload)
}
