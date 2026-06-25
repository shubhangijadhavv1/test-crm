import { User } from '../models/User'
import { env } from '../config/env'
import { hashPassword } from '../utils/password'
import { defaultModuleAccess } from '../utils/access'

/**
 * Idempotent bootstrap (Blueprint D2.2): ensure ONE Super Admin exists so the
 * app is usable on an empty database. Creates no demo data and never wipes.
 * Safe to run against a live/production database.
 */
export async function ensureSuperAdmin(): Promise<{ created: boolean; email: string }> {
  const email = env.seed.superAdminEmail.toLowerCase()
  const existing = await User.findOne({ role: 'superadmin', isDeleted: false }).lean()
  if (existing) return { created: false, email: (existing.email as string) || email }

  const passwordHash = await hashPassword(env.seed.superAdminPassword)
  await User.create({
    fullName: 'Super Admin',
    email,
    passwordHash,
    employeeId: 'GDC-0001',
    role: 'superadmin',
    department: 'Management',
    designation: 'Super Admin',
    workMode: 'hybrid',
    moduleAccess: defaultModuleAccess('superadmin'),
  })
  return { created: true, email }
}
