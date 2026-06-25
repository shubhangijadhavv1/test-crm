import { Router } from 'express'
import { z } from 'zod'
import { Attendance } from '../models/Attendance'
import { Branch } from '../models/Branch'
import { User } from '../models/User'
import { ok, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole, branchScope } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { Holiday } from '../models/Branch'
import { LeaveRequest } from '../models/leave'
import { isWeeklyOff } from '../utils/weekend'

const router = Router()
router.use(requireAuth)

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

/** Recompute totals from segments and apply the branch allowance rule (M7 §6). */
function recompute(att: { segments: { type: string; seconds?: number }[]; totals: Record<string, number> }, lunchAllowanceSec: number, teaAllowanceSec: number, loginAt?: Date, logoutAt?: Date) {
  let work = 0, idle = 0, lunch = 0, tea = 0
  for (const s of att.segments) {
    const sec = s.seconds || 0
    if (s.type === 'work') work += sec
    else if (s.type === 'idle') idle += sec
    else if (s.type === 'lunch') lunch += sec
    else if (s.type === 'tea') tea += sec
  }
  // Extra lunch/tea beyond allowance is reclassified as idle.
  const extraLunch = Math.max(0, lunch - lunchAllowanceSec)
  const extraTea = Math.max(0, tea - teaAllowanceSec)
  idle += extraLunch + extraTea
  const totalLogged = loginAt && logoutAt ? Math.floor((logoutAt.getTime() - loginAt.getTime()) / 1000) : work + idle + lunch + tea
  const productive = Math.max(0, totalLogged - idle - lunch - tea)
  att.totals = { workSeconds: work, idleSeconds: idle, lunchSeconds: lunch, teaSeconds: tea, productiveSeconds: productive }
}

const punchBody = z.object({ action: z.enum(['in', 'out', 'lunch_in', 'lunch_out', 'tea_in', 'tea_out']), workMode: z.enum(['office', 'wfh', 'hybrid']).optional() })

// POST /attendance/punch
router.post('/punch', validate(punchBody), asyncHandler(async (req, res) => {
  const { action, workMode } = req.body as z.infer<typeof punchBody>
  const userId = req.user!.id
  const user = await User.findById(userId).lean()
  if ((user as { webPunchEnabled?: boolean })?.webPunchEnabled === false) {
    throw ApiError.forbidden('Web punch is disabled for your account — use the desktop agent.')
  }
  const branch = user?.branchId ? await Branch.findById(user.branchId).lean() : null
  const lunchAllowance = (branch?.breaks?.lunchMinutes || 45) * 60
  const teaAllowance = (branch?.breaks?.teaMinutes || 15) * 60

  const date = todayKey()
  let att = await Attendance.findOne({ userId, date })
  if (!att) {
    att = await Attendance.create({ userId, branchId: user?.branchId, date, workMode: workMode || user?.workMode || 'office', segments: [], status: 'present' })
  }
  const now = new Date()
  const openSeg = att.segments.find(s => !s.endAt)

  const closeOpen = () => {
    if (openSeg) {
      openSeg.endAt = now
      openSeg.seconds = Math.floor((now.getTime() - new Date(openSeg.startAt!).getTime()) / 1000)
    }
  }

  switch (action) {
    case 'in':
      if (!att.loginAt) {
        att.loginAt = now
        // late mark
        const [sh, sm] = (branch?.shift?.startTime || '09:00').split(':').map(Number)
        const shiftStart = new Date(now); shiftStart.setHours(sh, sm, 0, 0)
        const grace = (branch?.shift?.graceMinutes || 15) * 60 * 1000
        if (now.getTime() > shiftStart.getTime() + grace) {
          att.lateMark = true
          att.lateBySeconds = Math.floor((now.getTime() - shiftStart.getTime()) / 1000)
        }
      }
      att.logoutAt = undefined as never // re-punch-in reopens the day (cleared on Punch out)
      closeOpen()
      att.segments.push({ type: 'work', startAt: now } as never)
      break
    case 'lunch_in': closeOpen(); att.segments.push({ type: 'lunch', startAt: now } as never); break
    case 'tea_in': closeOpen(); att.segments.push({ type: 'tea', startAt: now } as never); break
    case 'lunch_out':
    case 'tea_out': closeOpen(); att.segments.push({ type: 'work', startAt: now } as never); break
    case 'out': closeOpen(); att.logoutAt = now; break
  }
  if (workMode) att.workMode = workMode as never
  att.source = 'web' as never // a manual web punch marks the session as web (so it shows live without an agent heartbeat)
  recompute(att as never, lunchAllowance, teaAllowance, att.loginAt || undefined, att.logoutAt || undefined)
  await att.save()
  ok(res, att)
}))

// GET /attendance/me?month=YYYY-MM
router.get('/me', asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || todayKey().slice(0, 7)
  const rows = await Attendance.find({ userId: req.user!.id, date: new RegExp('^' + month) }).sort({ date: 1 }).lean()
  ok(res, rows)
}))

