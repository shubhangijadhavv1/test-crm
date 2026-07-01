import { Router } from 'express'
import { z } from 'zod'
import { QaProcess, ChecklistTemplate, ChecklistPoint } from '../models/qa'
import { Project } from '../models/Project'
import { Task } from '../models/Task'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole, branchFilter } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { notify } from '../utils/notify'

const router = Router()
router.use(requireAuth)

const DEFAULT_STAGE1 = ['SEO meta tags & schema', 'Responsive breakpoints', 'Forms & validation', 'Cross-browser render', 'Page speed < 2.5s', 'Broken links scan', 'Image alt text']
const DEFAULT_STAGE2 = ['Security headers & SSL', 'Accessibility WCAG AA', 'Content proofreading', 'Final UX walkthrough']

function progressOf(items: { checked?: boolean }[]): number {
  if (!items.length) return 0
  return Math.round((items.filter(i => i.checked).length / items.length) * 100)
}

/** Create a linked Task for a checklist stage so it appears on the assignee's board (Blueprint D1.2). Idempotent. */
async function ensureChecklistTask(opts: { qaId: unknown; stage: 1 | 2; assigneeId: unknown; assignerId: unknown; projectId: unknown; projectName?: string; branchId?: unknown }) {
  if (!opts.assigneeId) return
  const title = `Checklist ${opts.stage} — ${opts.projectName || 'project'}`
  const existing = await Task.findOne({ linkedQaId: opts.qaId, title, isDeleted: false })
  if (existing) return existing
  return Task.create({
    title, source: 'checklist', linkedQaId: opts.qaId,
    projectId: opts.projectId, projectName: opts.projectName,
    assigneeId: opts.assigneeId, assignerId: opts.assignerId,
    priority: 'high', difficulty: 3, status: 'todo',
    timer: { running: false, accumulatedSeconds: 0 }, branchId: opts.branchId,
  })
}

/** Mark a stage's linked task as Done when the checklist is complete. */
async function completeChecklistTask(qaId: unknown, stage: 1 | 2, projectName?: string) {
  const title = `Checklist ${stage} — ${projectName || 'project'}`
  await Task.findOneAndUpdate({ linkedQaId: qaId, title, isDeleted: false }, { status: 'done', completedAt: new Date(), 'timer.running': false })
}

/** Resolve checklist items for a project from its category/subcategory points (fallback to defaults). */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function seedItemsFor(project: any): Promise<{ c1items: { text: string }[]; c2items: { text: string }[] }> {
  let c1items = DEFAULT_STAGE1.map(t => ({ text: t }))
  let c2items = DEFAULT_STAGE2.map(t => ({ text: t }))
  if (project?.categoryId) {
    const points = await ChecklistPoint.find({
      isActive: true, isDeleted: false, categoryId: project.categoryId,
      $or: [{ subCategoryId: project.subCategoryId || null }, { subCategoryId: null }, { subCategoryId: { $exists: false } }],
    }).sort({ order: 1, createdAt: 1 }).lean()
    if (points.length) {
      const c1 = points.filter(p => p.appliesTo === 'both' || p.appliesTo === 'c1').map(p => ({ text: p.text }))
      const c2 = points.filter(p => p.appliesTo === 'both' || p.appliesTo === 'c2').map(p => ({ text: p.text }))
      if (c1.length) c1items = c1
      if (c2.length) c2items = c2
    }
  }
  return { c1items, c2items }
}

/** Create the QA process for a project if it doesn't exist (called when status → qa).
 *  Both checklists start at 0%. Checklist 1 is assigned to the developer (owner) and a
 *  linked task is created so it appears on their board. */
export async function ensureQaProcess(projectId: string, branchId: string | null) {
  const existing = await QaProcess.findOne({ projectId })
  if (existing) return existing
  const project = await Project.findById(projectId).lean()
  const { c1items, c2items } = await seedItemsFor(project)

  const qa = await QaProcess.create({
    projectId,
    branchId: branchId || undefined,
    stage1: { reviewerId: project?.ownerId, status: 'inprogress', items: c1items, progress: 0 },
    stage2: { status: 'notstarted', items: c2items, progress: 0 },
    state: 'stage1',
  })
  if (project?.ownerId) {
    await ensureChecklistTask({ qaId: qa._id, stage: 1, assigneeId: project.ownerId, assignerId: project.createdBy || project.ownerId, projectId, projectName: project.name, branchId: project.branchId })
  }
  return qa
}

// ----- Checklist templates -----
router.get('/checklist-templates', asyncHandler(async (_req, res) => {
  ok(res, await ChecklistTemplate.find({ isDeleted: false }).lean())
}))
router.post('/checklist-templates', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const doc = await ChecklistTemplate.create({ ...req.body, createdBy: req.user!.id })
  created(res, doc)
}))
router.post('/checklist-templates/:id/items', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const doc = await ChecklistTemplate.findByIdAndUpdate(
    req.params.id,
    { $push: { items: { text: req.body.text, appliesTo: req.body.appliesTo || 'both' } } },
    { new: true }
  )
  if (!doc) throw ApiError.notFound('Template not found')
  ok(res, doc)
}))

