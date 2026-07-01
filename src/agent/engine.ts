/**
 * Work-time / late-mark engine (Desktop Agent — Blueprint Phase 4).
 *
 * Pure, deterministic, DB-free: given raw facts (clock in/out, per-tick idle flags,
 * break intervals) plus a branch policy, it produces the defensible daily numbers.
 * The agent reports raw; THIS decides. Re-runnable from stored ticks if rules change.
 *
 * Math (see GDC blueprint §3):
 *   span            = clockOut − clockIn
 *   pureIdle        = idle ticks × tickSeconds   (break time excluded by the agent)
 *   counted(type)   = min(taken, allowance)      → paid
 *   overage(type)   = max(0, taken − allowance)  → pushed into idle
 *   effectiveIdle   = pureIdle + Σ overage
 *   netWork (B)     = span − pureIdle − Σ overage     (allowed breaks paid)
 *   netWork (A)     = span − pureIdle − Σ taken       (every break unpaid)
 *   lateBy          = max(0, clockIn − shiftStart)
 *   lateMark        = clockIn > shiftStart + grace
 */

export type BreakInterval = { type: string; seconds: number }
export type Tick = { isIdle: boolean }

export interface WorkPolicy {
  shiftStart: string // 'HH:MM'
  shiftEnd: string // 'HH:MM'
  graceMinutes: number
  halfDayAfterMinutes?: number // late beyond this ⇒ half day; 0/undefined disables
  breakAllowanceSeconds: Record<string, number> // { lunch: 2700, tea: 900 }
  billingModel: 'A' | 'B'
}

export interface ComputeInput {
  clockIn: Date
  clockOut: Date
  ticks: Tick[] // per-heartbeat idle flags (break ticks already excluded by the agent)
  tickSeconds?: number // seconds each tick represents (default 60)
  breaks: BreakInterval[]
  policy: WorkPolicy
}

export interface DayResult {
  spanSeconds: number
  pureIdleSeconds: number
  breakSeconds: number // total taken across all break types
  countedBreakSeconds: number // within allowance (paid)
  overageSeconds: number // beyond allowance (penalised → idle)
  effectiveIdleSeconds: number
  netWorkSeconds: number
  productiveSeconds: number // alias used by Attendance.totals
  lateMark: boolean
  lateBySeconds: number
  dayStatus: 'PRESENT' | 'LATE' | 'HALF_DAY'
  breakdown: Record<string, { takenSeconds: number; countedSeconds: number; overageSeconds: number }>
}

