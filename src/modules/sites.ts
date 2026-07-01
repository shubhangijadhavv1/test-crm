import { Router } from 'express'
import { z } from 'zod'
import { SiteMonitor, SiteCheckLog, CrawlJob, CrawlPage } from '../models/monitor'
import { runCrawl } from '../services/crawler'
import { Project } from '../models/Project'
import { ok, created, asyncHandler, parsePaging } from '../utils/http'
import { safeRegex } from '../utils/regex'
import { validate } from '../middleware/validate'
import { requireAuth } from '../middleware/auth'
import { requireRole, branchFilter } from '../middleware/rbac'
import { ApiError } from '../utils/ApiError'
import { audit } from '../utils/audit'
import { checkAvailability, analyzePage, withImageSizes } from '../services/siteAnalyze'
import { notify } from '../utils/notify'

const router = Router()
router.use(requireAuth)

/** Normalise a URL (add https:// if missing). */
function normUrl(u: string): string | null {
  if (!u) return null
  let s = u.trim()
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try { return new URL(s).toString().replace(/\/$/, '') } catch { return null }
}

/**
 * Check one monitor and persist. `deep` also runs the full page analysis (SEO/security/tech);
 * the periodic job uses deep=false (fast uptime check), manual scans use deep=true.
 */
export async function runScan(monitor: InstanceType<typeof SiteMonitor>, deep = true) {
  const avail = await checkAvailability(monitor.url)
  const prevStatus = monitor.lastStatus
  monitor.checks = (monitor.checks || 0) + 1
  if (avail.up) monitor.upChecks = (monitor.upChecks || 0) + 1
  monitor.lastStatus = (avail.up ? 'up' : 'down') as never
  monitor.lastStatusCode = avail.statusCode
  monitor.lastResponseMs = avail.responseMs
  monitor.lastError = avail.error
  monitor.https = avail.https
  monitor.lastCheckedAt = new Date()
  if (avail.up) monitor.downSince = undefined as never
  else if (!monitor.downSince) monitor.downSince = new Date()

  // Deep analysis only when reachable and requested.
  if (avail.up && deep) {
    const a = await analyzePage(monitor.url)
    monitor.scannedAt = new Date()
    monitor.tech = a.tech as never
    monitor.scores = a.scores as never
    monitor.seo = a.seo as never
    monitor.counts = a.counts as never
    monitor.security = a.security as never
    monitor.issues = a.issues as never
    monitor.links = (a.links || { internal: [], external: [] }) as never
    monitor.images = (await withImageSizes(a.images || [])) as never // HEAD each image for byte size
  }
  await monitor.save()
  await SiteCheckLog.create({ monitorId: monitor._id, up: avail.up, statusCode: avail.statusCode, responseMs: avail.responseMs, error: avail.error })

  // Alert admins of this branch on a DOWN transition (and recovery).
  if (prevStatus === 'up' && !avail.up) {
    await notifyBranchAdmins(monitor, `${monitor.label || monitor.url} is down — ${avail.error || 'unreachable'}`, 'bad')
  } else if (prevStatus === 'down' && avail.up) {
    await notifyBranchAdmins(monitor, `${monitor.label || monitor.url} is back online`, 'ok')
  }
  return monitor
}

async function notifyBranchAdmins(monitor: InstanceType<typeof SiteMonitor>, body: string, color: string) {
  const { User } = await import('../models/User')
  const filter: Record<string, unknown> = { isDeleted: false, role: { $in: ['admin', 'superadmin'] } }
  if (monitor.branchId) filter.$or = [{ branchId: monitor.branchId }, { role: 'superadmin' }]
  const admins = await User.find(filter).select('_id').lean()
  await Promise.all(admins.map(a => notify(String(a._id), { type: 'site.status', title: 'Website status', body, color, link: '/site-monitoring' })))
}

