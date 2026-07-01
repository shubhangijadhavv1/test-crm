import path from 'path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import mongoSanitize from 'express-mongo-sanitize'
import { env } from './config/env'
import { ok } from './utils/http'
import { notFound, errorHandler } from './middleware/error'

import authRoutes from './modules/auth'
import catalogRoutes from './modules/catalog'
import branchRoutes from './modules/branches'
import employeeRoutes from './modules/employees'
import projectRoutes from './modules/projects'
import qaRoutes from './modules/qa'
import taskRoutes from './modules/tasks'
import attendanceRoutes from './modules/attendance'
import agentRoutes from './modules/agent'
import performanceRoutes from './modules/performance'
import leaveRoutes from './modules/leave'
import announcementRoutes from './modules/announcements'
import notificationRoutes from './modules/notifications'
import dashboardRoutes from './modules/dashboard'
import pushRoutes from './modules/push'
import siteRoutes from './modules/sites'

export function createApp() {
  const app = express()
  app.set("trust proxy", 1); // honour X-Forwarded-For so req.ip is the real client IP

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }))
  // CORS: if GDC_CORS_ORIGINS is set (comma-separated), only those origins may send credentials;
  // otherwise allow all (dev convenience). Set it in production to lock the API down.
  const corsAllow = (process.env.GDC_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  app.use(cors({
    origin: (origin, cb) => {
      if (!corsAllow.length) return cb(null, true) // dev: allow all
      if (!origin || corsAllow.includes(origin)) return cb(null, true)
      return cb(new Error('Origin not allowed by CORS'))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use(mongoSanitize() as unknown as express.RequestHandler) // strip $ / . from body, query & params → blocks NoSQL operator injection
  if (!env.isProd) app.use(morgan('dev'))

  // Stricter limit on auth endpoints (Blueprint A5)
  app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false }))
  app.use('/api/v1', rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }))

  app.get('/health', (_req, res) => ok(res, { status: 'ok', ts: Date.now() }))

  // Serve uploaded screenshots (cross-origin images allowed for the dashboard).
  app.use('/uploads', helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }), express.static('uploads'))

  const api = express.Router()
  api.use('/auth', authRoutes)
  api.use('/', catalogRoutes) // /categories, /subcategories, /website-types, /servers
  api.use('/branches', branchRoutes)
  api.use('/employees', employeeRoutes)
  api.use('/projects', projectRoutes)
  api.use('/', qaRoutes) // /checklist-templates, /qa, /projects/:id/qa
  api.use('/tasks', taskRoutes)
  api.use('/attendance', attendanceRoutes)
  api.use('/agent', agentRoutes)
  api.use('/performance', performanceRoutes)
  api.use('/leaves', leaveRoutes)
  api.use('/announcements', announcementRoutes)
  api.use('/notifications', notificationRoutes)
  api.use('/dashboard', dashboardRoutes)
  api.use('/push', pushRoutes)
  api.use('/sites', siteRoutes)

  app.use('/api/v1', api)

  // Serve frontend files from the 'dist' directory
  app.use(express.static(path.join(__dirname, 'dist')))

  // Handle SPA routing: redirect all non-API requests to index.html
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      return next()
    }
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })

  app.use(notFound)
  app.use(errorHandler)
  return app
}
