"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrawlPage = exports.CrawlJob = exports.SiteCheckLog = exports.SiteMonitor = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
/**
 * A monitored website (usually linked to a Project URL). Holds the latest availability
 * status + the latest analysis snapshot; per-check history lives in SiteCheckLog.
 */
const siteMonitorSchema = new mongoose_1.Schema({
    projectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Project', index: true },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    url: { type: String, required: true },
    label: String,
    enabled: { type: Boolean, default: true },
    // ---- availability (refreshed by the monitor job) ----
    lastStatus: { type: String, enum: ['up', 'down', 'unknown'], default: 'unknown', index: true },
    lastStatusCode: { type: Number, default: 0 },
    lastResponseMs: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    lastCheckedAt: Date,
    downSince: Date, // set when it goes down, cleared when back up
    https: { type: Boolean, default: false },
    checks: { type: Number, default: 0 }, // total checks
    upChecks: { type: Number, default: 0 }, // checks that were up → uptime %
    // ---- latest analysis snapshot (refreshed on scan) ----
    scannedAt: Date,
    tech: { type: [String], default: [] }, // detected technologies
    scores: {
        health: { type: Number, default: 0 },
        seo: { type: Number, default: 0 },
        security: { type: Number, default: 0 },
        performance: { type: Number, default: 0 },
    },
    seo: { type: mongoose_1.Schema.Types.Mixed, default: {} }, // title, meta, h1, canonical, og, jsonld...
    counts: { type: mongoose_1.Schema.Types.Mixed, default: {} }, // links, images, missing alt, css, js...
    links: { type: mongoose_1.Schema.Types.Mixed, default: {} }, // { internal: [], external: [] } absolute URLs
    images: { type: [{ url: String, alt: Boolean, bytes: Number }], default: [] }, // images + byte sizes
    security: { type: mongoose_1.Schema.Types.Mixed, default: {} }, // header presence
    issues: { type: [{ severity: String, code: String, message: String }], default: [] },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
siteMonitorSchema.index({ url: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
/** Append-only availability history (for uptime/downtime + response-time charts). */
const siteCheckLogSchema = new mongoose_1.Schema({
    monitorId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
    ts: { type: Date, default: Date.now, index: true },
    up: Boolean,
    statusCode: Number,
    responseMs: Number,
    error: String,
}, { timestamps: false });
siteCheckLogSchema.index({ monitorId: 1, ts: -1 });
/** One crawl run over a site (Playwright-rendered, internal-link recursion). */
const crawlJobSchema = new mongoose_1.Schema({
    siteId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running', index: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    maxPages: { type: Number, default: 50 },
    pages: { type: Number, default: 0 }, // pages crawled
    okPages: { type: Number, default: 0 },
    brokenPages: { type: Number, default: 0 },
    totalInternalLinks: { type: Number, default: 0 }, // summed across pages
    totalExternalLinks: { type: Number, default: 0 },
    // ---- site-wide aggregates (unique across all crawled pages) ----
    uniqueInternal: { type: Number, default: 0 }, // distinct internal pages discovered
    uniqueExternal: { type: Number, default: 0 },
    totalImages: { type: Number, default: 0 },
    externalLinks: { type: [String], default: [] }, // distinct external URLs (capped)
    images: { type: [{ url: String, alt: Boolean, bytes: Number }], default: [] }, // distinct images + sizes (capped)
    avgScore: { type: Number, default: 0 },
    errorsByCode: { type: mongoose_1.Schema.Types.Mixed, default: {} }, // { '404': n, '500': n, ... }
    error: String,
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
crawlJobSchema.index({ siteId: 1, createdAt: -1 });
/** One page discovered/scanned within a crawl. */
const crawlPageSchema = new mongoose_1.Schema({
    jobId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'CrawlJob', index: true },
    siteId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
    url: String,
    depth: { type: Number, default: 0 },
    statusCode: Number,
    ok: Boolean,
    responseMs: Number,
    title: String,
    h1Count: Number,
    internalLinks: Number,
    externalLinks: Number,
    health: Number,
    issues: { type: Number, default: 0 },
    error: String,
}, { timestamps: false });
crawlPageSchema.index({ jobId: 1, url: 1 });
exports.SiteMonitor = (0, mongoose_1.model)('SiteMonitor', siteMonitorSchema);
exports.SiteCheckLog = (0, mongoose_1.model)('SiteCheckLog', siteCheckLogSchema);
exports.CrawlJob = (0, mongoose_1.model)('CrawlJob', crawlJobSchema);
exports.CrawlPage = (0, mongoose_1.model)('CrawlPage', crawlPageSchema);
//# sourceMappingURL=monitor.js.map