// GET /sites — list monitors (admin/super admin, branch-scoped) with search, filter & paging
router.get('/', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>)
  const filter: Record<string, unknown> = { isDeleted: false, ...branchFilter(req) }
  if (req.query.status) filter.lastStatus = req.query.status
  if (req.query.q) { const rx = safeRegex(req.query.q); filter.$or = [{ url: rx }, { label: rx }] }
  const [rows, total] = await Promise.all([
    SiteMonitor.find(filter).populate('projectId', 'name type').sort({ lastStatus: 1, url: 1 }).skip(skip).limit(limit).lean(),
    SiteMonitor.countDocuments(filter),
  ])
  ok(res, rows.map(r => ({ ...r, uptimePct: r.checks ? Math.round((r.upChecks / r.checks) * 100) : null })), { page, limit, total })
}))

// GET /sites/dashboard — aggregate stats
router.get('/dashboard', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = { isDeleted: false, ...branchFilter(req) }
  const rows = await SiteMonitor.find(filter).lean()
  const avg = (f: (r: typeof rows[number]) => number) => rows.length ? Math.round(rows.reduce((n, r) => n + f(r), 0) / rows.length) : 0
  ok(res, {
    total: rows.length,
    live: rows.filter(r => r.lastStatus === 'up').length,
    down: rows.filter(r => r.lastStatus === 'down').length,
    unknown: rows.filter(r => r.lastStatus === 'unknown').length,
    avgHealth: avg(r => r.scores?.health || 0),
    avgSeo: avg(r => r.scores?.seo || 0),
    avgSecurity: avg(r => r.scores?.security || 0),
    avgPerformance: avg(r => r.scores?.performance || 0),
    avgResponseMs: avg(r => r.lastResponseMs || 0),
    totalIssues: rows.reduce((n, r) => n + (r.issues?.length || 0), 0),
    totalPagesScanned: rows.filter(r => r.scannedAt).length,
  })
}))

// POST /sites/sync — register a monitor for every LIVE project URL that doesn't have one
// (demo/sandbox projects are intentionally excluded).
router.post('/sync', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const projects = await Project.find({ isDeleted: false, type: 'live', url: { $nin: [null, ''] } }).select('name url branchId').lean()
  let added = 0
  for (const p of projects) {
    const url = normUrl(p.url as string)
    if (!url) continue
    const exists = await SiteMonitor.findOne({ url, isDeleted: false })
    if (exists) continue
    await SiteMonitor.create({ url, label: p.name, projectId: p._id, branchId: p.branchId, createdBy: req.user!.id })
    added++
  }
  await audit(req.user, 'site.sync', 'SiteMonitor', null, { after: { added } })
  ok(res, { added, totalProjects: projects.length })
}))

// POST /sites — add a monitor manually
const addBody = z.object({ url: z.string().min(3), label: z.string().optional(), projectId: z.string().optional() })
router.post('/', requireRole('superadmin', 'admin'), validate(addBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof addBody>
  const url = normUrl(b.url)
  if (!url) throw ApiError.badRequest('Invalid URL')
  if (await SiteMonitor.findOne({ url, isDeleted: false })) throw ApiError.conflict('This URL is already monitored')
  const doc = await SiteMonitor.create({ url, label: b.label, projectId: b.projectId, branchId: req.user!.branchId, createdBy: req.user!.id })
  await audit(req.user, 'site.create', 'SiteMonitor', doc._id)
  created(res, doc)
}))

// PATCH /sites/:id — edit label / url / enabled
const editBody = z.object({ label: z.string().optional(), url: z.string().min(3).optional(), enabled: z.boolean().optional() }).strict()
router.patch('/:id', requireRole('superadmin', 'admin'), validate(editBody), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof editBody>
  const m = await SiteMonitor.findOne({ _id: req.params.id, isDeleted: false })
  if (!m) throw ApiError.notFound('Monitor not found')
  if (b.label !== undefined) m.label = b.label
  if (b.enabled !== undefined) m.enabled = b.enabled
  if (b.url) {
    const url = normUrl(b.url)
    if (!url) throw ApiError.badRequest('Invalid URL')
    const dup = await SiteMonitor.findOne({ url, isDeleted: false, _id: { $ne: m._id } })
    if (dup) throw ApiError.conflict('This URL is already monitored')
    m.url = url
  }
  m.updatedBy = req.user!.id as never
  await m.save()
  await audit(req.user, 'site.update', 'SiteMonitor', m._id)
  ok(res, m)
}))