/** Build a Date at `HH:MM` on the same calendar day as `ref` (local time). */
function hhmmOn(ref: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(ref)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

export function computeDay(input: ComputeInput): DayResult {
  const tickSeconds = input.tickSeconds ?? 60
  const spanSeconds = Math.max(0, Math.round((input.clockOut.getTime() - input.clockIn.getTime()) / 1000))
  const pureIdleSeconds = input.ticks.reduce((n, t) => n + (t.isIdle ? 1 : 0), 0) * tickSeconds

  // Group breaks by type, then apply per-type allowance.
  const takenByType: Record<string, number> = {}
  for (const b of input.breaks) takenByType[b.type] = (takenByType[b.type] || 0) + b.seconds

  let breakSeconds = 0, countedBreakSeconds = 0, overageSeconds = 0
  const breakdown: DayResult['breakdown'] = {}
  for (const [type, taken] of Object.entries(takenByType)) {
    const allowance = input.policy.breakAllowanceSeconds[type] ?? 0
    const counted = Math.min(taken, allowance)
    const overage = Math.max(0, taken - allowance)
    breakSeconds += taken
    countedBreakSeconds += counted
    overageSeconds += overage
    breakdown[type] = { takenSeconds: taken, countedSeconds: counted, overageSeconds: overage }
  }

  const effectiveIdleSeconds = pureIdleSeconds + overageSeconds
  const netWorkSeconds = input.policy.billingModel === 'A'
    ? Math.max(0, spanSeconds - pureIdleSeconds - breakSeconds)
    : Math.max(0, spanSeconds - pureIdleSeconds - overageSeconds)

  const shiftStart = hhmmOn(input.clockIn, input.policy.shiftStart)
  const effectiveStart = shiftStart.getTime() + input.policy.graceMinutes * 60_000
  const lateBySeconds = Math.max(0, Math.round((input.clockIn.getTime() - shiftStart.getTime()) / 1000))
  const lateMark = input.clockIn.getTime() > effectiveStart

  let dayStatus: DayResult['dayStatus'] = 'PRESENT'
  if (lateMark) dayStatus = 'LATE'
  const halfDay = input.policy.halfDayAfterMinutes
  if (halfDay && input.clockIn.getTime() > shiftStart.getTime() + halfDay * 60_000) dayStatus = 'HALF_DAY'

  return {
    spanSeconds, pureIdleSeconds, breakSeconds, countedBreakSeconds, overageSeconds,
    effectiveIdleSeconds, netWorkSeconds, productiveSeconds: netWorkSeconds,
    lateMark, lateBySeconds, dayStatus, breakdown,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Net Productive Hours model (single source of truth for live + finalized totals)
//
// Required Productive = Shift − allowed lunch − allowed tea   (breaks are "free" time)
// Net Productive      = elapsed(clockIn→now) − ACTUAL lunch − ACTUAL tea − idle
//                       (full breaks unpaid; extra break is therefore unpaid too)
// Remaining           = max(0, Required − Net)
// Overtime            = max(0, Net − Required)
// Expected Logout     = clockIn + Required + actualLunch + actualTea + idle
//                       (= now + Remaining; uses LESS break ⇒ finishes earlier)
// All durations are EXACT seconds — idle is never rounded up to a whole minute.
// ───────────────────────────────────────────────────────────────────────────
export interface ProductiveInput {
  clockIn: Date
  now?: Date // clockOut, or the current time for a live session
  spanSeconds?: number // explicit presence (Σ segment durations, excludes clocked-out gaps); overrides now−clockIn
  idleSeconds: number // EXACT measured idle seconds (to the second)
  lunchSeconds: number // actual lunch taken
  teaSeconds: number // actual tea taken
  policy: WorkPolicy
}
export interface ProductiveResult {
  shiftLenSeconds: number
  spanSeconds: number
  requiredProductiveSeconds: number
  allowedLunchSeconds: number
  allowedTeaSeconds: number
  countedLunchSeconds: number
  countedTeaSeconds: number
  extraLunchSeconds: number
  extraTeaSeconds: number
  extraBreakSeconds: number
  idleSeconds: number
  netProductiveSeconds: number
  remainingProductiveSeconds: number
  overtimeSeconds: number
  completionPct: number
  expectedLogout: Date
}

export function productiveTotals(input: ProductiveInput): ProductiveResult {
  const shiftStart = hhmmOn(input.clockIn, input.policy.shiftStart)
  let shiftEnd = hhmmOn(input.clockIn, input.policy.shiftEnd)
  if (shiftEnd.getTime() <= shiftStart.getTime()) shiftEnd = new Date(shiftEnd.getTime() + 24 * 3600_000) // overnight shift
  const shiftLenSeconds = Math.max(0, Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 1000))

  const allowedLunchSeconds = input.policy.breakAllowanceSeconds.lunch ?? 0
  const allowedTeaSeconds = input.policy.breakAllowanceSeconds.tea ?? 0
  const requiredProductiveSeconds = Math.max(0, shiftLenSeconds - allowedLunchSeconds - allowedTeaSeconds)

  const lunch = Math.max(0, input.lunchSeconds || 0)
  const tea = Math.max(0, input.teaSeconds || 0)
  const idle = Math.max(0, Math.round(input.idleSeconds || 0)) // exact seconds, no minute rounding
  const countedLunchSeconds = Math.min(lunch, allowedLunchSeconds)
  const countedTeaSeconds = Math.min(tea, allowedTeaSeconds)
  const extraLunchSeconds = Math.max(0, lunch - allowedLunchSeconds)
  const extraTeaSeconds = Math.max(0, tea - allowedTeaSeconds)
  const extraBreakSeconds = extraLunchSeconds + extraTeaSeconds

  const spanSeconds = input.spanSeconds != null
    ? Math.max(0, Math.round(input.spanSeconds))
    : Math.max(0, Math.round(((input.now?.getTime() ?? Date.now()) - input.clockIn.getTime()) / 1000))
  // Model A: every break minute is unpaid → subtract the FULL breaks plus idle.
  const netProductiveSeconds = Math.max(0, spanSeconds - lunch - tea - idle)
  const remainingProductiveSeconds = Math.max(0, requiredProductiveSeconds - netProductiveSeconds)
  const overtimeSeconds = Math.max(0, netProductiveSeconds - requiredProductiveSeconds)
  const completionPct = requiredProductiveSeconds > 0
    ? Math.min(100, Math.round((netProductiveSeconds / requiredProductiveSeconds) * 100))
    : 100
  // Expected logout = clockIn + required + actual breaks + idle (≡ now + remaining).
  const expectedLogout = new Date(input.clockIn.getTime() + (requiredProductiveSeconds + lunch + tea + idle) * 1000)

  return {
    shiftLenSeconds, spanSeconds, requiredProductiveSeconds,
    allowedLunchSeconds, allowedTeaSeconds, countedLunchSeconds, countedTeaSeconds,
    extraLunchSeconds, extraTeaSeconds, extraBreakSeconds,
    idleSeconds: idle, netProductiveSeconds, remainingProductiveSeconds,
    overtimeSeconds, completionPct, expectedLogout,
  }
}

/** Derive a WorkPolicy from a Branch document (reuses existing CRM branch settings). */
export function policyFromBranch(branch: {
  shift?: { startTime?: string; endTime?: string; graceMinutes?: number }
  breaks?: { lunchMinutes?: number; teaMinutes?: number; billingModel?: 'A' | 'B' }
  monitoring?: { halfDayAfterMinutes?: number }
}): WorkPolicy {
  return {
    shiftStart: branch.shift?.startTime || '09:00',
    shiftEnd: branch.shift?.endTime || '18:00',
    graceMinutes: branch.shift?.graceMinutes ?? 15,
    halfDayAfterMinutes: branch.monitoring?.halfDayAfterMinutes || undefined,
    breakAllowanceSeconds: {
      lunch: (branch.breaks?.lunchMinutes ?? 45) * 60,
      tea: (branch.breaks?.teaMinutes ?? 15) * 60,
    },
    // Net Productive model: every break minute is unpaid (Model A) for ALL branches.
    billingModel: 'A',
  }
}
