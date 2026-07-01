import { chromium, Browser } from 'playwright'
import { analyzeHtml, withImageSizes } from './siteAnalyze'
import { CrawlJob, CrawlPage, SiteMonitor } from '../models/monitor'

/**
 * Playwright-rendered crawler. BFS over same-origin internal links, rendering each page so
 * client-rendered apps (React / Vue / Next / Nuxt / Angular) are analysed with their real DOM.
 * Bounded by maxPages so it stays safe on large sites. One shared headless browser per run.
 */
let browserPromise: Promise<Browser> | null = null
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  return browserPromise
}

const UA = 'GDC-CRM-Crawler/1.0 (+https://gdc.example)'
const norm = (u: string) => { try { return new URL(u).toString().split('#')[0].replace(/\/$/, '') } catch { return '' } }

/** Run one crawl for a site monitor. Returns the finished CrawlJob id. */
export async function runCrawl(siteId: string, opts: { maxPages?: number; createdBy?: string } = {}) {
  const site = await SiteMonitor.findById(siteId)
  if (!site) throw new Error('Site not found')
  const maxPages = Math.min(Math.max(opts.maxPages || 50, 1), 300)
  const job = await CrawlJob.create({ siteId: site._id, maxPages, status: 'running', createdBy: opts.createdBy })

  const root = norm(site.url)
  const origin = (() => { try { return new URL(root).origin } catch { return '' } })()
  const queue: { url: string; depth: number }[] = [{ url: root, depth: 0 }]
  const seen = new Set<string>([root])
  const errorsByCode: Record<string, number> = {}
  // Site-wide aggregates (unique across all pages).
  const externalAll = new Set<string>()
  const imagesAll = new Map<string, boolean>() // url → has-alt
  let pages = 0, okPages = 0, brokenPages = 0, internalTotal = 0, externalTotal = 0, scoreSum = 0

  let browser: Browser | null = null
  try {
    browser = await getBrowser()
    const ctx = await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } })

    while (queue.length && pages < maxPages) {
      const { url, depth } = queue.shift()!
      const page = await ctx.newPage()
      const started = Date.now()
      let statusCode = 0, html = '', headerOf: (n: string) => string | undefined = () => undefined
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        statusCode = resp?.status() || 0
        const hdrs = resp ? await resp.allHeaders().catch(() => ({} as Record<string, string>)) : {}
        headerOf = (n) => hdrs[n.toLowerCase()]
        await page.waitForTimeout(400) // let client-side render settle
        html = await page.content()
      } catch (e) {
        await CrawlPage.create({ jobId: job._id, siteId: site._id, url, depth, ok: false, statusCode: 0, error: (e as Error)?.message?.slice(0, 200) })
        errorsByCode.fetch = (errorsByCode.fetch || 0) + 1
        brokenPages++; pages++
        await page.close().catch(() => {})
        continue
      }
      const a = analyzeHtml(html, { status: statusCode, responseMs: Date.now() - started, finalUrl: page.url(), header: headerOf })
      pages++
      if (a.ok) okPages++; else { brokenPages++; errorsByCode[String(statusCode)] = (errorsByCode[String(statusCode)] || 0) + 1 }
      internalTotal += a.counts.internalLinks || 0
      externalTotal += a.counts.externalLinks || 0
      scoreSum += a.scores.health
      for (const ex of a.links?.external || []) externalAll.add(ex)
      for (const im of a.images || []) if (!imagesAll.has(im.url)) imagesAll.set(im.url, im.alt)
      await CrawlPage.create({
        jobId: job._id, siteId: site._id, url, depth, statusCode, ok: a.ok, responseMs: a.responseMs,
        title: (a.seo.title as string) || '', h1Count: (a.seo.h1Count as number) || 0,
        internalLinks: a.counts.internalLinks || 0, externalLinks: a.counts.externalLinks || 0,
        health: a.scores.health, issues: a.issues.length,
      })
      // enqueue new same-origin links
      for (const link of a.links?.internal || []) {
        const n = norm(link)
        if (n && n.startsWith(origin) && !seen.has(n) && seen.size < maxPages * 4) { seen.add(n); queue.push({ url: n, depth: depth + 1 }) }
      }
      await page.close().catch(() => {})
    }
    await ctx.close().catch(() => {})

    // Size up the distinct images discovered across the whole site (capped for speed).
    const imageList = [...imagesAll].map(([url, alt]) => ({ url, alt }))
    const imagesSized = await withImageSizes(imageList, 80, { concurrency: 12, timeoutMs: 5000 })
    const avgScore = pages ? Math.round(scoreSum / pages) : 0
    await CrawlJob.findByIdAndUpdate(job._id, {
      status: 'done', finishedAt: new Date(), pages, okPages, brokenPages,
      totalInternalLinks: internalTotal, totalExternalLinks: externalTotal,
      uniqueInternal: seen.size, uniqueExternal: externalAll.size, totalImages: imagesAll.size,
      externalLinks: [...externalAll].slice(0, 300), images: imagesSized,
      avgScore, errorsByCode,
    })
    return job._id
  } catch (e) {
    await CrawlJob.findByIdAndUpdate(job._id, { status: 'failed', finishedAt: new Date(), error: (e as Error)?.message?.slice(0, 300), pages, okPages, brokenPages })
    throw e
  }
}
