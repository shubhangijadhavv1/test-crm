/**
 * Danger: clears all operational data, keeping ONLY the Super Admin account.
 * Use to return a database to a clean post-bootstrap state.
 *   npm run reset   (reads MONGODB_URI from .env)
 */
import { connectDB, disconnectDB } from '../config/db'
import { User } from '../models/User'
import { Branch, Holiday } from '../models/Branch'
import { Category, Subcategory, WebsiteType, ServerModel } from '../models/catalog'
import { Project } from '../models/Project'
import { Task } from '../models/Task'
import { ChecklistTemplate, QaProcess } from '../models/qa'
import { Attendance } from '../models/Attendance'
import { LeaveRequest, LeaveBalance } from '../models/leave'
import { Announcement, AnnouncementRead } from '../models/announcement'
import { Notification, Session, AuditLog } from '../models/misc'
import { ActivityTick, Screenshot } from '../models/ActivityTick'
import fs from 'fs'
import path from 'path'

async function main() {
  await connectDB()
  const results = await Promise.all([
    Branch.deleteMany({}), Holiday.deleteMany({}),
    Category.deleteMany({}), Subcategory.deleteMany({}), WebsiteType.deleteMany({}), ServerModel.deleteMany({}),
    Project.deleteMany({}), Task.deleteMany({}), ChecklistTemplate.deleteMany({}), QaProcess.deleteMany({}),
    Attendance.deleteMany({}), LeaveRequest.deleteMany({}), LeaveBalance.deleteMany({}),
    Announcement.deleteMany({}), AnnouncementRead.deleteMany({}),
    Notification.deleteMany({}), Session.deleteMany({}), AuditLog.deleteMany({}),
    ActivityTick.deleteMany({}), Screenshot.deleteMany({}),
    User.deleteMany({ role: { $ne: 'superadmin' } }),
  ])
  // also clear uploaded screenshot files on disk
  try { fs.rmSync(path.join(process.cwd(), 'uploads', 'screenshots'), { recursive: true, force: true }) } catch { /* ignore */ }
  const removed = results.reduce((a, r) => a + (r.deletedCount || 0), 0)
  const superAdmins = await User.countDocuments({ role: 'superadmin' })
  console.log(`[reset] removed ${removed} documents · kept ${superAdmins} super admin(s)`)
  await disconnectDB()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