// GET /attendance/calendar?month=YYYY-MM&userId= — month grid honouring branch weekend policy + holidays
router.get('/calendar', asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || todayKey().slice(0, 7)
  // employees can only view their own; admins may pass userId
  let userId = req.user!.id
  if (req.query.userId && req.user!.role !== 'employee') userId = req.query.userId as string
  const user = await User.findById(userId).lean()
  if (!user) throw ApiError.notFound('User not found')
  const branch = user.branchId ? await Branch.findById(user.branchId).lean() : null

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = todayKey()

  const records = await Attendance.find({ userId, date: new RegExp('^' + month) }).lean()
  const recByDate = new Map(records.map(r => [r.date, r]))
  const holidays = branch ? await Holiday.find({ branchId: branch._id }).lean() : []
  const holidaySet = new Set(holidays.filter(h => h.date).map(h => new Date(h.date as Date).toISOString().slice(0, 10)))
  const leaves = await LeaveRequest.find({ userId, status: 'approved', isDeleted: false }).lean()
  const onLeave = (dateStr: string) => leaves.some(l => dateStr >= new Date(l.fromDate as Date).toISOString().slice(0, 10) && dateStr <= new Date(l.toDate as Date).toISOString().slice(0, 10))

  const days = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m - 1, d)
    const dateStr = `${month}-${String(d).padStart(2, '0')}`
    let status = 'none'
    if (holidaySet.has(dateStr)) status = 'holiday'
    else if (isWeeklyOff(branch?.weekend, date)) status = 'weekoff'
    else if (onLeave(dateStr)) status = 'leave'
    else if (recByDate.has(dateStr)) status = recByDate.get(dateStr)!.lateMark ? 'late' : (recByDate.get(dateStr)!.status as string)
    else if (dateStr < todayStr) status = 'absent'
    else if (dateStr === todayStr) status = 'today'
    else status = 'future'
    days.push({ date: dateStr, day: d, dow: date.getDay(), status })
  }
  ok(res, { month, userId, weekend: branch?.weekend || null, days })
}))

const fmtDate = (d: unknown) => new Date(d as Date).toISOString().slice(0, 10)
const shiftSeconds = (branch: { shift?: { startTime?: string; endTime?: string }; breaks?: { lunchMinutes?: number; teaMinutes?: number } } | null) => {
  const [sh, sm] = (branch?.shift?.startTime || '09:00').split(':').map(Number)
  const [eh, em] = (branch?.shift?.endTime || '18:00').split(':').map(Number)
  const len = Math.max(0, (eh * 60 + em) - (sh * 60 + sm)) * 60
  const breaks = ((branch?.breaks?.lunchMinutes || 0) + (branch?.breaks?.teaMinutes || 0)) * 60
  return Math.max(0, len - breaks) // required productive seconds per working day
}

// GET /attendance/monthly?month=YYYY-MM&branchId= — grid: every employee × every day status (admin)
router.get('/monthly', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || todayKey().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = todayKey()
  const uf: Record<string, unknown> = { isDeleted: false, ...branchScope(req) }
  if (req.query.branchId && req.user!.role === 'superadmin') uf.branchId = req.query.branchId
  const [users, branches, records, holidays, leaves] = await Promise.all([
    User.find(uf).select('fullName department branchId').sort({ fullName: 1 }).lean(),
    Branch.find({}).lean(),
    Attendance.find({ date: new RegExp('^' + month) }).lean(),
    Holiday.find({}).lean(),
    LeaveRequest.find({ status: 'approved', isDeleted: false }).lean(),
  ])
  const branchMap = new Map(branches.map(b => [String(b._id), b]))
  const recByKey = new Map(records.map(r => [String(r.userId) + r.date, r]))
  const holidaySet = new Set(holidays.filter(h => h.date).map(h => String(h.branchId) + fmtDate(h.date)))

  const days = Array.from({ length: daysInMonth }, (_, i) => { const d = new Date(y, m - 1, i + 1); return { day: i + 1, dow: d.getDay() } })
  const employees = users.map(u => {
    const branch = branchMap.get(String(u.branchId))
    const uLeaves = leaves.filter(l => String(l.userId) === String(u._id))
    const cells = days.map(({ day }) => {
      const date = new Date(y, m - 1, day)
      const dateStr = `${month}-${String(day).padStart(2, '0')}`
      if (holidaySet.has(String(u.branchId) + dateStr)) return 'holiday'
      if (isWeeklyOff(branch?.weekend, date)) return 'weekoff'
      if (uLeaves.some(l => dateStr >= fmtDate(l.fromDate) && dateStr <= fmtDate(l.toDate))) return 'leave'
      const rec = recByKey.get(String(u._id) + dateStr)
      if (rec) {
        const base = rec.lateMark ? 'late' : (rec.status as string)
        return base === 'present' && rec.workMode === 'wfh' ? 'wfh' : base
      }
      if (dateStr < todayStr) return 'absent'
      if (dateStr === todayStr) return 'today'
      return 'future'
    })
    return { userId: u._id, name: u.fullName, dept: u.department, cells }
  })
  ok(res, { month, days, employees })
}))

