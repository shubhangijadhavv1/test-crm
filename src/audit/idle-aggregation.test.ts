/**
 * Regression: idle accrued in a tick that ENDS active must not be dropped.
 *   npx tsx src/audit/idle-aggregation.test.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Attendance } from '../models/Attendance'
import { ActivityTick } from '../models/ActivityTick'
import { recomputeSession } from '../agent/session'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`) }

async function main() {
  await connectDB()
  console.log(`\nIdle aggregation — partial idle in active-ending ticks\n${'─'.repeat(60)}`)
  const date = '2099-01-01' // far future → never clashes with real data
  const loginAt = new Date('2099-01-01T10:00:00.000Z')
  await Attendance.deleteMany({ date })
  const att = await Attendance.create({
    date, loginAt, source: 'agent',
    segments: [{ type: 'work', startAt: loginAt, endAt: new Date('2099-01-01T11:00:00.000Z'), seconds: 3600 }],
  })
  await ActivityTick.insertMany([
    { attendanceId: att._id, ts: new Date('2099-01-01T10:00:15Z'), isIdle: true, idleSeconds: 15, state: 'idle' },
    // user was idle 7s then moved the mouse → tick ENDS active but carries 7s of real idle
    { attendanceId: att._id, ts: new Date('2099-01-01T10:00:30Z'), isIdle: false, idleSeconds: 7, state: 'active' },
    { attendanceId: att._id, ts: new Date('2099-01-01T10:00:45Z'), isIdle: false, idleSeconds: 0, state: 'active' },
  ])
  const updated = await recomputeSession(att._id)
  const idle = (updated?.totals as { idleSeconds?: number })?.idleSeconds
  check('idle = 22s (15 + 7), not 15 — active-ending idle kept', idle === 22, `got ${idle}s`)

  await ActivityTick.deleteMany({ attendanceId: att._id })
  await Attendance.deleteMany({ date })
  console.log('─'.repeat(60))
  console.log(`${pass} passed, ${fail} failed · test docs cleaned up`)
  await disconnectDB()
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
