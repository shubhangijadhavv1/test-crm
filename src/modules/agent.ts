import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { Attendance } from '../models/Attendance'
import { User } from '../models/User'
import { Branch } from '../models/Branch'
import { ActivityTick, Screenshot } from '../models/ActivityTick'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { branchScope } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { recomputeSession } from '../agent/session'
import { emitScoped } from '../realtime/socket'

const router = Router()
router.use(requireAuth)

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)

/**
 * Timezone-aware shift-start instant: HH:MM on the login's calendar day, in the branch's
 * timezone — so "10:00" means 10:00 in IST (or whatever the branch uses) regardless of where
 * the server runs (UTC in the cloud, etc.). Avoids the wrong late times you get from the
 * server's local clock.
 */
function shiftStartInTz(loginAt: Date, hhmm: string, tz: string): Date {
  const [h, m] = (hhmm || '09:00').split(':').map(Number)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(loginAt)
  const [Y, M, D] = ymd.split('-').map(Number)
  const utcGuess = Date.UTC(Y, M - 1, D, h || 0, m || 0)
  // Offset of tz vs UTC at that wall-clock moment.
  const offset = new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: tz })).getTime()
    - new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return new Date(utcGuess - offset)
}

/** Fresh, timezone-correct late mark for a session (don't trust possibly-stale stored values). */
function lateInfo(loginAt: Date | null | undefined, branch: { shift?: { startTime?: string; graceMinutes?: number }; timezone?: string } | null) {
  if (!loginAt || !branch?.shift?.startTime) return { lateMark: false, lateBySeconds: 0 }
  const tz = branch.timezone || 'Asia/Kolkata'
  const start = shiftStartInTz(new Date(loginAt), branch.shift.startTime, tz)
  const grace = (branch.shift.graceMinutes ?? 15) * 60_000
  const lateBySeconds = Math.max(0, Math.round((new Date(loginAt).getTime() - start.getTime()) / 1000))
  return { lateMark: new Date(loginAt).getTime() > start.getTime() + grace, lateBySeconds }
}