// GET /attendance/report?userId=&month= — date-wise detail for one employee (self or admin)
router.get('/report', asyncHandler(async (req, res) => {
  let userId = req.user!.id
  if (req.query.userId && req.user!.role !== 'employee') userId = req.query.userId as string
  const month = (req.query.month as string) || todayKey().slice(0, 7)
  const user = await User.findById(userId).populate('branchId', 'name shift breaks weekend').lean() as { fullName?: string; department?: string; role?: string; branchId?: { name?: string } } | null
  if (!user) throw ApiError.notFound('User not found')
  const branch = (user.branchId as { name?: string; shift?: unknown; breaks?: unknown; weekend?: unknown } | null) || null
  const requiredSec = shiftSeconds(branch as never)
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const todayStr = todayKey()
  const [records, holidays, leaves] = await Promise.all([
    Attendance.find({ userId, date: new RegExp('^' + month) }).lean(),
    Holiday.find({ branchId: (user.branchId as { _id?: unknown })?._id }).lean(),
    LeaveRequest.find({ userId, status: 'approved', isDeleted: false }).lean(),
  ])
  const recByDate = new Map(records.map(r => [r.date, r]))
  const holidaySet = new Set(holidays.filter(h => h.date).map(h => fmtDate(h.date)))
  const onLeave = (s: string) => leaves.some(l => s >= fmtDate(l.fromDate) && s <= fmtDate(l.toDate))

  const sum = { present: 0, halfday: 0, absent: 0, leave: 0, late: 0, idleSec: 0, workSec: 0, requiredSec: 0 }
  const days = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m - 1, d)
    const dateStr = `${month}-${String(d).padStart(2, '0')}`
    const rec = recByDate.get(dateStr)
    let status = 'none'
    if (holidaySet.has(dateStr)) status = 'holiday'
    else if (isWeeklyOff((branch as { weekend?: unknown })?.weekend as never, date)) status = 'weekoff'
    else if (onLeave(dateStr)) status = 'leave'
    else if (rec) status = 'present'
    else if (dateStr < todayStr) status = 'absent'
    else if (dateStr === todayStr) status = 'today'
    else status = 'future'

    const t = rec?.totals as { workSeconds?: number; idleSeconds?: number; lunchSeconds?: number; teaSeconds?: number } | undefined
    const workSec = t?.workSeconds || 0
    const isWorkingDay = !['holiday', 'weekoff', 'leave', 'future'].includes(status)
    const halfDay = status === 'present' && workSec > 0 && workSec < requiredSec * 0.5
    if (status === 'present') { sum.present++; if (halfDay) sum.halfday++ }
    if (status === 'absent') sum.absent++
    if (status === 'leave') sum.leave++
    if (rec?.lateMark) sum.late++
    sum.idleSec += t?.idleSeconds || 0
    sum.workSec += workSec
    if (isWorkingDay) sum.requiredSec += requiredSec

    days.push({
      date: dateStr, dow: date.getDay(), status, halfDay,
      checkIn: rec?.loginAt || null, checkOut: rec?.logoutAt || null,
      workSec, idleSec: t?.idleSeconds || 0, lunchSec: t?.lunchSeconds || 0, teaSec: t?.teaSeconds || 0,
      requiredSec: isWorkingDay ? requiredSec : 0,
      remainingSec: isWorkingDay ? Math.max(0, requiredSec - workSec) : 0,
      lateSec: rec?.lateBySeconds || 0, lateMark: !!rec?.lateMark,
    })
  }
  const efficiency = sum.requiredSec ? Math.round((sum.workSec / sum.requiredSec) * 100) : 0
  ok(res, { user: { fullName: user.fullName, department: user.department, role: user.role, branch: branch?.name || '—' }, month, requiredSec, summary: { ...sum, efficiency }, days })
}))

// GET /attendance?branchId=&date= (admin)
router.get('/', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { ...branchScope(req) }
  if (req.query.date) filter.date = req.query.date
  else filter.date = todayKey()
  if (req.query.branchId) filter.branchId = req.query.branchId
  const rows = await Attendance.find(filter).populate('userId', 'fullName department workMode avatarColor').lean()
  ok(res, rows)
}))

// PATCH /attendance/:id/regularize (admin, audited)
router.patch('/:id/regularize', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const before = await Attendance.findById(req.params.id).lean()
  const doc = await Attendance.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user!.id }, { new: true })
  if (!doc) throw ApiError.notFound('Attendance not found')
  await audit(req.user, 'attendance.regularize', 'Attendance', doc._id, { before, after: doc })
  ok(res, doc)
}))

export default router
