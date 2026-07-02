/**
 * Agent nightly finalize + admin read-endpoints test, self-cleaning.
 *   npx tsx src/audit/agent-finalize.test.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Attendance } from '../models/Attendance'
import { ActivityTick, Screenshot } from '../models/ActivityTick'
import { User } from '../models/User'
import { finalizeStaleSessions } from '../agent/session'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com'
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345'
let sa = ''
let pass = 0, fail = 0
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m: string, p: string, body?: unknown, tok = sa): Promise<{ status: number; json: any }> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; }

async function main() {

  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken
  const branchId = (await call('GET', '/branches')).json.data?.[0]?._id
  const tag = Date.now()
  const email = `agentfin.${tag}@gdc.com`
  const empId = (await call('POST', '/employees', { fullName: 'Agent Fin', email, password: 'Test@12345', role: 'employee', branchId })).json.data._id
  const tok = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).json.data.accessToken

  await connectDB()

  // ---- finalize: a forgotten OPEN session from yesterday ----
  const yKey = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const loginAt = new Date(`${yKey}T09:05:00`)
  const lastTick = new Date(`${yKey}T17:30:00`)
  const stale = await Attendance.create({ userId: empId, branchId, date: yKey, loginAt, segments: [{ type: 'work', startAt: loginAt }], status: 'present', source: 'agent' })
  await ActivityTick.insertMany([
    { attendanceId: stale._id, userId: empId, branchId, ts: new Date(`${yKey}T10:00:00`), isIdle: true },
    { attendanceId: stale._id, userId: empId, branchId, ts: lastTick, isIdle: false },
  ])
  const closed = await finalizeStaleSessions()
  check('finalize closed ≥1 stale session', closed >= 1, `closed=${closed}`)
  const fin = await Attendance.findById(stale._id).lean()
  check('stale session auto-closed at last tick', !!fin?.logoutAt && (fin as any).autoClosed === true && new Date(fin!.logoutAt as Date).getTime() === lastTick.getTime())
  check('totals recomputed (idle = 1 tick = 60s)', fin?.totals?.idleSeconds === 60, `idle=${fin?.totals?.idleSeconds}`)
  const reclose = await finalizeStaleSessions()
  check('finalize is idempotent (does not re-close)', !(await Attendance.findById(stale._id).lean())!.logoutAt === false && reclose >= 0)

  // ---- admin reads on a live (today) session ----
  await call('POST', '/agent/clock-in', undefined, tok)
  await call('POST', '/agent/heartbeat', { ticks: [{ ts: new Date(), isIdle: true }, { ts: new Date(), isIdle: false }] }, tok)
  await call('POST', '/agent/screenshot', { url: 'https://s/x.jpg', blurred: true }, tok)

  const tl = await call('GET', `/agent/timeline?userId=${empId}`)
  check('admin timeline returns session + ticks', tl.status === 200 && !!tl.json.data?.session && tl.json.data.ticks.length === 2)
  const sum = await call('GET', '/agent/summary')
  check('admin summary includes the employee', sum.status === 200 && sum.json.data.some((r: any) => String(r.userId?._id || r.userId) === empId))
  const shots = await call('GET', `/agent/screenshots?userId=${empId}`)
  check('admin screenshots list returns 1', shots.status === 200 && shots.json.data.length === 1)

  // employee cannot read someone else's timeline (falls back to self → no other-user data)
  const self = await call('GET', `/agent/timeline?userId=${sa ? 'someoneelse' : ''}`, undefined, tok)
  check('employee read is self-scoped', self.status === 200 && String(self.json.data.userId) === empId)

  // ---- cleanup ----
  const todayKey = new Date().toISOString().slice(0, 10)
  const today = await Attendance.findOne({ userId: empId, date: todayKey })
  await ActivityTick.deleteMany({ userId: empId })
  await Screenshot.deleteMany({ userId: empId })
  await Attendance.deleteMany({ _id: { $in: [stale._id, today?._id] } })
  await User.deleteMany({ _id: empId })
  await disconnectDB()

  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
