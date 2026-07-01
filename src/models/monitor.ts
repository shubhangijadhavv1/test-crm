import { Schema, model, InferSchemaType } from 'mongoose'
import { auditFields, baseSchemaOptions } from './base'

/**
 * A monitored website (usually linked to a Project URL). Holds the latest availability
 * status + the latest analysis snapshot; per-check history lives in SiteCheckLog.
 */
const siteMonitorSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
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
    seo: { type: Schema.Types.Mixed, default: {} }, // title, meta, h1, canonical, og, jsonld...
    counts: { type: Schema.Types.Mixed, default: {} }, // links, images, missing alt, css, js...
    links: { type: Schema.Types.Mixed, default: {} }, // { internal: [], external: [] } absolute URLs
    images: { type: [{ url: String, alt: Boolean, bytes: Number }], default: [] }, // images + byte sizes
    security: { type: Schema.Types.Mixed, default: {} }, // header presence
    issues: { type: [{ severity: String, code: String, message: String }], default: [] },
    ...auditFields,
  },
  baseSchemaOptions,
)
siteMonitorSchema.index({ url: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } })

/** Append-only availability history (for uptime/downtime + response-time charts). */
const siteCheckLogSchema = new Schema(
  {
    monitorId: { type: Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
    ts: { type: Date, default: Date.now, index: true },
    up: Boolean,
    statusCode: Number,
    responseMs: Number,
    error: String,
  },
  { timestamps: false },
)
siteCheckLogSchema.index({ monitorId: 1, ts: -1 })

/** One crawl run over a site (Playwright-rendered, internal-link recursion). */
const crawlJobSchema = new Schema(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
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
    errorsByCode: { type: Schema.Types.Mixed, default: {} }, // { '404': n, '500': n, ... }
    error: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)
crawlJobSchema.index({ siteId: 1, createdAt: -1 })

/** One page discovered/scanned within a crawl. */
const crawlPageSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'CrawlJob', index: true },
    siteId: { type: Schema.Types.ObjectId, ref: 'SiteMonitor', index: true },
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
  },
  { timestamps: false },
)
crawlPageSchema.index({ jobId: 1, url: 1 })

export type SiteMonitorDoc = InferSchemaType<typeof siteMonitorSchema>
export const SiteMonitor = model('SiteMonitor', siteMonitorSchema)
export const SiteCheckLog = model('SiteCheckLog', siteCheckLogSchema)
export const CrawlJob = model('CrawlJob', crawlJobSchema)
export const CrawlPage = model('CrawlPage', crawlPageSchema)
