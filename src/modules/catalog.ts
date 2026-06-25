import { Router } from 'express'
import { z } from 'zod'
import { Category, Subcategory, WebsiteType, ServerModel } from '../models/catalog'
import { Project } from '../models/Project'
import { ok, created, asyncHandler } from '../utils/http'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'

const router = Router()
router.use(requireAuth)

const writers = requireRole('superadmin', 'admin')

// ---------- Categories ----------
const categoryBody = z.object({ name: z.string().min(1), isActive: z.boolean().optional(), sortOrder: z.number().optional() })

router.get('/categories', asyncHandler(async (_req, res) => {
  const cats = await Category.find({ isDeleted: false }).sort({ sortOrder: 1, name: 1 }).lean()
  const subs = await Subcategory.find({ isDeleted: false }).lean()
  const withSubs = cats.map(c => ({ ...c, subs: subs.filter(s => String(s.categoryId) === String(c._id)) }))
  ok(res, withSubs)
}))

router.post('/categories', writers, validate(categoryBody), asyncHandler(async (req, res) => {
  const doc = await Category.create({ ...req.body, createdBy: req.user!.id })
  await audit(req.user, 'category.create', 'Category', doc._id, { after: doc })
  created(res, doc)
}))

router.patch('/categories/:id', writers, asyncHandler(async (req, res) => {
  const doc = await Category.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user!.id }, { new: true })
  if (!doc) throw ApiError.notFound('Category not found')
  await audit(req.user, 'category.update', 'Category', doc._id, { after: doc })
  ok(res, doc)
}))

router.delete('/categories/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const inUse = await Project.exists({ categoryId: req.params.id, isDeleted: false })
  if (inUse) throw ApiError.conflict('Category is in use by projects — disable it instead')
  const doc = await Category.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true })
  if (!doc) throw ApiError.notFound('Category not found')
  await audit(req.user, 'category.delete', 'Category', doc._id)
  ok(res, { deleted: true })
}))

// ---------- Subcategories ----------
const subBody = z.object({ name: z.string().min(1), categoryId: z.string(), sortOrder: z.number().optional() })

router.get('/subcategories', asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { isDeleted: false }
  if (req.query.categoryId) filter.categoryId = req.query.categoryId
  ok(res, await Subcategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean())
}))

router.post('/subcategories', writers, validate(subBody), asyncHandler(async (req, res) => {
  const parent = await Category.findOne({ _id: req.body.categoryId, isDeleted: false })
  if (!parent) throw ApiError.badRequest('Parent category does not exist')
  const doc = await Subcategory.create({ ...req.body, createdBy: req.user!.id })
  created(res, doc)
}))

// POST /subcategories/bulk { categoryId, names:[] } — add many at once (skips blanks & duplicates)
const bulkSubBody = z.object({ categoryId: z.string(), names: z.array(z.string()).min(1).max(200) })
router.post('/subcategories/bulk', writers, validate(bulkSubBody), asyncHandler(async (req, res) => {
  const { categoryId, names } = req.body as z.infer<typeof bulkSubBody>
  const parent = await Category.findOne({ _id: categoryId, isDeleted: false })
  if (!parent) throw ApiError.badRequest('Parent category does not exist')
  const existing = new Set((await Subcategory.find({ categoryId, isDeleted: false }).select('name').lean()).map(s => s.name.toLowerCase()))
  const clean = [...new Set(names.map(n => n.trim()).filter(Boolean))].filter(n => !existing.has(n.toLowerCase()))
  if (!clean.length) throw ApiError.badRequest('No new subcategories to add (all blank or already exist)')
  const docs = await Subcategory.insertMany(clean.map(name => ({ name, categoryId, createdBy: req.user!.id })))
  await audit(req.user, 'subcategory.bulk-create', 'Subcategory', categoryId, { after: { added: docs.length } })
  created(res, { added: docs.length, names: clean })
}))

router.delete('/subcategories/:id', writers, asyncHandler(async (req, res) => {
  const inUse = await Project.exists({ subCategoryId: req.params.id, isDeleted: false })
  if (inUse) throw ApiError.conflict('Subcategory is in use by projects — remove it from those projects first')
  const doc = await Subcategory.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true })
  if (!doc) throw ApiError.notFound('Subcategory not found')
  await audit(req.user, 'subcategory.delete', 'Subcategory', doc._id)
  ok(res, { deleted: true })
}))

// ---------- Website Types ----------
const typeBody = z.object({ name: z.string().min(1), isActive: z.boolean().optional() })

router.get('/website-types', asyncHandler(async (_req, res) => {
  ok(res, await WebsiteType.find({ isDeleted: false }).sort({ name: 1 }).lean())
}))
router.post('/website-types', writers, validate(typeBody), asyncHandler(async (req, res) => {
  const doc = await WebsiteType.create({ ...req.body, createdBy: req.user!.id })
  created(res, doc)
}))
router.patch('/website-types/:id', writers, asyncHandler(async (req, res) => {
  const doc = await WebsiteType.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!doc) throw ApiError.notFound('Website type not found')
  ok(res, doc)
}))

// ---------- Servers ----------
const serverBody = z.object({ name: z.string().min(1), provider: z.string().optional(), region: z.string().optional() })

router.get('/servers', asyncHandler(async (_req, res) => {
  const servers = await ServerModel.find({ isDeleted: false }).sort({ name: 1 }).lean()
  // attach live/demo/total counts
  const counts = await Project.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: { serverId: '$serverId', type: '$type' }, n: { $sum: 1 } } },
  ])
  const byServer: Record<string, { live: number; demo: number }> = {}
  for (const c of counts) {
    const sid = String(c._id.serverId)
    byServer[sid] = byServer[sid] || { live: 0, demo: 0 }
    byServer[sid][c._id.type as 'live' | 'demo'] = c.n
  }
  ok(res, servers.map(s => {
    const c = byServer[String(s._id)] || { live: 0, demo: 0 }
    return { ...s, live: c.live, demo: c.demo, total: c.live + c.demo }
  }))
}))
router.post('/servers', writers, validate(serverBody), asyncHandler(async (req, res) => {
  const doc = await ServerModel.create({ ...req.body, createdBy: req.user!.id })
  created(res, doc)
}))
router.get('/servers/:id/sites', asyncHandler(async (req, res) => {
  ok(res, await Project.find({ serverId: req.params.id, isDeleted: false }).select('name url type status').lean())
}))

export default router
