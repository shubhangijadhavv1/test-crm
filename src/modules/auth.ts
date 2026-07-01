import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { User } from '../models/User'
import { Branch } from '../models/Branch'
import { Session } from '../models/misc'
import { Attendance } from '../models/Attendance'
import { recomputeSession } from '../agent/session'
import { ok } from '../utils/http'
import { asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { ApiError } from '../utils/ApiError'
import QRCode from 'qrcode'
import { verifyPassword, hashPassword } from '../utils/password'
import { signAccess, signRefresh, verifyRefresh, signMfaChallenge, verifyMfaChallenge } from '../utils/jwt'
import { generateSecret, verifyTotp, otpauthUri } from '../utils/totp'
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

/**
 * Issue a fresh web session (DB row + rotated refresh cookie + access token) and
 * respond with { accessToken, user }. Shared by the password path and the 2FA path,
 * so tokens are only ever minted after every required factor has passed.
 */
async function issueSession(
  req: import('express').Request,
  res: import('express').Response,
  user: { _id: unknown; role: string; branchId?: unknown },
) {
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
}

// ---- Recovery codes: generate readable one-time codes, store only their hashes ----
const hashCode = (code: string) => crypto.createHash('sha256').update(code).digest('hex')
function makeRecoveryCodes(n = 10): { plain: string[]; hashed: string[] } {
  const plain: string[] = []
  for (let i = 0; i < n; i++) {
    // 10 hex chars grouped as xxxxx-xxxxx — easy to read and type
    const raw = crypto.randomBytes(5).toString('hex')
    plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
  }
  return { plain, hashed: plain.map(c => hashCode(c.replace('-', ''))) }
}

// POST /auth/login  (password step; if 2FA is on, returns a challenge instead of tokens)
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

    // Second factor: password is correct, but if 2FA is enabled we withhold tokens and
    // hand back a short-lived challenge the client redeems at /auth/2fa/verify with a code.
    if ((user.security as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled) {
      await audit({ id: String(user._id), role: user.role as never, branchId: null }, 'auth.login.mfa_challenge', 'User', user._id)
      return ok(res, { mfaRequired: true, mfaToken: signMfaChallenge(String(user._id)) })
    }

    await issueSession(req, res, user as never)
  })
)

// POST /auth/2fa/verify — redeem the login MFA challenge with a TOTP code or a recovery code
const verify2faSchema = z.object({ mfaToken: z.string().min(1), code: z.string().min(1) })
router.post('/2fa/verify', validate(verify2faSchema), asyncHandler(async (req, res) => {
  const { mfaToken, code } = req.body as z.infer<typeof verify2faSchema>
  let sub: string
  try { sub = verifyMfaChallenge(mfaToken).sub } catch { throw ApiError.unauthorized('This sign-in attempt expired — please log in again') }

  const user = await User.findOne({ _id: sub, isDeleted: false }).select('+security.twoFactorSecret +security.recoveryCodes')
  if (!user || !(user.security as { twoFactorEnabled?: boolean }).twoFactorEnabled) throw ApiError.unauthorized()

  const sec = user.security as { twoFactorSecret?: string; recoveryCodes?: string[] }
  const clean = code.replace(/[\s-]/g, '')
  const byTotp = sec.twoFactorSecret ? verifyTotp(sec.twoFactorSecret, clean) : false
  let byRecovery = false
  if (!byTotp && sec.recoveryCodes?.length) {
    const h = hashCode(clean)
    const idx = sec.recoveryCodes.indexOf(h)
    if (idx !== -1) {
      byRecovery = true
      sec.recoveryCodes.splice(idx, 1) // one-time use — consume it
      await user.save()
    }
  }
  if (!byTotp && !byRecovery) throw ApiError.unauthorized('Invalid or expired code')

  if (byRecovery) await audit({ id: sub, role: user.role as never, branchId: null }, 'auth.2fa.recovery_used', 'User', user._id)
  await issueSession(req, res, user as never)
}))

// POST /auth/2fa/setup — begin enrollment: mint a pending secret + QR for the authenticator app
router.post('/2fa/setup', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!.id)
  if (!user) throw ApiError.unauthorized()
  if ((user.security as { twoFactorEnabled?: boolean }).twoFactorEnabled) throw ApiError.badRequest('Two-factor is already enabled')

  const secret = generateSecret()
  user.security = user.security || ({} as never)
  ;(user.security as { twoFactorPendingSecret?: string }).twoFactorPendingSecret = secret
  await user.save()

  const uri = otpauthUri(secret, user.email as string)
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
  ok(res, { secret, otpauthUri: uri, qrDataUrl })
}))

