"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./config/tz"); // MUST be first — pins the process timezone to India (Asia/Kolkata)
const http_1 = __importDefault(require("http"));
const app_1 = require("./app");
const db_1 = require("./config/db");
const env_1 = require("./config/env");
const socket_1 = require("./realtime/socket");
const bootstrap_1 = require("./seed/bootstrap");
const overdue_1 = require("./jobs/overdue");
const siteMonitor_1 = require("./jobs/siteMonitor");
const webpush_1 = require("./services/webpush");
const User_1 = require("./models/User");
const Project_1 = require("./models/Project");
const qa_1 = require("./models/qa");
const catalog_1 = require("./models/catalog");
// Reconcile indexes (replaces old global-unique with partial-unique). Safe & idempotent.
async function syncIndexes() {
    const models = [User_1.User, Project_1.Project, qa_1.QaProcess, catalog_1.Category, catalog_1.Subcategory, catalog_1.WebsiteType, catalog_1.ServerModel];
    for (const m of models) {
        try {
            await m.syncIndexes();
        }
        catch {
            // A same-named index with different options exists → drop all (keep _id) and rebuild from schema.
            try {
                await m.collection.dropIndexes();
            }
            catch { /* ignore */ }
            try {
                await m.syncIndexes();
            }
            catch (e) {
                console.warn(`[db] index rebuild failed for ${m.modelName} (likely duplicate active values):`, e.message);
            }
        }
    }
}
async function main() {
    const { uri, inMemory } = await (0, db_1.connectDB)();
    await syncIndexes();
    // Bootstrap a Super Admin if none exists. No demo data; never wipes.
    const boot = await (0, bootstrap_1.ensureSuperAdmin)();
    const app = (0, app_1.createApp)();
    const server = http_1.default.createServer(app);
    (0, socket_1.initSocket)(server);
    (0, overdue_1.startOverdueJob)(); // periodic overdue-task sweep
    (0, siteMonitor_1.startSiteMonitorJob)(); // periodic website availability monitoring
    (0, webpush_1.initWebPush)(); // configure VAPID for browser push (no-op if keys absent)
    server.listen(env_1.env.port, '0.0.0.0', () => {
        console.log(`[tz] timezone: ${process.env.TZ} (${Intl.DateTimeFormat().resolvedOptions().timeZone}) · now ${new Date().toLocaleString('en-IN')}`);
        console.log(`[api] GDC CRM backend listening on http://localhost:${env_1.env.port}/api/v1`);
        console.log(`[api] health: http://localhost:${env_1.env.port}/health`);
        if (inMemory)
            console.log(`[db] uri: ${uri}`);
        if (boot.created)
            console.log(`[auth] login: ${env_1.env.seed.superAdminEmail} / ${env_1.env.seed.superAdminPassword}`);
    });
}
main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map