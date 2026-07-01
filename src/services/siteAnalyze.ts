/**
 * Website intelligence — availability + single-page analysis. Dependency-free: uses Node's
 * global fetch and targeted HTML parsing. (JS-rendered SPA crawling is a Phase-2 add-on that
 * needs a headless browser; here we analyse the server response, which covers static, PHP,
 * WordPress and SSR Next/Nuxt pages well, and still reports the shell for CSR apps.)
 */
const UA = 'GDC-CRM-SiteMonitor/1.0 (+https://gdc.example)'

export interface Availability {
  up: boolean
  statusCode: number
  responseMs: number
  https: boolean
  finalUrl: string
  error: string
}

/** HEAD/GET the URL with a timeout; classify up/down + capture timing, code, DNS/SSL errors. */
export async function checkAvailability(url: string, timeoutMs = 12000): Promise<Availability> {
  const started = Date.now()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } })
    const responseMs = Date.now() - started
    return {
      up: res.status < 400,
      statusCode: res.status,
      responseMs,
      https: new URL(res.url || url).protocol === 'https:',
      finalUrl: res.url || url,
      error: res.status >= 400 ? `HTTP ${res.status}` : '',
    }
  } catch (e) {
    const msg = (e as Error)?.message || String(e)
    const dns = /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)
    const ssl = /certificate|SSL|TLS/i.test(msg)
    const timeout = /abort|timed out|ETIMEDOUT/i.test(msg)
    return {
      up: false, statusCode: 0, responseMs: Date.now() - started,
      https: url.startsWith('https'), finalUrl: url,
      error: dns ? 'DNS resolution failed' : ssl ? 'SSL/TLS error' : timeout ? 'Timeout' : msg,
    }
  } finally {
    clearTimeout(t)
  }
}

const between = (s: string, re: RegExp) => { const m = s.match(re); return m ? (m[1] || '').trim() : '' }
const all = (s: string, re: RegExp) => { const out: string[] = []; let m; const r = new RegExp(re, 'gi'); while ((m = r.exec(s))) out.push(m[1] || m[0]); return out }
const hasMeta = (s: string, prop: string) => new RegExp(`<meta[^>]+(property|name)=["']${prop}["']`, 'i').test(s)

type HeaderFn = (name: string) => string | undefined

/** Detect website technology from HTML signatures + headers. */
function detectTech(html: string, header: HeaderFn): string[] {
  const t = new Set<string>()
  const h = (header('x-powered-by') || '') + ' ' + (header('server') || '')
  if (/wp-content|wp-includes|wp-json/i.test(html)) t.add('WordPress')
  if (/\/_next\/|__NEXT_DATA__/i.test(html)) t.add('Next.js')
  if (/data-reactroot|react(?:-dom)?(?:\.production)?/i.test(html)) t.add('React')
  if (/__NUXT__|nuxt/i.test(html)) t.add('Nuxt')
  if (/data-v-[0-9a-f]{8}|vue(?:\.runtime)?/i.test(html)) t.add('Vue')
  if (/ng-version|angular/i.test(html)) t.add('Angular')
  if (/php/i.test(h)) t.add('PHP')
  if (/express|node/i.test(h)) t.add('Node.js')
  if (/cloudflare/i.test(header('server') || '')) t.add('Cloudflare')
  if (!t.size) t.add('HTML')
  return [...t]
}

export interface PageAnalysis {
  ok: boolean
  statusCode: number
  responseMs: number
  https: boolean
  tech: string[]
  seo: Record<string, unknown>
  counts: Record<string, number>
  security: Record<string, boolean>
  issues: { severity: string; code: string; message: string }[]
  scores: { health: number; seo: number; security: number; performance: number }
  links?: { internal: string[]; external: string[] } // absolute, deduped (used by the crawler)
  images?: { url: string; alt: boolean; bytes?: number }[]
}

/** Fetch a page and run SEO / technical / security analysis on the server response. */
export async function analyzePage(url: string, timeoutMs = 15000): Promise<PageAnalysis> {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } })
  } catch (e) {
    clearTimeout(timer)
    return {
      ok: false, statusCode: 0, responseMs: Date.now() - started, https: url.startsWith('https'),
      tech: [], seo: {}, counts: {}, security: {},
      issues: [{ severity: 'critical', code: 'fetch_failed', message: (e as Error)?.message || 'Fetch failed' }],
      scores: { health: 0, seo: 0, security: 0, performance: 0 },
    }
  }
  const responseMs = Date.now() - started
  clearTimeout(timer)
  const html = await res.text().catch(() => '')
  return analyzeHtml(html, { status: res.status, responseMs, finalUrl: res.url || url, header: (n) => res.headers.get(n) || undefined })
}