// POST /auth/2fa/enable — confirm enrollment with a code; returns one-time recovery codes
const enable2faSchema = z.object({ code: z.string().min(1) })
router.post('/2fa/enable', requireAuth, validate(enable2faSchema), asyncHandler(async (req, res) => {
  const { code } = req.body as z.infer<typeof enable2faSchema>
  const user = await User.findById(req.user!.id).select('+security.twoFactorPendingSecret')
  if (!user) throw ApiError.unauthorized()
  const sec = user.security as { twoFactorEnabled?: boolean; twoFactorPendingSecret?: string; twoFactorSecret?: string; twoFactorEnabledAt?: Date; recoveryCodes?: string[] }
  if (sec.twoFactorEnabled) throw ApiError.badRequest('Two-factor is already enabled')
  if (!sec.twoFactorPendingSecret) throw ApiError.badRequest('Start setup first')
  if (!verifyTotp(sec.twoFactorPendingSecret, code.replace(/\s/g, ''))) throw ApiError.badRequest('That code is incorrect — check the time on your phone and try again')

  const { plain, hashed } = makeRecoveryCodes()
  sec.twoFactorSecret = sec.twoFactorPendingSecret
  sec.twoFactorPendingSecret = undefined
  sec.twoFactorEnabled = true
  sec.twoFactorEnabledAt = new Date()
  sec.recoveryCodes = hashed
  await user.save()
  await audit(req.user, 'auth.2fa.enabled', 'User', user._id)
  ok(res, { enabled: true, recoveryCodes: plain })
}))

// POST /auth/2fa/disable — turn 2FA off (re-verify with password, and a code if still enrolled)
const disable2faSchema = z.object({ password: z.string().min(1), code: z.string().optional() })
router.post('/2fa/disable', requireAuth, validate(disable2faSchema), asyncHandler(async (req, res) => {
  const { password, code } = req.body as z.infer<typeof disable2faSchema>
  const user = await User.findById(req.user!.id).select('+passwordHash +security.twoFactorSecret +security.recoveryCodes')
  if (!user) throw ApiError.unauthorized()
  if (!(await verifyPassword(password, user.passwordHash as string))) throw ApiError.badRequest('Password is incorrect')
  const sec = user.security as { twoFactorEnabled?: boolean; twoFactorSecret?: string; twoFactorPendingSecret?: string; recoveryCodes?: string[] }
  if (!sec.twoFactorEnabled) throw ApiError.badRequest('Two-factor is not enabled')
  if (code && sec.twoFactorSecret && !verifyTotp(sec.twoFactorSecret, code.replace(/\s/g, ''))) throw ApiError.badRequest('That code is incorrect')

  sec.twoFactorEnabled = false
  sec.twoFactorSecret = undefined
  sec.twoFactorPendingSecret = undefined
  sec.recoveryCodes = []
  await user.save()
  await audit(req.user, 'auth.2fa.disabled', 'User', user._id)
  ok(res, { disabled: true })
}))

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

/**
 * On sign-out, close an OPEN web-punch shift for the user (today): stamp logoutAt, close the
 * open segment, and recompute totals — so the employee shows clocked out, not stuck "Live".
 * Agent shifts (source 'agent') are left untouched; the desktop agent ends those itself.
 */
async function endOpenWebShift(userId: string) {
  const date = new Date().toISOString().slice(0, 10)
  const att = await Attendance.findOne({ userId, date, source: 'web', loginAt: { $ne: null }, logoutAt: { $in: [null, undefined] } })
  if (!att) return
  const now = new Date()
  const open = att.segments.find(s => !s.endAt)
  if (open) { open.endAt = now; open.seconds = Math.max(0, Math.floor((now.getTime() - new Date(open.startAt!).getTime()) / 1000)) }
  att.logoutAt = now
  await att.save()
  try { await recomputeSession(att._id) } catch { /* totals recompute best-effort */ }
}

// POST /auth/logout — revoke current session
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[refreshCookie]
    if (token) {
      try {
        const payload = verifyRefresh(token)
        await Session.findByIdAndUpdate(payload.sid, { revoked: true })
        // Signing out also ends an OPEN web-punch shift, so the employee isn't left "Live".
        // Only web sessions — agent shifts are owned/closed by the desktop agent itself.
        await endOpenWebShift(payload.sub)
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
