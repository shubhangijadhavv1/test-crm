"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepSites = sweepSites;
exports.startSiteMonitorJob = startSiteMonitorJob;
const monitor_1 = require("../models/monitor");
const sites_1 = require("../modules/sites");
const INTERVAL_MS = 5 * 60_000; // availability sweep every 5 minutes
const CONCURRENCY = 5; // limit parallel fetches so we don't overload the host/network
let running = false;
/** Check every enabled monitor's availability (fast, no deep analysis), with bounded concurrency. */
async function sweepSites() {
    if (running)
        return 0;
    running = true;
    try {
        const monitors = await monitor_1.SiteMonitor.find({ isDeleted: false, enabled: true });
        let i = 0, done = 0;
        async function worker() {
            while (i < monitors.length) {
                const m = monitors[i++];
                try {
                    await (0, sites_1.runScan)(m, false);
                    done++;
                }
                catch { /* logged per-check */ }
            }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, monitors.length) }, worker));
        return done;
    }
    finally {
        running = false;
    }
}
function startSiteMonitorJob() {
    sweepSites().catch(() => { });
    setInterval(() => { sweepSites().catch(() => { }); }, INTERVAL_MS);
}
//# sourceMappingURL=siteMonitor.js.map