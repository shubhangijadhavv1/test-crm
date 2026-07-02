/**
 * Screenshot multipart upload + static serving test, self-cleaning.
 *   npx tsx src/audit/agent-screenshot.test.ts
 */
import fs from 'fs'
import path from 'path'
import { connectDB, disconnectDB } from '../config/db'
import { Attendance } from '../models/Attendance'
import { ActivityTick, Screenshot } from '../models/ActivityTick'
import { User } from '../models/User'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
const ROOT = BASE.replace(/\/api\/v1\/?$/, '')
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com'
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345'
let sa = ''
let pass = 0, fail = 0
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m: string, p: string, body?: unknown, tok = sa): Promise<{ status: number; json: any }> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++;  }
// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function main() {

  sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken
  const branchId = (await call('GET', '/branches')).json.data?.[0]?._id
  const tag = Date.now()
  const email = `agentshot.${tag}@gdc.com`
  const empId = (await call('POST', '/employees', { fullName: 'Agent Shot', email, password: 'Test@12345', role: 'employee', branchId })).json.data._id
  const tok = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).json.data.accessToken

  // multipart upload
  const fd = new FormData()
  fd.append('shot', new Blob([PNG], { type: 'image/png' }), 'shot.png')
  fd.append('blurred', 'true')
  const up = await fetch(BASE + '/agent/screenshot/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })
  const upJson: any = await up.json().catch(() => ({}))
  check('upload returns 201 + url', up.status === 201 && typeof upJson.data?.url === 'string' && upJson.data.blurred === true, `status=${up.status}`)
  const url: string = upJson.data?.url || ''
  check('url points under /uploads/screenshots', url.startsWith('/uploads/screenshots/'))

  // static serving returns the bytes
  const fileRes = await fetch(ROOT + url)
  const bytes = Buffer.from(await fileRes.arrayBuffer())
  check('static serve returns the PNG bytes', fileRes.status === 200 && bytes.length === PNG.length, `len=${bytes.length}/${PNG.length}`)

  // appears in the admin screenshots list
  const list = (await call('GET', `/agent/screenshots?userId=${empId}`)).json.data || []
  check('screenshot appears in admin list', list.some((s: any) => s.url === url))

  // reject non-image
  const bad = new FormData()
  bad.append('shot', new Blob([Buffer.from('hi')], { type: 'text/plain' }), 'x.txt')
  const badRes = await fetch(BASE + '/agent/screenshot/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: bad })
  check('non-image rejected (no file → 400)', badRes.status === 400, `status=${badRes.status}`)

  // delete the screenshot (admin) → removed from list + file gone
  const shotId = list.find((s: any) => s.url === url)?._id
  const delRes = await call('DELETE', `/agent/screenshots/${shotId}`)
  check('admin can delete screenshot', delRes.status === 200 && delRes.json.data?.deleted === true)
  const list2 = (await call('GET', `/agent/screenshots?userId=${empId}`)).json.data || []
  check('deleted screenshot no longer listed', !list2.some((s: any) => s._id === shotId))
  check('deleted file removed from disk', !fs.existsSync(path.join(process.cwd(), url.replace(/^\//, ''))))

  // bulk delete: upload two, then remove both at once
  const up2 = async () => { const f = new FormData(); f.append('shot', new Blob([PNG], { type: 'image/png' }), 's.png'); const r = await fetch(BASE + '/agent/screenshot/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: f }); return ((await r.json()) as any).data._id }
  const a = await up2(), b = await up2()
  const bulk = await call('POST', '/agent/screenshots/bulk-delete', { ids: [a, b] })
  check('bulk delete removes 2', bulk.json.data?.deleted === 2, `deleted=${bulk.json.data?.deleted}`)
  const list3 = (await call('GET', `/agent/screenshots?userId=${empId}`)).json.data || []
  check('bulk-deleted screenshots gone from list', !list3.some((s: any) => s._id === a || s._id === b))

  // ---- cleanup ----
  await connectDB()
  const att = await Attendance.findOne({ userId: empId })
  const filePath = path.join(process.cwd(), url.replace(/^\//, ''))
  try { fs.unlinkSync(filePath) } catch { /* ignore */ }
  await Screenshot.deleteMany({ userId: empId })
  await ActivityTick.deleteMany({ userId: empId })
  await Attendance.deleteMany({ _id: att?._id })
  await User.deleteMany({ _id: empId })
  await disconnectDB()

  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
