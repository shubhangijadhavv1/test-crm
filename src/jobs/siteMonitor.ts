import { SiteMonitor } from '../models/monitor'
import { runScan } from '../modules/sites'

const INTERVAL_MS = 5 * 60_000 // availability sweep every 5 minutes
const CONCURRENCY = 5 // limit parallel fetches so we don't overload the host/network
let running = false

/** Check every enabled monitor's availability (fast, no deep analysis), with bounded concurrency. */
export async function sweepSites(): Promise<number> {
  if (running) return 0
  running = true
  try {
    const monitors = await SiteMonitor.find({ isDeleted: false, enabled: true })
    let i = 0, done = 0
    async function worker() {
      while (i < monitors.length) {
        const m = monitors[i++]
        try { await runScan(m, false); done++ } catch { /* logged per-check */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, monitors.length) }, worker))
    return done
  } finally {
    running = false
  }
}

export function startSiteMonitorJob() {
  sweepSites().catch(() => {})
  setInterval(() => { sweepSites().catch(() => {}) }, INTERVAL_MS)
}
