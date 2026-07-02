"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScan = runScan;
const express_1 = require("express");
const zod_1 = require("zod");
const monitor_1 = require("../models/monitor");
const crawler_1 = require("../services/crawler");
const Project_1 = require("../models/Project");
const http_1 = require("../utils/http");
const regex_1 = require("../utils/regex");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const siteAnalyze_1 = require("../services/siteAnalyze");
const notify_1 = require("../utils/notify");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
/** Normalise a URL (add https:// if missing). */
function normUrl(u) {
    if (!u)
        return null;
    let s = u.trim();
    if (!/^https?:\/\//i.test(s))
        s = 'https://' + s;
    try {
        return new URL(s).toString().replace(/\/$/, '');
    }
    catch {
        return null;
    }
}
/**
 * Check one monitor and persist. `deep` also runs the full page analysis (SEO/security/tech);
 * the periodic job uses deep=false (fast uptime check), manual scans use deep=true.
 */
async function runScan(monitor, deep = true) {
    const avail = await (0, siteAnalyze_1.checkAvailability)(monitor.url);
    const prevStatus = monitor.lastStatus;
    monitor.checks = (monitor.checks || 0) + 1;
    if (avail.up)
        monitor.upChecks = (monitor.upChecks || 0) + 1;
    monitor.lastStatus = (avail.up ? 'up' : 'down');
    monitor.lastStatusCode = avail.statusCode;
    monitor.lastResponseMs = avail.responseMs;
    monitor.lastError = avail.error;
    monitor.https = avail.https;
    monitor.lastCheckedAt = new Date();
    if (avail.up)
        monitor.downSince = undefined;
    else if (!monitor.downSince)
        monitor.downSince = new Date();
    // Deep analysis only when reachable and requested.
    if (avail.up && deep) {
        const a = await (0, siteAnalyze_1.analyzePage)(monitor.url);
        monitor.scannedAt = new Date();
        monitor.tech = a.tech;
        monitor.scores = a.scores;
        monitor.seo = a.seo;
        monitor.counts = a.counts;
        monitor.security = a.security;
        monitor.issues = a.issues;
        monitor.links = (a.links || { internal: [], external: [] });
        monitor.images = (await (0, siteAnalyze_1.withImageSizes)(a.images || [])); // HEAD each image for byte size
    }
    await monitor.save();
    await monitor_1.SiteCheckLog.create({ monitorId: monitor._id, up: avail.up, statusCode: avail.statusCode, responseMs: avail.responseMs, error: avail.error });
    // Alert admins of this branch on a DOWN transition (and recovery).
    if (prevStatus === 'up' && !avail.up) {
        await notifyBranchAdmins(monitor, `${monitor.label || monitor.url} is down — ${avail.error || 'unreachable'}`, 'bad');
    }
    else if (prevStatus === 'down' && avail.up) {
        await notifyBranchAdmins(monitor, `${monitor.label || monitor.url} is back online`, 'ok');
    }
    return monitor;
}
async function notifyBranchAdmins(monitor, body, color) {
    const { User } = await Promise.resolve().then(() => __importStar(require('../models/User')));
    const filter = { isDeleted: false, role: { $in: ['admin', 'superadmin'] } };
    if (monitor.branchId)
        filter.$or = [{ branchId: monitor.branchId }, { role: 'superadmin' }];
    const admins = await User.find(filter).select('_id').lean();
    await Promise.all(admins.map(a => (0, notify_1.notify)(String(a._id), { type: 'site.status', title: 'Website status', body, color, link: '/site-monitoring' })));
}
// GET /sites — list monitors (admin/super admin, branch-scoped) with search, filter & paging
router.get('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.parsePaging)(req.query);
    const filter = { isDeleted: false, ...(0, rbac_1.branchFilter)(req) };
    if (req.query.status)
        filter.lastStatus = req.query.status;
    if (req.query.q) {
        const rx = (0, regex_1.safeRegex)(req.query.q);
        filter.$or = [{ url: rx }, { label: rx }];
    }
    const [rows, total] = await Promise.all([
        monitor_1.SiteMonitor.find(filter).populate('projectId', 'name type').sort({ lastStatus: 1, url: 1 }).skip(skip).limit(limit).lean(),
        monitor_1.SiteMonitor.countDocuments(filter),
    ]);
    (0, http_1.ok)(res, rows.map(r => ({ ...r, uptimePct: r.checks ? Math.round((r.upChecks / r.checks) * 100) : null })), { page, limit, total });
}));
// GET /sites/dashboard — aggregate stats
router.get('/dashboard', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false, ...(0, rbac_1.branchFilter)(req) };
    const rows = await monitor_1.SiteMonitor.find(filter).lean();
    const avg = (f) => rows.length ? Math.round(rows.reduce((n, r) => n + f(r), 0) / rows.length) : 0;
    (0, http_1.ok)(res, {
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
    });
}));
// POST /sites/sync — register a monitor for every LIVE project URL that doesn't have one
// (demo/sandbox projects are intentionally excluded).
router.post('/sync', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const projects = await Project_1.Project.find({ isDeleted: false, type: 'live', url: { $nin: [null, ''] } }).select('name url branchId').lean();
    let added = 0;
    for (const p of projects) {
        const url = normUrl(p.url);
        if (!url)
            continue;
        const exists = await monitor_1.SiteMonitor.findOne({ url, isDeleted: false });
        if (exists)
            continue;
        await monitor_1.SiteMonitor.create({ url, label: p.name, projectId: p._id, branchId: p.branchId, createdBy: req.user.id });
        added++;
    }
    await (0, audit_1.audit)(req.user, 'site.sync', 'SiteMonitor', null, { after: { added } });
    (0, http_1.ok)(res, { added, totalProjects: projects.length });
}));
// POST /sites — add a monitor manually
const addBody = zod_1.z.object({ url: zod_1.z.string().min(3), label: zod_1.z.string().optional(), projectId: zod_1.z.string().optional() });
router.post('/', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(addBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const url = normUrl(b.url);
    if (!url)
        throw ApiError_1.ApiError.badRequest('Invalid URL');
    if (await monitor_1.SiteMonitor.findOne({ url, isDeleted: false }))
        throw ApiError_1.ApiError.conflict('This URL is already monitored');
    const doc = await monitor_1.SiteMonitor.create({ url, label: b.label, projectId: b.projectId, branchId: req.user.branchId, createdBy: req.user.id });
    await (0, audit_1.audit)(req.user, 'site.create', 'SiteMonitor', doc._id);
    (0, http_1.created)(res, doc);
}));
// PATCH /sites/:id — edit label / url / enabled
const editBody = zod_1.z.object({ label: zod_1.z.string().optional(), url: zod_1.z.string().min(3).optional(), enabled: zod_1.z.boolean().optional() }).strict();
router.patch('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(editBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const m = await monitor_1.SiteMonitor.findOne({ _id: req.params.id, isDeleted: false });
    if (!m)
        throw ApiError_1.ApiError.notFound('Monitor not found');
    if (b.label !== undefined)
        m.label = b.label;
    if (b.enabled !== undefined)
        m.enabled = b.enabled;
    if (b.url) {
        const url = normUrl(b.url);
        if (!url)
            throw ApiError_1.ApiError.badRequest('Invalid URL');
        const dup = await monitor_1.SiteMonitor.findOne({ url, isDeleted: false, _id: { $ne: m._id } });
        if (dup)
            throw ApiError_1.ApiError.conflict('This URL is already monitored');
        m.url = url;
    }
    m.updatedBy = req.user.id;
    await m.save();
    await (0, audit_1.audit)(req.user, 'site.update', 'SiteMonitor', m._id);
    (0, http_1.ok)(res, m);
}));
// POST /sites/:id/scan — run a full scan now
router.post('/:id/scan', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const m = await monitor_1.SiteMonitor.findOne({ _id: req.params.id, isDeleted: false });
    if (!m)
        throw ApiError_1.ApiError.notFound('Monitor not found');
    await runScan(m);
    (0, http_1.ok)(res, m);
}));
// GET /sites/:id — detail + recent availability history
router.get('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const m = await monitor_1.SiteMonitor.findOne({ _id: req.params.id, isDeleted: false }).populate('projectId', 'name type').lean();
    if (!m)
        throw ApiError_1.ApiError.notFound('Monitor not found');
    const history = await monitor_1.SiteCheckLog.find({ monitorId: m._id }).sort({ ts: -1 }).limit(100).lean();
    const lastCrawl = await monitor_1.CrawlJob.findOne({ siteId: m._id, status: 'done' }).sort({ createdAt: -1 }).select('pages okPages brokenPages totalInternalLinks totalExternalLinks finishedAt').lean();
    (0, http_1.ok)(res, { ...m, uptimePct: m.checks ? Math.round((m.upChecks / m.checks) * 100) : null, history, lastCrawl });
}));
// POST /sites/:id/crawl — start a Playwright crawl (async). Returns the job immediately.
const crawlBody = zod_1.z.object({ maxPages: zod_1.z.number().int().min(1).max(300).optional() });
router.post('/:id/crawl', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(crawlBody), (0, http_1.asyncHandler)(async (req, res) => {
    const m = await monitor_1.SiteMonitor.findOne({ _id: req.params.id, isDeleted: false });
    if (!m)
        throw ApiError_1.ApiError.notFound('Monitor not found');
    const running = await monitor_1.CrawlJob.findOne({ siteId: m._id, status: 'running' }).lean();
    if (running)
        throw ApiError_1.ApiError.conflict('A crawl is already running for this site');
    // Fire-and-forget; the client polls GET /:id/crawl for progress/results.
    (0, crawler_1.runCrawl)(String(m._id), { maxPages: req.body.maxPages, createdBy: req.user.id }).catch(() => { });
    await (0, audit_1.audit)(req.user, 'site.crawl', 'SiteMonitor', m._id);
    (0, http_1.ok)(res, { started: true });
}));
// GET /sites/:id/crawl — latest crawl job + its pages
router.get('/:id/crawl', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const job = await monitor_1.CrawlJob.findOne({ siteId: req.params.id }).sort({ createdAt: -1 }).lean();
    if (!job)
        return (0, http_1.ok)(res, { job: null, pages: [] });
    const pages = await monitor_1.CrawlPage.find({ jobId: job._id }).sort({ depth: 1, url: 1 }).limit(500).lean();
    (0, http_1.ok)(res, { job, pages });
}));
// POST /sites/bulk-delete — remove many monitors at once
const bulkDelBody = zod_1.z.object({ ids: zod_1.z.array(zod_1.z.string()).min(1) });
router.post('/bulk-delete', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(bulkDelBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { ids } = req.body;
    const r = await monitor_1.SiteMonitor.updateMany({ _id: { $in: ids }, isDeleted: false }, { isDeleted: true, updatedBy: req.user.id });
    await (0, audit_1.audit)(req.user, 'site.bulk_delete', 'SiteMonitor', null, { after: { count: r.modifiedCount } });
    (0, http_1.ok)(res, { deleted: r.modifiedCount });
}));
router.delete('/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const m = await monitor_1.SiteMonitor.findByIdAndUpdate(req.params.id, { isDeleted: true, updatedBy: req.user.id });
    if (!m)
        throw ApiError_1.ApiError.notFound('Monitor not found');
    await (0, audit_1.audit)(req.user, 'site.delete', 'SiteMonitor', m._id);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=sites.js.map