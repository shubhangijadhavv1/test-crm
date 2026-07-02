/** Verifies that adding template points AFTER a project is in QA shows up when the
 *  workflow is opened (re-sync of unstarted checklists). Self-cleaning. */
import { connectDB, disconnectDB } from '../config/db'
import { Project } from '../models/Project'
import { QaProcess, ChecklistPoint } from '../models/qa'
import { Task } from '../models/Task'
import { Category } from '../models/catalog'

const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1'
let sa = ''; let pass = 0, fail = 0
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(sa ? { Authorization: `Bearer ${sa}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json().catch(() => ({}))
}
const check = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; }

async function main() {

  sa = (await call('POST', '/auth/login', { email: 'aarav@gdc.com', password: 'Admin@12345' })).data?.accessToken
  const shra = (await call('GET', '/employees?q=Shraddha')).data?.[0]?._id
  const catId = (await call('POST', '/categories', { name: 'ReSync Cat ' + Date.now() })).data._id

  // project enters QA BEFORE any points exist → defaults
  const projId = (await call('POST', '/projects', { type: 'live', name: 'ReSync Proj', categoryId: catId, ownerId: shra })).data._id
  await call('PATCH', `/projects/${projId}/status`, { status: 'development' })
  await call('PATCH', `/projects/${projId}/status`, { status: 'qa' })
  let qa = (await call('GET', `/projects/${projId}/qa`)).data.qa
  check('starts with default items (no points yet)', qa.stage1.items.some((i: any) => i.text === 'SEO meta tags & schema'))

  // add points AFTER it's in QA
  await call('POST', '/checklist-points/bulk', { categoryId: catId, appliesTo: 'both', texts: ['ReSync point A', 'ReSync point B'] })
  // re-open the workflow → unstarted checklists re-sync to the new points
  qa = (await call('GET', `/projects/${projId}/qa`)).data.qa
  const s1 = qa.stage1.items.map((i: any) => i.text)
  check('checklist re-synced to new template points on open', s1.includes('ReSync point A') && s1.includes('ReSync point B') && !s1.includes('SEO meta tags & schema'), s1.join(', '))

  // cleanup
  await connectDB()
  await Task.deleteMany({ linkedQaId: qa._id })
  await QaProcess.deleteMany({ projectId: projId })
  await Project.deleteMany({ _id: projId })
  await ChecklistPoint.deleteMany({ categoryId: catId })
  await Category.deleteMany({ _id: catId })
  await disconnectDB()

  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