// POST /sites/:id/scan — run a full scan now
router.post('/:id/scan', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const m = await SiteMonitor.findOne({ _id: req.params.id, isDeleted: false })
  if (!m) throw ApiError.notFound('Monitor not found')
  await runScan(m)
  ok(res, m)
}))

// GET /sites/:id — detail + recent availability history
router.get('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const m = await SiteMonitor.findOne({ _id: req.params.id, isDeleted: false }).populate('projectId', 'name type').lean()
  if (!m) throw ApiError.notFound('Monitor not found')
  const history = await SiteCheckLog.find({ monitorId: m._id }).sort({ ts: -1 }).limit(100).lean()
  const lastCrawl = await CrawlJob.findOne({ siteId: m._id, status: 'done' }).sort({ createdAt: -1 }).select('pages okPages brokenPages totalInternalLinks totalExternalLinks finishedAt').lean()
  ok(res, { ...m, uptimePct: m.checks ? Math.round((m.upChecks / m.checks) * 100) : null, history, lastCrawl })
}))

// POST /sites/:id/crawl — start a Playwright crawl (async). Returns the job immediately.
const crawlBody = z.object({ maxPages: z.number().int().min(1).max(300).optional() })
router.post('/:id/crawl', requireRole('superadmin', 'admin'), validate(crawlBody), asyncHandler(async (req, res) => {
  const m = await SiteMonitor.findOne({ _id: req.params.id, isDeleted: false })
  if (!m) throw ApiError.notFound('Monitor not found')
  const running = await CrawlJob.findOne({ siteId: m._id, status: 'running' }).lean()
  if (running) throw ApiError.conflict('A crawl is already running for this site')
  // Fire-and-forget; the client polls GET /:id/crawl for progress/results.
  runCrawl(String(m._id), { maxPages: (req.body as { maxPages?: number }).maxPages, createdBy: req.user!.id }).catch(() => {})
  await audit(req.user, 'site.crawl', 'SiteMonitor', m._id)
  ok(res, { started: true })
}))

// GET /sites/:id/crawl — latest crawl job + its pages
router.get('/:id/crawl', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const job = await CrawlJob.findOne({ siteId: req.params.id }).sort({ createdAt: -1 }).lean()
  if (!job) return ok(res, { job: null, pages: [] })
  const pages = await CrawlPage.find({ jobId: job._id }).sort({ depth: 1, url: 1 }).limit(500).lean()
  ok(res, { job, pages })
}))

// POST /sites/bulk-delete — remove many monitors at once
const bulkDelBody = z.object({ ids: z.array(z.string()).min(1) })
router.post('/bulk-delete', requireRole('superadmin', 'admin'), validate(bulkDelBody), asyncHandler(async (req, res) => {
  const { ids } = req.body as z.infer<typeof bulkDelBody>
  const r = await SiteMonitor.updateMany({ _id: { $in: ids }, isDeleted: false }, { isDeleted: true, updatedBy: req.user!.id })
  await audit(req.user, 'site.bulk_delete', 'SiteMonitor', null, { after: { count: r.modifiedCount } })
  ok(res, { deleted: r.modifiedCount })
}))

router.delete('/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const m = await SiteMonitor.findByIdAndUpdate(req.params.id, { isDeleted: true, updatedBy: req.user!.id })
  if (!m) throw ApiError.notFound('Monitor not found')
  await audit(req.user, 'site.delete', 'SiteMonitor', m._id)
  ok(res, { deleted: true })
}))

export default router