// ----- Checklist points (category/subcategory-scoped) -----
// GET /checklist-points?categoryId= — list points, newest grouping done client-side
router.get('/checklist-points', asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { isDeleted: false }
  if (req.query.categoryId) filter.categoryId = req.query.categoryId
  if (req.query.subCategoryId) filter.subCategoryId = req.query.subCategoryId
  const rows = await ChecklistPoint.find(filter)
    .populate('categoryId', 'name').populate('subCategoryId', 'name')
    .sort({ createdAt: 1 }).lean()
  ok(res, rows)
}))

// POST /checklist-points/bulk — { categoryId, subCategoryId?, appliesTo, texts: [] }
const bulkBody = z.object({
  categoryId: z.string(),
  subCategoryId: z.string().optional().nullable(),
  appliesTo: z.enum(['both', 'c1', 'c2']).default('both'),
  texts: z.array(z.string().min(1)).min(1),
})
router.post('/checklist-points/bulk', requireRole('superadmin', 'admin'), validate(bulkBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof bulkBody>
  const base = await ChecklistPoint.countDocuments({ categoryId: b.categoryId })
  const docs = await ChecklistPoint.insertMany(
    b.texts.map((text, i) => ({
      categoryId: b.categoryId, subCategoryId: b.subCategoryId || undefined,
      text: text.trim(), appliesTo: b.appliesTo, order: base + i, createdBy: req.user!.id,
    }))
  )
  await audit(req.user, 'checklist.points.add', 'ChecklistPoint', b.categoryId, { after: { count: docs.length, appliesTo: b.appliesTo } })
  created(res, docs)
}))

router.delete('/checklist-points/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const doc = await ChecklistPoint.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true })
  if (!doc) throw ApiError.notFound('Checklist point not found')
  ok(res, { deleted: true })
}))

// ----- Checklist templates (legacy) -----
// ----- QA register -----
router.get('/qa', asyncHandler(async (req, res) => {
  // Branch-scoped: non-super-admins only see their own branch's QA (fail-closed if no branch).
  const filter: Record<string, unknown> = { isDeleted: false, ...branchFilter(req) }
  if (req.query.state) filter.state = req.query.state
  const rows = await QaProcess.find(filter)
    .populate({ path: 'projectId', select: 'name url type categoryId', populate: { path: 'categoryId', select: 'name' } })
    .populate('stage1.reviewerId', 'fullName')
    .populate('stage2.reviewerId', 'fullName')
    .lean()
  ok(res, rows)
}))

router.get('/qa/:id', asyncHandler(async (req, res) => {
  const doc = await QaProcess.findById(req.params.id).populate('projectId', 'name url').lean()
  if (!doc) throw ApiError.notFound('QA process not found')
  // Branch authority: non-super-admins can only read their own branch's QA.
  if (req.user!.role !== 'superadmin' && req.user!.branchId && String(doc.branchId) !== String(req.user!.branchId)) {
    throw ApiError.forbidden('Not permitted')
  }
  ok(res, doc)
}))

// GET /projects/:id/qa — a project + its QA process (or null) for the QA workflow screen.
// Re-syncs any checklist that hasn't been started yet (progress 0) from the latest
// category/subcategory template points, so newly added points always show.
router.get('/projects/:id/qa', asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, isDeleted: false })
    .select('name url type status ownerId categoryId subCategoryId').populate('ownerId', 'fullName').lean()
  if (!project) throw ApiError.notFound('Project not found')

  const doc = await QaProcess.findOne({ projectId: req.params.id })
  if (doc) {
    const { c1items, c2items } = await seedItemsFor(project)
    let changed = false
    const sig = (items: any[]) => (items || []).map((i) => i.text).join('|')
    if ((doc.stage1?.progress || 0) === 0 && sig(doc.stage1!.items) !== sig(c1items)) { doc.stage1!.items = c1items as never; changed = true }
    if ((doc.stage2?.progress || 0) === 0 && sig(doc.stage2!.items) !== sig(c2items)) { doc.stage2!.items = c2items as never; changed = true }
    if (changed) await doc.save()
  }

  const qa = await QaProcess.findOne({ projectId: req.params.id })
    .populate('stage1.reviewerId', 'fullName')
    .populate('stage2.reviewerId', 'fullName')
    .lean()
  ok(res, { project, qa: qa || null })
}))

// POST /projects/:id/qa — start QA explicitly
router.post('/projects/:id/qa', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id)
  if (!project) throw ApiError.notFound('Project not found')
  if (project.type === 'demo') throw ApiError.badRequest('QA is only required for live projects — demo projects skip QA')
  if (!project.ownerId) throw ApiError.badRequest('Assign an owner before starting QA')
  const qa = await ensureQaProcess(String(project._id), project.branchId ? String(project.branchId) : null)
  created(res, qa)
}))

const itemsBody = z.object({ items: z.array(z.object({ index: z.number(), checked: z.boolean(), status: z.enum(['pending', 'pass', 'fail', 'na']).optional(), failComment: z.string().optional() })) })