// Screenshot binaries land under uploads/screenshots (gitignored), served statically.
export const SHOT_DIR = path.join(process.cwd(), 'uploads', 'screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })
const upload = multer({
  storage: multer.diskStorage({
    destination: SHOT_DIR,
    filename: (req, file, cb) => cb(null, `${(req as { user?: { id: string } }).user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB cap
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/png' || file.mimetype === 'image/jpeg'),
})

/** Find or open today's attendance session for the caller (source: agent). */
async function todaySession(userId: string) {
  const user = await User.findById(userId).select('branchId workMode').lean()
  const date = dayKey()
  let att = await Attendance.findOne({ userId, date })
  if (!att) att = await Attendance.create({ userId, branchId: user?.branchId, date, workMode: user?.workMode || 'office', segments: [], status: 'present', source: 'agent' })
  // Self-heal: if the session was opened before a branch was assigned, adopt the user's
  // current branch so shift/break/remaining figures (which derive from the branch) populate.
  else if (!att.branchId && user?.branchId) { att.branchId = user.branchId as never; await att.save() }
  return att
}

/** Authoritative session state so the agent can reconcile clock-in / break / clock-out done elsewhere (e.g. web). */
function sessionState(att: { loginAt?: unknown; logoutAt?: unknown; segments?: { endAt?: unknown; type?: string | null }[] } | null) {
  if (!att) return { open: false, onBreak: false, breakType: null, clockedOut: false, loginAt: null }
  const openBreak = (att.segments || []).find(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea'))
  return {
    open: !!att.loginAt && !att.logoutAt,
    onBreak: !!openBreak,
    breakType: openBreak?.type || null,
    clockedOut: !!att.logoutAt,
    loginAt: att.loginAt || null,
  }
}

// GET /agent/session — current attendance state (lets the agent sync a web punch-in without ticks)
router.get('/session', asyncHandler(async (req, res) => {
  const att = await Attendance.findOne({ userId: req.user!.id, date: dayKey() }).lean()
  ok(res, sessionState(att))
}))

// GET /agent/my-status — is THIS user's desktop agent running & tracking? (for the web dashboard)
router.get('/my-status', asyncHandler(async (req, res) => {
  const att = await Attendance.findOne({ userId: req.user!.id, date: dayKey() }).select('_id source loginAt logoutAt').lean()
  if (!att) return ok(res, { connected: false, lastTickAt: null, open: false })
  const last = await ActivityTick.findOne({ attendanceId: att._id }).sort({ ts: -1 }).select('ts').lean()
  const lastTickAt = last?.ts || null
  const connected = !!lastTickAt && (Date.now() - new Date(lastTickAt as Date).getTime()) < 150_000 && !att.logoutAt
  ok(res, { connected, lastTickAt, open: !!att.loginAt && !att.logoutAt, source: att.source })
}))

// POST /agent/permissions — agent reports its macOS permission status
const permsBody = z.object({ screen: z.string().optional(), accessibility: z.boolean().optional() })
router.post('/permissions', validate(permsBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof permsBody>
  const att = await todaySession(req.user!.id)
  att.agentPermissions = { screen: b.screen || 'unknown', accessibility: !!b.accessibility, at: new Date() } as never
  await att.save()
  ok(res, { ok: true })
}))

// GET /agent/config — capture policy for the caller's branch (agent applies on clock-in)
router.get('/config', asyncHandler(async (req, res) => {
  const user = await User.findById(req.user!.id).select('branchId screenshotsEnabled').lean()
  const branch = user?.branchId ? await Branch.findById(user.branchId).select('monitoring').lean() as { monitoring?: { screenshotIntervalMinutes?: number; idleThresholdSeconds?: number } } | null : null
  const m = branch?.monitoring || {}
  // Per-employee screenshot toggle (Super Admin): when off, interval 0 = agent captures none.
  const screenshotsOff = (user as { screenshotsEnabled?: boolean })?.screenshotsEnabled === false
  ok(res, {
    screenshotIntervalSec: screenshotsOff ? 0 : Math.max(0, (m.screenshotIntervalMinutes ?? 10) * 60),
    screenshotsEnabled: !screenshotsOff,
    // Idle threshold in seconds (default 10s). Existing branches without the field also get 10s.
    idleThresholdSec: Math.max(5, m.idleThresholdSeconds ?? 10),
  })
}))

// POST /agent/clock-in — start a fresh agent session (reopens if the day was already closed)
router.post('/clock-in', asyncHandler(async (req, res) => {
  const att = await todaySession(req.user!.id)
  const now = new Date()
  if (!att.loginAt) {
    // first clock-in of the day
    att.loginAt = now
    att.segments.push({ type: 'work', startAt: now } as never)
  } else if (att.logoutAt) {
    // resume the SAME day after a clock-out — the gap in between counts as neither
    // work nor idle; a new work segment simply starts now and totals accumulate.
    att.logoutAt = undefined as never
    att.autoClosed = false as never
    att.segments.push({ type: 'work', startAt: now } as never)
  }
  att.source = 'agent' as never
  att.liveState = { state: 'active', since: now } as never
  await att.save()
  await audit(req.user, 'agent.clock-in', 'Attendance', att._id)
  await recomputeSession(att._id)
  emitScoped('agent:state', { userId: req.user!.id, state: 'active' }, { branchId: att.branchId, userId: req.user!.id })
  created(res, await Attendance.findById(att._id))
}))

// POST /agent/clock-out
router.post('/clock-out', asyncHandler(async (req, res) => {
  const att = await Attendance.findOne({ userId: req.user!.id, date: dayKey() })
  if (!att || !att.loginAt) throw ApiError.badRequest('No open session to clock out')
  const now = new Date()
  const open = att.segments.find(s => !s.endAt)
  if (open) { open.endAt = now; open.seconds = Math.floor((now.getTime() - new Date(open.startAt!).getTime()) / 1000) }
  att.logoutAt = now
  att.liveState = { state: 'active', since: now } as never
  await att.save()
  await audit(req.user, 'agent.clock-out', 'Attendance', att._id)
  const out = await recomputeSession(att._id)
  emitScoped('agent:state', { userId: req.user!.id, state: 'offline' }, { branchId: att.branchId, userId: req.user!.id })
  ok(res, out)
}))

// POST /agent/break/start { type: lunch|tea }
const breakStartBody = z.object({ type: z.enum(['lunch', 'tea']) })
router.post('/break/start', validate(breakStartBody), asyncHandler(async (req, res) => {
  const { type } = req.body as z.infer<typeof breakStartBody>
  const att = await Attendance.findOne({ userId: req.user!.id, date: dayKey() })
  if (!att || !att.loginAt) throw ApiError.badRequest('Clock in before taking a break')
  // One lunch + one tea per day.
  if (att.segments.some(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea'))) throw ApiError.conflict('Finish your current break first')
  if (att.segments.some(s => s.type === type)) throw ApiError.conflict(`You have already taken your ${type} break today`)
  const now = new Date()
  const open = att.segments.find(s => !s.endAt)
  if (open) { open.endAt = now; open.seconds = Math.floor((now.getTime() - new Date(open.startAt!).getTime()) / 1000) }
  att.segments.push({ type, startAt: now } as never)
  att.liveState = { state: 'break', since: now } as never
  await att.save()
  emitScoped('agent:state', { userId: req.user!.id, state: 'break' }, { branchId: att.branchId, userId: req.user!.id })
  ok(res, { started: type })
}))

// POST /agent/break/end
router.post('/break/end', asyncHandler(async (req, res) => {
  const att = await Attendance.findOne({ userId: req.user!.id, date: dayKey() })
  if (!att) throw ApiError.badRequest('No session')
  const now = new Date()
  const open = att.segments.find(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea'))
  if (!open) throw ApiError.badRequest('No break in progress')
  open.endAt = now
  open.seconds = Math.floor((now.getTime() - new Date(open.startAt!).getTime()) / 1000)
  att.segments.push({ type: 'work', startAt: now } as never)
  att.liveState = { state: 'active', since: now } as never
  await att.save()
  emitScoped('agent:state', { userId: req.user!.id, state: 'active' }, { branchId: att.branchId, userId: req.user!.id })
  ok(res, await recomputeSession(att._id))
}))

// POST /agent/state { state, idleStartedAt? } — instant activity transition (active/idle/break)
const stateBody = z.object({ state: z.enum(['active', 'idle', 'break']), idleStartedAt: z.coerce.date().optional() })
router.post('/state', validate(stateBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof stateBody>
  const att = await todaySession(req.user!.id)
  att.liveState = { state: b.state, since: new Date(), idleStartedAt: b.state === 'idle' ? (b.idleStartedAt || new Date()) : undefined } as never
  await att.save()
  // push to admin dashboards so the change shows within a second (no poll wait)
  emitScoped('agent:state', { userId: req.user!.id, state: b.state }, { branchId: att.branchId, userId: req.user!.id })
  ok(res, { state: b.state })
}))

// POST /agent/heartbeat { ticks: [{ ts, isIdle, activeApp, keyCount, mouseCount }] }
const heartbeatBody = z.object({
  ticks: z.array(z.object({
    ts: z.coerce.date(),
    isIdle: z.boolean().optional(),
    idleSeconds: z.number().min(0).max(60).optional(),
    state: z.enum(['active', 'idle', 'break']).optional(),
    activeApp: z.string().optional(),
    activeTitle: z.string().optional(),
    activeUrl: z.string().optional(),
    keyCount: z.number().optional(),
    mouseCount: z.number().optional(),
  })).min(1).max(240),
  agentVersion: z.string().optional(),
})
router.post('/heartbeat', validate(heartbeatBody), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof heartbeatBody>
  const att = await todaySession(req.user!.id)
  // Break ticks don't count toward idle (agent pauses idle while on break).
  const docs = body.ticks.map(t => ({
    attendanceId: att._id, userId: req.user!.id, branchId: att.branchId,
    ts: t.ts, isIdle: t.state === 'break' ? false : !!t.isIdle, state: t.state || (t.isIdle ? 'idle' : 'active'),
    idleSeconds: t.state === 'break' ? 0 : (t.idleSeconds != null ? t.idleSeconds : (t.isIdle ? 60 : 0)),
    activeApp: t.activeApp, activeTitle: t.activeTitle, activeUrl: t.activeUrl,
    keyCount: t.keyCount || 0, mouseCount: t.mouseCount || 0, agentVersion: body.agentVersion,
  }))
  await ActivityTick.insertMany(docs, { ordered: false })
  const updated = await recomputeSession(att._id)
  // Authoritative session state so the desktop agent can reconcile when a break is ended /
  // started / the shift is clocked out from ELSEWHERE (e.g. the web CRM).
  ok(res, { accepted: docs.length, totals: updated?.totals, session: sessionState(updated as never) })
}))

// POST /agent/screenshot/upload — multipart binary (field "shot"); stores file + record
router.post('/screenshot/upload', upload.single('shot') as unknown as import('express').RequestHandler, asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No screenshot file')
  const att = await todaySession(req.user!.id)
  const url = `/uploads/screenshots/${req.file.filename}`
  const b = req.body || {}
  const screenCount = Math.max(1, Number(b.screenCount) || 1)
  const doc = await Screenshot.create({
    attendanceId: att._id, userId: req.user!.id, ts: new Date(),
    url, thumbnailUrl: url, blurred: b.blurred === 'true',
    screen: Math.max(1, Number(b.screen) || 1), screenCount,
    primary: b.primary === undefined ? true : b.primary === 'true',
    label: typeof b.label === 'string' ? b.label : '',
  })
  created(res, doc)
}))

// POST /agent/screenshot — metadata only (binary lives in object storage; DPDP: blur flag)
const shotBody = z.object({ url: z.string(), thumbnailUrl: z.string().optional(), blurred: z.boolean().optional(), ts: z.coerce.date().optional() })
router.post('/screenshot', validate(shotBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof shotBody>
  const att = await todaySession(req.user!.id)
  const doc = await Screenshot.create({ attendanceId: att._id, userId: req.user!.id, ts: b.ts || new Date(), url: b.url, thumbnailUrl: b.thumbnailUrl, blurred: !!b.blurred })
  created(res, doc)
}))

/** Resolve which user's data the caller may read: self, or (admin/superadmin) a given userId. */
async function resolveTarget(req: import('express').Request): Promise<string> {
  if (req.query.userId && req.user!.role !== 'employee') {
    const target = req.query.userId as string
    if (req.user!.role === 'admin' && req.user!.branchId) {
      const u = await User.findById(target).select('branchId').lean()
      if (String(u?.branchId) !== String(req.user!.branchId)) throw ApiError.forbidden('Out of your branch')
    }
    return target
  }
  return req.user!.id
}

// GET /agent/timeline?date=YYYY-MM-DD&userId= — session + ticks + breaks + screenshot count
router.get('/timeline', asyncHandler(async (req, res) => {
  const userId = await resolveTarget(req)
  const date = (req.query.date as string) || dayKey()
  const existing = await Attendance.findOne({ userId, date }).select('_id').lean()
  if (!existing) return ok(res, { date, userId, session: null, ticks: [], breaks: [], screenshotCount: 0 })
  // Recompute so the detail page always shows complete, current Net Productive totals
  // (required / remaining / expected logout) even for sessions saved before this model.
  await recomputeSession(existing._id)
  const att = (await Attendance.findById(existing._id).populate('userId', 'fullName department avatarColor').populate('branchId', 'shift breaks timezone').lean())!
  Object.assign(att, lateInfo(att.loginAt as Date | null, att.branchId as never)) // fresh, tz-correct late
  const ticks = await ActivityTick.find({ attendanceId: att._id }).sort({ ts: 1 }).select('ts isIdle state activeApp activeTitle activeUrl keyCount mouseCount').lean()
  const screenshotCount = await Screenshot.countDocuments({ attendanceId: att._id })
  const breaks = att.segments.filter(s => s.type === 'lunch' || s.type === 'tea')
  ok(res, { date, userId, session: att, ticks, breaks, screenshotCount })
}))

// GET /agent/screenshots?date=&userId= (admin/self)
router.get('/screenshots', asyncHandler(async (req, res) => {
  const userId = await resolveTarget(req)
  const date = (req.query.date as string) || dayKey()
  const att = await Attendance.findOne({ userId, date }).select('_id').lean()
  if (!att) return ok(res, [])
  const shots = await Screenshot.find({ attendanceId: att._id }).sort({ ts: 1 }).lean()
  ok(res, shots)
}))

// POST /agent/screenshots/bulk-delete { ids } — remove many at once (admin; branch-scoped)
const bulkDelBody = z.object({ ids: z.array(z.string()).min(1).max(1000) })
router.post('/screenshots/bulk-delete', validate(bulkDelBody), asyncHandler(async (req, res) => {
  if (req.user!.role === 'employee') throw ApiError.forbidden('Admins only')
  const { ids } = req.body as z.infer<typeof bulkDelBody>
  let shots = await Screenshot.find({ _id: { $in: ids } })
  if (req.user!.role === 'admin' && req.user!.branchId) {
    const userIds = [...new Set(shots.map(s => String(s.userId)))]
    const inBranch = await User.find({ _id: { $in: userIds }, branchId: req.user!.branchId }).select('_id').lean()
    const ok2 = new Set(inBranch.map(u => String(u._id)))
    shots = shots.filter(s => ok2.has(String(s.userId)))
  }
  for (const shot of shots) {
    if (shot.url) { try { fs.unlinkSync(path.join(process.cwd(), String(shot.url).replace(/^\//, ''))) } catch { /* gone */ } }
    await Screenshot.deleteOne({ _id: shot._id })
  }
  await audit(req.user, 'agent.screenshot.bulk-delete', 'Screenshot', ids.join(','), { after: { deleted: shots.length } })
  ok(res, { deleted: shots.length })
}))

// DELETE /agent/screenshots/:id — remove a screenshot (admin; branch-scoped) + its file
router.delete('/screenshots/:id', asyncHandler(async (req, res) => {
  if (req.user!.role === 'employee') throw ApiError.forbidden('Admins only')
  const shot = await Screenshot.findById(req.params.id)
  if (!shot) throw ApiError.notFound('Screenshot not found')
  if (req.user!.role === 'admin' && req.user!.branchId) {
    const u = await User.findById(shot.userId).select('branchId').lean()
    if (String(u?.branchId) !== String(req.user!.branchId)) throw ApiError.forbidden('Out of your branch')
  }
  if (shot.url) { try { fs.unlinkSync(path.join(process.cwd(), String(shot.url).replace(/^\//, ''))) } catch { /* file already gone */ } }
  await Screenshot.deleteOne({ _id: shot._id })
  await audit(req.user, 'agent.screenshot.delete', 'Screenshot', shot._id)
  ok(res, { deleted: true })
}))

// GET /agent/summary?date=&branchId= — admin daily roll-up across the branch
router.get('/summary', asyncHandler(async (req, res) => {
  if (req.user!.role === 'employee') throw ApiError.forbidden('Admins only')
  const date = (req.query.date as string) || dayKey()
  const filter: Record<string, unknown> = { date, ...branchScope(req) }
  if (req.query.branchId && req.user!.role === 'superadmin') filter.branchId = req.query.branchId
  const allRows = await Attendance.find(filter)
    .populate('userId', 'fullName department avatarColor isDeleted')
    .populate('branchId', 'shift breaks timezone') // shift window + break allowances + tz for late/remaining math
    .sort({ lateBySeconds: -1 })
    .lean()
  // Drop sessions of removed/soft-deleted employees (and orphaned rows whose user is gone),
  // so deleting a tester actually clears them from the live board.
  const rows = allRows.filter(r => r.userId && !(r.userId as { isDeleted?: boolean }).isDeleted)
  // Latest heartbeat tick per session → lets the client tick idle/work live.
  const ids = rows.map(r => r._id)
  const lastTicks = ids.length ? await ActivityTick.aggregate([
    { $match: { attendanceId: { $in: ids } } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$attendanceId', ts: { $first: '$ts' }, state: { $first: '$state' }, isIdle: { $first: '$isIdle' } } },
  ]) : []
  const lastMap = new Map(lastTicks.map((t: { _id: unknown }) => [String(t._id), t]))
  // Expose the currently-open segment + last tick so the client can tick break/idle/work live.
  const out = rows.map(r => ({
    ...r,
    // Recompute late FRESH (timezone-aware) so the card always shows the real late time,
    // not a possibly-stale value computed under a different server timezone.
    ...lateInfo(r.loginAt as Date | null, r.branchId as never),
    openSegment: (r.segments || []).find((s: { endAt?: unknown }) => !s.endAt) || null,
    lastTick: lastMap.get(String(r._id)) || null,
  }))

  // Include every (non-superadmin) employee in scope so the roster shows who has NOT logged in.
  const uf: Record<string, unknown> = { isDeleted: false, role: { $ne: 'superadmin' }, ...branchScope(req) }
  if (req.query.branchId && req.user!.role === 'superadmin') uf.branchId = req.query.branchId
  const users = await User.find(uf).select('fullName department avatarColor').lean()
  const present = new Set(out.map(r => String((r.userId as { _id?: unknown })?._id || r.userId)))
  const stubs = users.filter(u => !present.has(String(u._id))).map(u => ({
    _id: `nosession-${u._id}`,
    userId: { _id: u._id, fullName: u.fullName, department: u.department, avatarColor: u.avatarColor },
    branchId: null, loginAt: null, logoutAt: null, totals: {}, openSegment: null, lastTick: null, noSession: true,
  }))
  ok(res, [...out, ...stubs])
}))

export default router
