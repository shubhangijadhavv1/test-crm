/**
 * Task DELETE + bulk + deadline-reminder test (H2, H3), with cleanup.
 *   npx tsx src/audit/task-crud.test.ts
 */
import { connectDB, disconnectDB } from '../config/db'
import { Task } from '../models/Task'
import { User } from '../models/User'
import { Notification } from '../models/misc'
import { sweepReminders } from '../jobs/overdue'

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
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`) }

async function main() {
  console.log(`\nTask delete + bulk + reminder test → ${BASE}\n${'─'.repeat(60)}`)
  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken
  const branchId = (await call('GET', '/branches')).json.data?.[0]?._id
  const tag = Date.now()
  const aId = (await call('POST', '/employees', { fullName: 'CRUD A', email: `crud.a.${tag}@gdc.com`, password: 'Test@12345', role: 'employee', branchId })).json.data._id
  const bId = (await call('POST', '/employees', { fullName: 'CRUD B', email: `crud.b.${tag}@gdc.com`, password: 'Test@12345', role: 'employee', branchId })).json.data._id

  // ---- DELETE ----
  const delId = (await call('POST', '/tasks', { title: `CRUD del ${tag}`, assigneeId: aId })).json.data._id
  const d1 = await call('DELETE', `/tasks/${delId}`)
  check('soft-delete returns 200', d1.status === 200 && d1.json.data?.deleted === true)
  const listAfter = (await call('GET', '/tasks?limit=200')).json.data || []
  check('deleted task no longer listed', !listAfter.some((t: any) => t._id === delId))

  // ---- BULK move ----
  const t1 = (await call('POST', '/tasks', { title: `CRUD m1 ${tag}`, assigneeId: aId })).json.data._id
  const t2 = (await call('POST', '/tasks', { title: `CRUD m2 ${tag}`, assigneeId: aId })).json.data._id
  const bm = await call('POST', '/tasks/bulk', { ids: [t1, t2], action: 'move', status: 'inprogress' })
  check('bulk move affects 2', bm.json.data?.affected === 2, `affected=${bm.json.data?.affected}`)

  // ---- BULK reassign ----
  const br = await call('POST', '/tasks/bulk', { ids: [t1, t2], action: 'reassign', assigneeId: bId })
  check('bulk reassign affects 2', br.json.data?.affected === 2)
  const bList = (await call('GET', `/tasks?assignee=${bId}`)).json.data || []
  check('reassigned tasks now under new assignee', bList.some((t: any) => t._id === t1) && bList.some((t: any) => t._id === t2))

  // ---- BULK delete ----
  const bd = await call('POST', '/tasks/bulk', { ids: [t1, t2], action: 'delete' })
  check('bulk delete affects 2', bd.json.data?.affected === 2)

  // ---- deadline reminder (T-24h) ----
  await connectDB()
  const soon = new Date(Date.now() + 3 * 60 * 60_000) // due in 3h
  const remId = (await Task.create({ title: `CRUD rem ${tag}`, status: 'todo', dueAt: soon, assigneeId: aId, branchId })).id
  const n1 = await sweepReminders()
  check('reminder sweep notified ≥1', n1 >= 1, `n=${n1}`)
  const rem = await Task.findById(remId).lean()
  check('reminderSentAt stamped', !!rem?.reminderSentAt)
  const n2 = await sweepReminders()
  const remNote = await Notification.countDocuments({ userId: aId, type: 'task.reminder' })
  check('reminder is not sent twice', remNote === 1, `count=${remNote} secondSweep=${n2}`)

  // ---- cleanup ----
  await Task.deleteMany({ _id: { $in: [delId, t1, t2, remId] } })
  await Notification.deleteMany({ userId: { $in: [aId, bId] } })
  await User.deleteMany({ _id: { $in: [aId, bId] } })
  await disconnectDB()
  console.log(`${'─'.repeat(60)}\n${pass} passed, ${fail} failed · test docs cleaned up\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
