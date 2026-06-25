import { Attendance } from '../models/Attendance'
import { Branch } from '../models/Branch'
import { ActivityTick } from '../models/ActivityTick'
import { computeDay, policyFromBranch } from './engine'

/**
 * Recompute Attendance.totals + lateMark — SEGMENT-BASED, so multiple clock-in/out
 * cycles in one day accumulate correctly and the clocked-out gaps count as neither
 * work nor idle. Single source of truth: re-derivable from segments + ticks.
 *
 *   presence  = Σ segment durations (work + lunch + tea)   ← excludes gaps
 *   idle      = idle ticks within the clocked-in windows (+ break overage, Model B)
 *   net work  = Σ work-segment seconds − idle
 *   lunch/tea = min(taken, allowance)   (overage pushed into idle)
 */
export async function recomputeSession(attendanceId: unknown) {
  const att = await Attendance.findById(attendanceId)
  if (!att || !att.loginAt) return att
  const branch = att.branchId ? await Branch.findById(att.branchId).lean() : null
  const policy = policyFromBranch((branch || {}) as Parameters<typeof policyFromBranch>[0])
  const now = Date.now()

  // An OPEN segment only accrues up to the last heartbeat (+1 interval grace). If the
  // agent crashed / quit / lost network, presence stops growing instead of running forever.
  const last = await ActivityTick.findOne({ attendanceId }).sort({ ts: -1 }).select('ts').lean()
  const liveEnd = last ? Math.min(now, new Date(last.ts as Date).getTime() + 120_000) : now

  // Sum segment durations (an open segment runs to the live end, not blindly to now).
  let workSeg = 0, lunchTaken = 0, teaTaken = 0
  for (const s of att.segments) {
    const start = new Date(s.startAt as Date).getTime()
    const end = s.endAt ? new Date(s.endAt as Date).getTime() : liveEnd
    const sec = Math.max(0, Math.floor((end - start) / 1000))
    if (s.type === 'work') workSeg += sec
    else if (s.type === 'lunch') lunchTaken += sec
    else if (s.type === 'tea') teaTaken += sec
  }

  // Pure idle = idle heartbeats × 60s. These occur DURING work segments (agent pauses
  // idle while on break), so they're the only thing subtracted from work.
  const idleTicks = await ActivityTick.countDocuments({ attendanceId, isIdle: true })
  const pureIdle = idleTicks * 60

  // Break time is in its OWN segments (never part of work). Valid (within allowance) breaks
  // are paid; the overage beyond allowance is reclassified as idle.
  const lunchAllow = policy.breakAllowanceSeconds.lunch || 0
  const teaAllow = policy.breakAllowanceSeconds.tea || 0
  const overage = Math.max(0, lunchTaken - lunchAllow) + Math.max(0, teaTaken - teaAllow)

  const net = Math.max(0, workSeg - pureIdle) // work excludes idle ONLY (breaks aren't in work)
  const idle = policy.billingModel === 'A'
    ? pureIdle + lunchTaken + teaTaken // Model A: all break time unpaid
    : pureIdle + overage              // Model B (default): only break overage is idle
  att.totals = {
    workSeconds: net,
    idleSeconds: idle,
    lunchSeconds: policy.billingModel === 'A' ? 0 : Math.min(lunchTaken, lunchAllow),
    teaSeconds: policy.billingModel === 'A' ? 0 : Math.min(teaTaken, teaAllow),
    productiveSeconds: net,
  } as never

  // Late mark is based on the FIRST clock-in of the day.
  const r = computeDay({ clockIn: att.loginAt, clockOut: att.logoutAt || new Date(), ticks: [], breaks: [], policy })
  att.lateMark = r.lateMark
  att.lateBySeconds = r.lateBySeconds
  await att.save()
  return att
}

/**
 * Finalize forgotten/agent sessions from prior days: an open session (loginAt set,
 * no logoutAt) on a past date is auto-closed at its last heartbeat (fallback loginAt),
 * then recomputed from ticks. Idempotent.
 */
export async function finalizeStaleSessions(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const stale = await Attendance.find({ logoutAt: { $in: [null, undefined] }, loginAt: { $ne: null }, date: { $lt: today } })
  let closed = 0
  for (const att of stale) {
    const last = await ActivityTick.findOne({ attendanceId: att._id }).sort({ ts: -1 }).select('ts').lean()
    const logoutAt = last?.ts ? new Date(last.ts) : new Date(att.loginAt as Date)
    const open = att.segments.find(s => !s.endAt)
    if (open) { open.endAt = logoutAt; open.seconds = Math.max(0, Math.floor((logoutAt.getTime() - new Date(open.startAt!).getTime()) / 1000)) }
    att.logoutAt = logoutAt
    att.autoClosed = true as never
    await att.save()
    await recomputeSession(att._id)
    closed++
  }
  return closed
}
