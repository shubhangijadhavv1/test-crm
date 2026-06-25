/**
 * Optimistic concurrency test (If-Match/version → 409) on projects & tasks.
 *   npx tsx src/audit/concurrency.test.ts
 * Creates a throwaway project + task, then cleans up.
 */
import { connectDB, disconnectDB } from '../config/db'
import { Project } from '../models/Project'
import { Task } from '../models/Task'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com'
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345'
let sa = ''
let pass = 0, fail = 0
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sa}`, ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`) }

async function main() {
  console.log(`\nOptimistic concurrency test → ${BASE}\n${'─'.repeat(60)}`)
  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken

  // ---- Project ----
  const projId = (await call('POST', '/projects', { type: 'demo', name: 'Concurrency Test' })).json.data?._id
  const v0 = (await call('GET', `/projects/${projId}`)).json.data?.version
  check('project starts at version 0', v0 === 0, `v=${v0}`)

  const r1 = await call('PATCH', `/projects/${projId}`, { url: 'https://a' }, { 'If-Match': String(v0) })
  check('update with matching If-Match succeeds', r1.status === 200 && r1.json.data?.version === v0 + 1, `v=${r1.json.data?.version}`)

  const r2 = await call('PATCH', `/projects/${projId}`, { url: 'https://b' }, { 'If-Match': String(v0) })
  check('stale If-Match → 409 conflict', r2.status === 409, `status=${r2.status}`)

  const r3 = await call('PATCH', `/projects/${projId}`, { url: 'https://c' })
  check('no If-Match still works (back-compat)', r3.status === 200)

  // ---- Task ----
  const myId = (await call('GET', '/auth/me')).json.data?._id
  const taskId = (await call('POST', '/tasks', { title: 'Concurrency Task', assigneeId: myId, priority: 'medium' })).json.data?._id
  const tv0 = (await call('GET', `/tasks`)).json // tasks list; fetch version via list
  const task = (tv0.data || []).find((t: any) => t._id === taskId)
  const tver = task?.version ?? 0
  const t1 = await call('PATCH', `/tasks/${taskId}`, { description: 'x' }, { 'If-Match': String(tver) })
  check('task update with matching If-Match succeeds', t1.status === 200, `status=${t1.status} v=${t1.json.data?.version}`)
  const t2 = await call('PATCH', `/tasks/${taskId}`, { description: 'y' }, { 'If-Match': String(tver) })
  check('task stale If-Match → 409 conflict', t2.status === 409, `status=${t2.status}`)

  // ---- cleanup ----
  await connectDB()
  await Task.deleteMany({ _id: taskId })
  await Project.deleteMany({ _id: projId })
  await disconnectDB()
  console.log(`${'─'.repeat(60)}\n${pass} passed, ${fail} failed · test docs cleaned up\n`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