// Strict: ONLY the assigned reviewer of a stage may tick it — no cross-editing, no admin override.
// (Checklist 1 = the developer/owner; Checklist 2 = the independent reviewer.)
/* eslint-disable @typescript-eslint/no-explicit-any */
function canEditStage(user: { id: string; role: string } | undefined, qa: any, stage: 1 | 2): boolean {
  if (!user) return false
  const reviewer = stage === 1 ? qa.stage1?.reviewerId : qa.stage2?.reviewerId
  return !!reviewer && String(reviewer) === user.id
}

// PATCH /qa/:id/stage1/items
router.patch('/qa/:id/stage1/items', validate(itemsBody), asyncHandler(async (req, res) => {
  const qa = await QaProcess.findById(req.params.id)
  if (!qa) throw ApiError.notFound('QA process not found')
  if (!canEditStage(req.user, qa, 1)) throw ApiError.forbidden('Only the assigned developer can complete Checklist 1')
  const stage = qa.stage1!
  for (const u of (req.body as z.infer<typeof itemsBody>).items) {
    const item = stage.items[u.index]
    if (!item) continue
    item.checked = u.checked
    item.checkedAt = u.checked ? new Date() : undefined as never
    if (u.status) item.status = u.status as never
  }
  stage.progress = progressOf(stage.items)
  stage.status = stage.progress === 100 ? 'done' : 'inprogress'
  if (stage.progress === 100) {
    stage.completedAt = new Date()
    qa.state = 'stage2_ready' as never
    const proj = await Project.findById(qa.projectId).select('name').lean()
    await completeChecklistTask(qa._id, 1, proj?.name) // checklist 1 task → Done
  } else {
    qa.state = 'stage1' as never
  }
  await qa.save()
  await audit(req.user, 'qa.stage1.tick', 'QaProcess', qa._id, { after: { progress: stage.progress } })
  ok(res, qa)
}))

// POST /qa/:id/stage2/assign — gated: stage1=100 and reviewer ≠ developer
const assignBody = z.object({ reviewerId: z.string() })
router.post('/qa/:id/stage2/assign', validate(assignBody), asyncHandler(async (req, res) => {
  const qa = await QaProcess.findById(req.params.id)
  if (!qa) throw ApiError.notFound('QA process not found')
  if ((qa.stage1?.progress || 0) !== 100) throw ApiError.badRequest('Checklist 1 must reach 100% before assigning Checklist 2')
  const { reviewerId } = req.body as z.infer<typeof assignBody>
  if (String(qa.stage1?.reviewerId) === reviewerId) throw ApiError.badRequest('Checklist 2 reviewer must be different from the developer')
  qa.stage2!.reviewerId = reviewerId as never
  qa.stage2!.status = 'inprogress'
  qa.state = 'stage2_inprogress' as never
  await qa.save()
  // Linked task so Checklist 2 appears on the reviewer's Task Board.
  const proj = await Project.findById(qa.projectId).select('name branchId').lean()
  await ensureChecklistTask({ qaId: qa._id, stage: 2, assigneeId: reviewerId, assignerId: req.user!.id, projectId: qa.projectId, projectName: proj?.name, branchId: proj?.branchId })
  await notify(reviewerId, { type: 'qa.stage2_assigned', title: 'Checklist 2 assigned', body: `Independent QA review for ${proj?.name || 'a project'}`, color: 'brand', link: '/checklists' })
  await audit(req.user, 'qa.stage2.assign', 'QaProcess', qa._id, { after: { reviewerId } })
  ok(res, qa)
}))

// PATCH /qa/:id/stage2/items
router.patch('/qa/:id/stage2/items', validate(itemsBody), asyncHandler(async (req, res) => {
  const qa = await QaProcess.findById(req.params.id)
  if (!qa) throw ApiError.notFound('QA process not found')
  if ((qa.stage1?.progress || 0) !== 100) throw ApiError.badRequest('Checklist 1 is not complete')
  if (!canEditStage(req.user, qa, 2)) throw ApiError.forbidden('Only the assigned Checklist 2 reviewer can complete it — the developer cannot')
  const stage = qa.stage2!
  for (const u of (req.body as z.infer<typeof itemsBody>).items) {
    const item = stage.items[u.index]
    if (!item) continue
    item.checked = u.checked
    if (u.status) item.status = u.status as never
  }
  stage.progress = progressOf(stage.items)
  if (stage.progress === 100) {
    // Both checklists complete → QA passed → live project auto-completes.
    stage.status = 'done'
    stage.completedAt = new Date()
    qa.state = 'passed' as never
    const proj = await Project.findByIdAndUpdate(qa.projectId, { qaProgress: 100, status: 'completed', completedAt: new Date() }, { new: true }).select('name').lean()
    await completeChecklistTask(qa._id, 2, proj?.name) // checklist 2 task → Done
  } else {
    stage.status = 'inprogress'
    // QA reopened/incomplete → ensure project isn't marked completed
    await Project.findByIdAndUpdate(qa.projectId, { qaProgress: stage.progress })
  }
  await qa.save()
  ok(res, qa)
}))

export default router
