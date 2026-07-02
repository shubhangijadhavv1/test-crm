import './config/tz' // MUST be first — pins the process timezone to India (Asia/Kolkata)
import http from 'http'
import { createApp } from './app'
import { connectDB } from './config/db'
import { env } from './config/env'
import { initSocket } from './realtime/socket'
import { ensureSuperAdmin } from './seed/bootstrap'
import { startOverdueJob } from './jobs/overdue'
import { startSiteMonitorJob } from './jobs/siteMonitor'
import { initWebPush } from './services/webpush'
import { User } from './models/User'
import { Project } from './models/Project'
import { QaProcess } from './models/qa'
import { Category, Subcategory, WebsiteType, ServerModel } from './models/catalog'

// Reconcile indexes (replaces old global-unique with partial-unique). Safe & idempotent.
async function syncIndexes() {
  const models = [User, Project, QaProcess, Category, Subcategory, WebsiteType, ServerModel]
  for (const m of models) {
    try {
      await m.syncIndexes()
    } catch {
      // A same-named index with different options exists → drop all (keep _id) and rebuild from schema.
      try { await m.collection.dropIndexes() } catch { /* ignore */ }
      try { await m.syncIndexes() } catch (e) { console.warn(`[db] index rebuild failed for ${m.modelName} (likely duplicate active values):`, (e as Error).message) }
    }
  }

}

async function main() {
  const { uri, inMemory } = await connectDB()


  await syncIndexes()

  // Bootstrap a Super Admin if none exists. No demo data; never wipes.
  const boot = await ensureSuperAdmin()
 

  const app = createApp()
  const server = http.createServer(app)
  initSocket(server)
  startOverdueJob() // periodic overdue-task sweep
  startSiteMonitorJob() // periodic website availability monitoring
  initWebPush() // configure VAPID for browser push (no-op if keys absent)

  server.listen(env.port, '0.0.0.0', () => {
    console.log(`[tz] timezone: ${process.env.TZ} (${Intl.DateTimeFormat().resolvedOptions().timeZone}) · now ${new Date().toLocaleString('en-IN')}`)
    console.log(`[api] GDC CRM backend listening on http://localhost:${env.port}/api/v1`)
    console.log(`[api] health: http://localhost:${env.port}/health`)
    if (inMemory) console.log(`[db] uri: ${uri}`)
    if (boot.created) console.log(`[auth] login: ${env.seed.superAdminEmail} / ${env.seed.superAdminPassword}`)
  })
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