/**
 * Run the analysis on already-fetched/rendered HTML. The crawler passes Playwright-rendered
 * content here so client-rendered (React/Vue/Next) pages are analysed with their real DOM.
 */
export function analyzeHtml(html: string, ctx: { status: number; responseMs: number; finalUrl: string; header: HeaderFn }): PageAnalysis {
  const { status, responseMs, finalUrl, header } = ctx
  const issues: PageAnalysis['issues'] = []
  const add = (severity: string, code: string, message: string) => issues.push({ severity, code, message })
  const origin = (() => { try { return new URL(finalUrl).origin } catch { return '' } })()
  const https = finalUrl.startsWith('https:')

  // ---- SEO / structure ----
  const title = between(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const metaDesc = between(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i)
  const canonical = between(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
  const h1s = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const lang = between(html, /<html[^>]+lang=["']([^"']+)["']/i)
  const viewport = hasMeta(html, 'viewport')
  const og = hasMeta(html, 'og:title') || hasMeta(html, 'og:image')
  const twitter = hasMeta(html, 'twitter:card')
  const jsonld = all(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
  let jsonldValid = true
  for (const block of jsonld) { try { JSON.parse(block) } catch { jsonldValid = false } }

  if (!title) add('high', 'missing_title', 'Page is missing a <title> tag')
  else if (title.length > 65) add('low', 'long_title', `Title is long (${title.length} chars)`)
  if (!metaDesc) add('high', 'missing_meta_description', 'Missing meta description')
  if (!canonical) add('medium', 'missing_canonical', 'Missing canonical tag')
  if (h1s.length === 0) add('medium', 'missing_h1', 'No H1 heading found')
  else if (h1s.length > 1) add('low', 'multiple_h1', `Multiple H1 tags (${h1s.length})`)
  if (!og) add('low', 'missing_og', 'Missing Open Graph tags')
  if (!viewport) add('medium', 'missing_viewport', 'Missing responsive viewport meta')
  if (jsonld.length && !jsonldValid) add('low', 'invalid_jsonld', 'JSON-LD structured data is invalid')

  // ---- links / images / assets ----
  const hrefs = all(html, /<a[^>]+href=["']([^"'#]+)["']/i)
  const internalSet = new Set<string>(), externalSet = new Set<string>()
  for (const href of hrefs) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    let abs: string
    try { abs = new URL(href, finalUrl).toString().split('#')[0] } catch { continue }
    if (!/^https?:/i.test(abs)) continue
    if (origin && abs.startsWith(origin)) internalSet.add(abs.replace(/\/$/, '')); else externalSet.add(abs)
  }
  const internal = internalSet.size, external = externalSet.size
  const imgTags = all(html, /<img\b[^>]*>/i)
  const images: { url: string; alt: boolean }[] = []
  const imgSeen = new Set<string>()
  for (const tag of imgTags) {
    const src = between(tag, /\bsrc=["']([^"']+)["']/i) || between(tag, /\bdata-src=["']([^"']+)["']/i)
    if (!src) continue
    let abs: string
    try { abs = new URL(src, finalUrl).toString() } catch { continue }
    if (!/^https?:/i.test(abs) || imgSeen.has(abs)) continue
    imgSeen.add(abs)
    images.push({ url: abs, alt: /\balt=/.test(tag) })
  }
  const imgs = imgTags
  const imgsNoAlt = imgTags.filter(tag => !/\balt=/.test(tag)).length
  const css = all(html, /<link[^>]+rel=["']stylesheet["'][^>]*>/i).length
  const js = all(html, /<script[^>]+src=["'][^"']+["'][^>]*>/i).length
  const mixed = https ? all(html, /(?:src|href)=["']http:\/\/[^"']+["']/i).length : 0
  if (imgsNoAlt) add('medium', 'img_alt', `${imgsNoAlt} image(s) missing ALT text`)
  if (mixed) add('high', 'mixed_content', `${mixed} insecure (http://) resource(s) on an HTTPS page`)
  if (!https) add('high', 'no_https', 'Site is not served over HTTPS')

  // ---- security headers ----
  const sec = {
    hsts: !!header('strict-transport-security'),
    csp: !!header('content-security-policy'),
    xfo: !!header('x-frame-options'),
    xcto: !!header('x-content-type-options'),
    referrer: !!header('referrer-policy'),
    permissions: !!header('permissions-policy'),
  }
  if (!sec.hsts && https) add('medium', 'no_hsts', 'Missing Strict-Transport-Security header')
  if (!sec.csp) add('medium', 'no_csp', 'Missing Content-Security-Policy header')
  if (!sec.xfo) add('low', 'no_xfo', 'Missing X-Frame-Options (clickjacking) header')
  if (!sec.xcto) add('low', 'no_xcto', 'Missing X-Content-Type-Options header')

  if (status >= 400) add('critical', `http_${status}`, `Page returned HTTP ${status}`)
  if (responseMs > 3000) add('medium', 'slow', `Slow server response (${responseMs} ms)`)

  // ---- scores (0–100), penalised per weighted issue ----
  const penalty = (codes: string[], weights: Record<string, number>) =>
    Math.max(0, 100 - issues.filter(i => codes.includes(i.code)).reduce((n, i) => n + (weights[i.severity] ?? 5), 0))
  const w = { critical: 40, high: 20, medium: 10, low: 4 }
  const seoCodes = ['missing_title', 'long_title', 'missing_meta_description', 'missing_canonical', 'missing_h1', 'multiple_h1', 'missing_og', 'missing_viewport', 'invalid_jsonld', 'img_alt']
  const secCodes = ['mixed_content', 'no_https', 'no_hsts', 'no_csp', 'no_xfo', 'no_xcto']
  const perfCodes = ['slow']
  const scores = {
    seo: penalty(seoCodes, w),
    security: penalty(secCodes, w),
    performance: Math.max(0, 100 - Math.round(responseMs / 30) - penalty(perfCodes, w) * 0 - (responseMs > 3000 ? 20 : 0)),
  }
  scores.performance = Math.min(100, Math.max(0, scores.performance))
  const health = Math.round((scores.seo + scores.security + scores.performance + (status < 400 ? 100 : 0)) / 4)

  return {
    ok: status < 400, statusCode: status, responseMs, https,
    tech: detectTech(html, header),
    seo: { title, titleLen: title.length, metaDesc, metaDescLen: metaDesc.length, canonical, h1Count: h1s.length, lang, viewport, og, twitter, jsonld: jsonld.length, jsonldValid },
    counts: { links: hrefs.length, internalLinks: internal, externalLinks: external, images: imgs.length, imagesNoAlt: imgsNoAlt, cssFiles: css, jsFiles: js, mixedContent: mixed, htmlBytes: html.length },
    security: sec,
    issues,
    scores: { ...scores, health },
    links: { internal: [...internalSet], external: [...externalSet] },
    images,
  }
}

/** HEAD each image to read its byte size (Content-Length). Capped + concurrent for speed. */
export async function withImageSizes(images: { url: string; alt: boolean }[], cap = 60, opts: { concurrency?: number; timeoutMs?: number } = {}): Promise<{ url: string; alt: boolean; bytes?: number }[]> {
  const list = images.slice(0, cap)
  const concurrency = opts.concurrency ?? 8
  const timeoutMs = opts.timeoutMs ?? 6000
  let i = 0
  const out: { url: string; alt: boolean; bytes?: number }[] = list.map(im => ({ ...im }))
  async function worker() {
    while (i < list.length) {
      const idx = i++
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        let r = await fetch(list[idx].url, { method: 'HEAD', signal: ctrl.signal, headers: { 'User-Agent': UA } })
        let len = r.headers.get('content-length')
        if (!len) { // some servers don't answer HEAD with a length → tiny ranged GET
          r = await fetch(list[idx].url, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: ctrl.signal })
          len = r.headers.get('content-range')?.split('/')?.[1] || r.headers.get('content-length') || null
        }
        if (len) out[idx].bytes = Number(len)
      } catch { /* leave bytes undefined */ } finally { clearTimeout(t) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  return out
}
