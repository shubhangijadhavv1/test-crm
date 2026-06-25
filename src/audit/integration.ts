/**
 * Module-by-module MongoDB integration audit.
 *
 * Exercises the live REST API (which is the only path to MongoDB) for every
 * module: reads data, and where applicable creates a record then reads it back
 * to prove it persisted. Prints a pass/fail report and writes
 * MODULE-INTEGRATION-AUDIT.md at the repo root.
 *
 * Usage:  (with the server running)  npm run audit:integration
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com'
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345'

let token = ''
type Result = { module: string; collection: string; checks: string[]; ok: boolean; note?: string }
const results: Result[] = []

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json: any = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function audit(module: string, collection: string, fn: () => Promise<string[]>) {
  try {
    const checks = await fn()
    results.push({ module, collection, checks, ok: true })
    console.log(`✅ ${module.padEnd(26)} [${collection}]  ${checks.join(' · ')}`)
  } catch (e) {
    results.push({ module, collection, checks: [], ok: false, note: (e as Error).message })
    console.log(`❌ ${module.padEnd(26)} [${collection}]  ${(e as Error).message}`)
  }
}

const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }

async function main() {
  console.log(`\nGDC CRM — MongoDB integration audit\nTarget: ${BASE}\n${'─'.repeat(70)}`)

  // Auth
  await audit('Authentication', 'users/sessions', async () => {
    const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })
    assert(login.status === 200 && login.json?.data?.accessToken, 'login failed')
    token = login.json.data.accessToken
    const me = await call('GET', '/auth/me')
    assert(me.json?.data?.email === EMAIL, 'me mismatch')
    return [`login ok`, `session persisted`, `me=${me.json.data.fullName}`]
  })

  // Dashboard (aggregation reads)
  await audit('Dashboard & Analytics', 'aggregation', async () => {
    const s = await call('GET', '/dashboard/summary')
    assert(s.json?.data?.stats, 'no summary')
    const inv = await call('GET', '/dashboard/inventory?type=live')
    assert(Array.isArray(inv.json?.data), 'no inventory')
    return [`summary widgets ok`, `inventory rows=${inv.json.data.length}`]
  })

  // Branches (create -> read back)
  await audit('Branch Management', 'branches', async () => {
    const name = 'Audit Branch ' + Date.now()
    const c = await call('POST', '/branches', { name, code: 'AUD' })
    assert(c.status === 201, 'create failed')
    const list = await call('GET', '/branches')
    assert(list.json.data.some((b: { name: string }) => b.name === name), 'not found after create')
    return [`created+read-back`, `count=${list.json.data.length}`]
  })

  // Catalog
  await audit('Catalog — Categories', 'categories/subcategories', async () => {
    const name = 'Audit Cat ' + Date.now()
    const c = await call('POST', '/categories', { name })
    assert(c.status === 201, 'create category failed')
    const id = c.json.data._id
    const sub = await call('POST', '/subcategories', { name: 'Audit Sub', categoryId: id })
    assert(sub.status === 201, 'create subcategory failed')
    const list = await call('GET', '/categories')
    const found = list.json.data.find((x: { _id: string }) => x._id === id)
    assert(found && found.subs.length >= 1, 'subcategory not linked')
    return [`category persisted`, `subcategory linked`]
  })
  await audit('Catalog — Website Types', 'websitetypes', async () => {
    const c = await call('POST', '/website-types', { name: 'AuditType' + Date.now() })
    assert(c.status === 201, 'create failed')
    const list = await call('GET', '/website-types')
    assert(list.json.data.some((t: { _id: string }) => t._id === c.json.data._id), 'not found')
    return [`created+read-back`]
  })
  await audit('Catalog — Servers', 'servers', async () => {
    const c = await call('POST', '/servers', { name: 'AUD-SRV-' + Date.now(), provider: 'Audit' })
    assert(c.status === 201, 'create failed')
    const list = await call('GET', '/servers')
    const f = list.json.data.find((s: { _id: string }) => s._id === c.json.data._id)
    assert(f && 'total' in f, 'server counts not computed')
    return [`created+read-back`, `live/demo counts present`]
  })

  // Employees
  let empId = ''
  await audit('Employee Management', 'users', async () => {
    const email = `audit.${Date.now()}@gdc.com`
    const c = await call('POST', '/employees', { fullName: 'Audit User', email, password: 'Welcome@123', role: 'employee' })
    assert(c.status === 201, 'create failed: ' + JSON.stringify(c.json.error))
    empId = c.json.data._id
    const g = await call('GET', `/employees/${empId}`)
    assert(g.json?.data?.email === email, 'not found after create')
    assert(g.json?.data?.stats, 'profile aggregation missing')
    return [`created+read-back`, `profile aggregates ok`]
  })

  // Projects (create -> status transition guarded)
  let projId = ''
  await audit('Project Management', 'projects', async () => {
    const c = await call('POST', '/projects', { type: 'live', name: 'Audit Project ' + Date.now(), priority: 'high', ownerId: empId })
    assert(c.status === 201, 'create failed')
    projId = c.json.data._id
    const bad = await call('PATCH', `/projects/${projId}/status`, { status: 'completed' })
    assert(bad.status >= 400, 'illegal transition was allowed!')
    const good = await call('PATCH', `/projects/${projId}/status`, { status: 'development' })
    assert(good.json?.data?.status === 'development', 'valid transition failed')
    return [`created+read-back`, `state machine enforced`]
  })

  // QA (entering qa creates process; gating enforced)
  await audit('QA & Checklists', 'qaprocesses', async () => {
    await call('PATCH', `/projects/${projId}/status`, { status: 'qa' })
    const list = await call('GET', '/qa')
    const qa = list.json.data.find((q: { projectId?: { _id: string } }) => q.projectId?._id === projId)
    assert(qa, 'qa process not created on entering QA')
    const assign = await call('POST', `/qa/${qa._id}/stage2/assign`, { reviewerId: empId })
    assert(assign.status >= 400, 'stage2 assign allowed before stage1=100!')
    return [`process auto-created`, `2-stage gate enforced`]
  })

  // Tasks (create -> move starts timer)
  await audit('Task Management', 'tasks', async () => {
    const c = await call('POST', '/tasks', { title: 'Audit Task ' + Date.now(), assigneeId: empId, priority: 'medium' })
    assert(c.status === 201, 'create failed')
    const id = c.json.data._id
    const mv = await call('PATCH', `/tasks/${id}/move`, { status: 'inprogress' })
    assert(mv.json?.data?.timer?.running === true, 'timer did not start')
    const bad = await call('PATCH', `/tasks/${id}/move`, { status: 'overdue' })
    assert(bad.status >= 400, 'manual overdue allowed!')
    return [`created+read-back`, `timer + overdue rule ok`]
  })

  // Attendance (punch -> totals persisted)
  await audit('Attendance', 'attendance', async () => {
    const p = await call('POST', '/attendance/punch', { action: 'in' })
    assert(p.status === 200, 'punch failed')
    const me = await call('GET', '/attendance/me')
    assert(Array.isArray(me.json?.data) && me.json.data.length >= 1, 'no attendance doc')
    return [`punch persisted`, `daily doc created`]
  })

  // Leave (apply -> appears in inbox)
  await audit('Leave Management', 'leaverequests/leavebalances', async () => {
    const c = await call('POST', '/leaves', { type: 'casual', fromDate: '2026-07-01', toDate: '2026-07-01', reason: 'audit' })
    assert(c.status === 201, 'apply failed')
    const inbox = await call('GET', '/leaves?status=pending')
    assert(inbox.json.data.some((l: { _id: string }) => l._id === c.json.data._id), 'not in inbox')
    const me = await call('GET', '/leaves/me')
    assert(me.json?.data?.balance, 'balance not initialised')
    return [`request persisted`, `balance initialised`]
  })

  // Notice Board (create -> read/ack)
  await audit('Notice Board', 'announcements/announcementreads', async () => {
    const c = await call('POST', '/announcements', { title: 'Audit Notice ' + Date.now(), body: 'x', priority: 'info', audience: { scope: 'all' } })
    assert(c.status === 201, 'create failed')
    const id = c.json.data._id
    await call('POST', `/announcements/${id}/read`)
    const list = await call('GET', '/announcements')
    const f = list.json.data.find((a: { _id: string }) => a._id === id)
    assert(f && f.read === true, 'read receipt not persisted')
    return [`published+read-back`, `read receipt persisted`]
  })

  // Notifications (created by side-effects above)
  await audit('Notifications', 'notifications', async () => {
    const list = await call('GET', '/notifications')
    assert(Array.isArray(list.json?.data), 'no notifications endpoint')
    return [`feed ok`, `count=${list.json.data.length}`]
  })

  // ---- report ----
  const pass = results.filter(r => r.ok).length
  const total = results.length
  console.log(`${'─'.repeat(70)}\n${pass}/${total} modules verified against MongoDB\n`)

  const md = [
    '# Module Integration Audit — MongoDB',
    '',
    `Run: ${new Date().toISOString()} · Target: \`${BASE}\``,
    `Result: **${pass}/${total} modules verified** (each created and/or read real documents through the API → MongoDB).`,
    '',
    '| # | Module | Collection(s) | Status | Checks |',
    '|---|--------|---------------|--------|--------|',
    ...results.map((r, i) => `| ${i + 1} | ${r.module} | \`${r.collection}\` | ${r.ok ? '✅ PASS' : '❌ FAIL'} | ${r.ok ? r.checks.join(' · ') : r.note} |`),
    '',
    '## Method',
    'The API is the only path to MongoDB, so each check calls the live REST endpoint and,',
    'where it mutates, **reads the record back** to prove it persisted. Business rules',
    '(project state machine, QA two-stage gate, task timer, manual-overdue block) are',
    'asserted to return the correct success/error — confirming the service layer and',
    'Mongoose models are wired correctly.',
    '',
    '## Not covered (full-blueprint scope, not in core build)',
    'Desktop monitoring agent + screenshots, BullMQ jobs, Redis cache, reports/exports,',
    'performance roll-ups, 2FA.',
    '',
  ].join('\n')

  const out = resolve(process.cwd(), '..', 'MODULE-INTEGRATION-AUDIT.md')
  try { writeFileSync(out, md); console.log(`Report written: ${out}`) }
  catch { writeFileSync(resolve(process.cwd(), 'MODULE-INTEGRATION-AUDIT.md'), md) }

  process.exit(pass === total ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
