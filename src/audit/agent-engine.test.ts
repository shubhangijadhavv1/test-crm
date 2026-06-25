/**
 * Work-time / late-mark engine — worked-example unit tests (Phase 4).
 *   npx tsx src/audit/agent-engine.test.ts
 * Pure math: no DB, no agent, fully deterministic.
 */
import { computeDay, policyFromBranch, WorkPolicy, Tick } from '../agent/engine'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`) }
const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(2026, 5, 16, h, m, 0, 0); return d }
const idleTicks = (n: number): Tick[] => Array.from({ length: n }, () => ({ isIdle: true }))
const activeTicks = (n: number): Tick[] => Array.from({ length: n }, () => ({ isIdle: false }))

const base: WorkPolicy = {
  shiftStart: '09:00', shiftEnd: '18:00', graceMinutes: 15,
  breakAllowanceSeconds: { lunch: 30 * 60, tea: 15 * 60 }, billingModel: 'B',
}

console.log(`\nWork-time / late-mark engine\n${'─'.repeat(60)}`)

// 1) On-time, lunch exactly at allowance, tea overage 5m → Model B
{
  const r = computeDay({
    clockIn: at('09:05'), clockOut: at('18:00'),
    ticks: [...idleTicks(10), ...activeTicks(50)], tickSeconds: 60,
    breaks: [{ type: 'lunch', seconds: 30 * 60 }, { type: 'tea', seconds: 20 * 60 }],
    policy: base,
  })
  check('within grace ⇒ not late', r.lateMark === false && r.dayStatus === 'PRESENT', `lateBy=${r.lateBySeconds}`)
  check('span = 8h55m', r.spanSeconds === 8 * 3600 + 55 * 60, `${r.spanSeconds}`)
  check('pure idle = 10m', r.pureIdleSeconds === 600)
  check('lunch overage 0, tea overage 5m', r.breakdown.lunch.overageSeconds === 0 && r.breakdown.tea.overageSeconds === 300)
  check('overage total = 5m', r.overageSeconds === 300)
  // netWork(B) = span − idle − overage = 32100 − 600 − 300
  check('netWork (B) excludes only overage', r.netWorkSeconds === 32100 - 600 - 300, `${r.netWorkSeconds}`)
}

// 2) Same facts, Model A → all breaks unpaid
{
  const r = computeDay({
    clockIn: at('09:05'), clockOut: at('18:00'),
    ticks: idleTicks(10), tickSeconds: 60,
    breaks: [{ type: 'lunch', seconds: 30 * 60 }, { type: 'tea', seconds: 20 * 60 }],
    policy: { ...base, billingModel: 'A' },
  })
  // netWork(A) = span − idle − allBreaks = 32100 − 600 − 3000
  check('netWork (A) subtracts all breaks', r.netWorkSeconds === 32100 - 600 - (50 * 60), `${r.netWorkSeconds}`)
}

// 3) Late beyond grace
{
  const r = computeDay({ clockIn: at('09:20'), clockOut: at('18:00'), ticks: [], breaks: [], policy: base })
  check('clockIn 09:20 ⇒ lateMark', r.lateMark === true && r.dayStatus === 'LATE')
  check('lateBy = 20m (from shiftStart)', r.lateBySeconds === 20 * 60, `${r.lateBySeconds}`)
}

// 4) Half-day threshold
{
  const r = computeDay({ clockIn: at('11:30'), clockOut: at('18:00'), ticks: [], breaks: [], policy: { ...base, halfDayAfterMinutes: 120 } })
  check('2h+ late ⇒ HALF_DAY', r.dayStatus === 'HALF_DAY', `lateBy=${r.lateBySeconds}`)
}

// 5) Walk-away (pure idle, no break started) reduces net work directly
{
  const r = computeDay({ clockIn: at('09:00'), clockOut: at('10:00'), ticks: idleTicks(15), breaks: [], policy: base })
  check('60m span, 15m pure idle ⇒ 45m net', r.netWorkSeconds === 45 * 60, `${r.netWorkSeconds}`)
}

// 6) policyFromBranch reuses CRM branch settings
{
  const p = policyFromBranch({ shift: { startTime: '10:00', graceMinutes: 10 }, breaks: { lunchMinutes: 45, teaMinutes: 15, billingModel: 'A' }, monitoring: { halfDayAfterMinutes: 90 } })
  check('policy derived from branch', p.shiftStart === '10:00' && p.graceMinutes === 10 && p.billingModel === 'A' && p.breakAllowanceSeconds.lunch === 2700 && p.halfDayAfterMinutes === 90)
}

// 7) Overage never makes net work negative; clamp at 0
{
  const r = computeDay({ clockIn: at('09:00'), clockOut: at('09:10'), ticks: idleTicks(5), breaks: [{ type: 'lunch', seconds: 60 * 60 }], policy: base })
  check('net work clamped at 0', r.netWorkSeconds === 0, `${r.netWorkSeconds}`)
}

console.log(`${'─'.repeat(60)}\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
