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
    billingModel: branch.breaks?.billingModel || 'B',
  }
}
