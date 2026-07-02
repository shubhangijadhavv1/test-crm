/**
 * One lunch + one tea per day enforcement, self-cleaning.
 *   npx tsx src/audit/agent-breaks.test.ts
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
async function call(m: string, p: string, body?: unknown, tok = sa): Promise<{ status: number; json: any }> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; }

async function main() {

  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken
  const branchId = (await call('GET', '/branches')).json.data?.[0]?._id
  const tag = Date.now()
  const email = `agentbrk.${tag}@gdc.com`
  const empId = (await call('POST', '/employees', { fullName: 'Agent Brk', email, password: 'Test@12345', role: 'employee', branchId })).json.data._id
  const tok = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).json.data.accessToken

  await call('POST', '/agent/clock-in', undefined, tok)

  check('first lunch starts', (await call('POST', '/agent/break/start', { type: 'lunch' }, tok)).status === 200)
  check('cannot start tea while on lunch (409)', (await call('POST', '/agent/break/start', { type: 'tea' }, tok)).status === 409)
  check('lunch ends', (await call('POST', '/agent/break/end', undefined, tok)).status === 200)
  check('second lunch rejected (409)', (await call('POST', '/agent/break/start', { type: 'lunch' }, tok)).status === 409)
  check('first tea starts', (await call('POST', '/agent/break/start', { type: 'tea' }, tok)).status === 200)
  await call('POST', '/agent/break/end', undefined, tok)
  check('second tea rejected (409)', (await call('POST', '/agent/break/start', { type: 'tea' }, tok)).status === 409)

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
