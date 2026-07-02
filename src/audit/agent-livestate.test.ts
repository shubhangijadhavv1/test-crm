/**
 * Instant live-state (active/idle/break) endpoint + exact idle exposure, self-cleaning.
 *   npx tsx src/audit/agent-livestate.test.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Attendance } from '../models/Attendance'
import { ActivityTick } from '../models/ActivityTick'
import { User } from '../models/User'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com'
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345'
let sa = ''
let pass = 0, fail = 0
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m: string, p: string, body?: unknown, tok = sa): Promise<any> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json().catch(() => ({}))
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++;  }

async function main() {

  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).data?.accessToken
  const branchId = (await call('GET', '/branches')).data?.[0]?._id
  const tag = Date.now()
  const email = `agentls.${tag}@gdc.com`
  const empId = (await call('POST', '/employees', { fullName: 'Agent LS', email, password: 'Test@12345', role: 'employee', branchId })).data._id
  const tok = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).data.accessToken

  await call('POST', '/agent/clock-in', undefined, tok)

  // push an idle transition with an exact idle-start 42s ago
  const idleStart = new Date(Date.now() - 42_000).toISOString()
  const st = await call('POST', '/agent/state', { state: 'idle', idleStartedAt: idleStart }, tok)
  check('state endpoint accepts idle', st.data?.state === 'idle')

  let row = ((await call('GET', '/agent/summary')).data || []).find((r: any) => String(r.userId?._id || r.userId) === empId)
  check('summary exposes liveState.idle', row?.liveState?.state === 'idle')
  check('exact idle-start preserved (to the second)', new Date(row.liveState.idleStartedAt).getTime() === new Date(idleStart).getTime(), `${row?.liveState?.idleStartedAt}`)

  // back to active
  await call('POST', '/agent/state', { state: 'active' }, tok)
  row = ((await call('GET', '/agent/summary')).data || []).find((r: any) => String(r.userId?._id || r.userId) === empId)
  check('liveState flips to active', row?.liveState?.state === 'active')

  // ---- cleanup ----
  await connectDB()
  const att = await Attendance.findOne({ userId: empId })
  await ActivityTick.deleteMany({ userId: empId })
  await Attendance.deleteMany({ _id: att?._id })
  await User.deleteMany({ _id: empId })
  await disconnectDB()

  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
