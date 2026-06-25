import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { User } from '../models/User'
import { Branch } from '../models/Branch'
import { Session } from '../models/misc'
import { ok } from '../utils/http'
import { asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { ApiError } from '../utils/ApiError'
import { verifyPassword, hashPassword } from '../utils/password'
import { signAccess, signRefresh, verifyRefresh } from '../utils/jwt'
import { audit } from '../utils/audit'
import { env } from '../config/env'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshCookie = 'gdc_refresh'
function setRefreshCookie(res: import('express').Response, token: string) {
  res.cookie(refreshCookie, token, {
    httpOnly: true,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

async function publicUser(id: string) {
  return User.findById(id)
    .select('-passwordHash -security.twoFactorSecret')
    .populate('branchId', 'name code')
    .lean()
}

/** Normalise the client IP (strip IPv6-mapped prefix) for allowlist comparison. */
function clientIp(req: import('express').Request): string {
  return (req.ip || '').replace(/^::ffff:/, '')
}

// POST /auth/login  (password step; 2FA is out of scope for the core build)
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const user = await User.findOne({ email: email.toLowerCase(), isDeleted: false }).select('+passwordHash')
    // Anti-enumeration: identical error for missing user / wrong password.
    if (!user) throw ApiError.unauthorized('Invalid email or password')
    if (user.status === 'suspended') throw ApiError.forbidden('Account suspended')

    const lockedUntil = user.security?.lockedUntil
    if (lockedUntil && lockedUntil > new Date()) throw ApiError.forbidden('Account temporarily locked')

    const valid = await verifyPassword(password, user.passwordHash as string)
    if (!valid) {
      user.security = user.security || ({} as never)
      ;(user.security as { failedLoginCount?: number }).failedLoginCount =
        ((user.security as { failedLoginCount?: number }).failedLoginCount || 0) + 1
      if (((user.security as { failedLoginCount?: number }).failedLoginCount || 0) >= 8) {
        ;(user.security as { lockedUntil?: Date }).lockedUntil = new Date(Date.now() + 15 * 60 * 1000)
      }
      await user.save()
      throw ApiError.unauthorized('Invalid email or password')
    }

    // IP allowlist: per-user IPs ∪ their branch IPs. If configured, only allow matching IPs.
    const branchIps = user.branchId
      ? ((await Branch.findById(user.branchId).select('allowedIps').lean()) as { allowedIps?: string[] } | null)?.allowedIps || []
      : []
    const allowed = [...((user as { allowedIps?: string[] }).allowedIps || []), ...branchIps]
    if (allowed.length && !allowed.includes(clientIp(req))) {
      await audit({ id: String(user._id), role: user.role as never, branchId: null }, 'auth.login.ip_blocked', 'User', user._id, { ip: clientIp(req) })
      throw ApiError.forbidden(`Login not allowed from this network (${clientIp(req)})`)
    }

    ;(user.security as { failedLoginCount?: number }).failedLoginCount = 0
    ;(user.security as { lockedUntil?: Date }).lockedUntil = undefined
    await user.save()

    const session = await Session.create({
      userId: user._id,
      device: 'web',
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    const refresh = signRefresh({ sub: String(user._id), sid: String(session._id) })
    session.refreshTokenHash = crypto.createHash('sha256').update(refresh).digest('hex')
    await session.save()

    const accessToken = signAccess({
      sub: String(user._id),
      role: user.role as never,
      branchId: user.branchId ? String(user.branchId) : null,
    })
    setRefreshCookie(res, refresh)
    await audit({ id: String(user._id), role: user.role as never, branchId: null }, 'auth.login', 'User', user._id, { ip: req.ip })

    ok(res, { accessToken, user: await publicUser(String(user._id)) })
  })
)

// POST /auth/refresh — rotate tokens using the refresh cookie
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[refreshCookie]
    if (!token) throw ApiError.unauthorized('No refresh token')
    let payload: { sub: string; sid: string }
    try {
      payload = verifyRefresh(token)
    } catch {
      throw ApiError.unauthorized('Invalid refresh token')
    }
    const session = await Session.findById(payload.sid)
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    if (!session || session.revoked || session.refreshTokenHash !== hash) {
      throw ApiError.unauthorized('Session expired')
    }
    const user = await User.findById(payload.sub)
    if (!user || user.status === 'suspended') throw ApiError.unauthorized()

    // rotation
    const newRefresh = signRefresh({ sub: payload.sub, sid: payload.sid })
    session.refreshTokenHash = crypto.createHash('sha256').update(newRefresh).digest('hex')
    session.lastSeenAt = new Date()
    await session.save()
    setRefreshCookie(res, newRefresh)

    const accessToken = signAccess({
      sub: String(user._id),
      role: user.role as never,
      branchId: user.branchId ? String(user.branchId) : null,
    })
    ok(res, { accessToken, user: await publicUser(String(user._id)) })
  })
)

// POST /auth/logout — revoke current session
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[refreshCookie]
    if (token) {
      try {
        const payload = verifyRefresh(token)
        await Session.findByIdAndUpdate(payload.sid, { revoked: true })
      } catch {
        /* ignore */
      }
    }
    res.clearCookie(refreshCookie)
    ok(res, { loggedOut: true })
  })
)

// GET /auth/me — current user
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await publicUser(req.user!.id)
    if (!user) throw ApiError.unauthorized()
    ok(res, user)
  })
)

// GET /auth/sessions — list own devices
router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await Session.find({ userId: req.user!.id, revoked: false }).sort({ lastSeenAt: -1 }).lean()
    ok(res, sessions)
  })
)

// POST /auth/change-password — the signed-in user changes their own password
const changePwSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) })
router.post('/change-password', requireAuth, validate(changePwSchema), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changePwSchema>
  const user = await User.findById(req.user!.id).select('+passwordHash')
  if (!user) throw ApiError.unauthorized()
  if (!(await verifyPassword(currentPassword, user.passwordHash as string))) throw ApiError.badRequest('Current password is incorrect')
  user.passwordHash = await hashPassword(newPassword) as never
  if (user.security) (user.security as { lastPasswordChangeAt?: Date }).lastPasswordChangeAt = new Date()
  await user.save()
  await audit(req.user, 'auth.change_password', 'User', user._id)
  ok(res, { ok: true })
}))

// GET /auth/ip — the caller's current IP (helps admins configure the allowlist)
router.get('/ip', requireAuth, asyncHandler(async (req, res) => ok(res, { ip: clientIp(req) })))

// POST /auth/impersonate/:userId — Super Admin opens an employee's dashboard (audited).
router.post('/impersonate/:userId', requireAuth, asyncHandler(async (req, res) => {
  if (req.user!.role !== 'superadmin') throw ApiError.forbidden('Super Admin only')
  const target = await User.findOne({ _id: req.params.userId, isDeleted: false })
  if (!target) throw ApiError.notFound('Employee not found')
  if (target.role === 'superadmin') throw ApiError.badRequest('Cannot impersonate another Super Admin')
  const accessToken = signAccess({
    sub: String(target._id), role: target.role as never,
    branchId: target.branchId ? String(target.branchId) : null,
    imp: req.user!.id, // marks this token as an impersonation session
  })
  await audit(req.user, 'auth.impersonate', 'User', target._id)
  ok(res, { accessToken, user: await publicUser(String(target._id)) })
}))

export default router
