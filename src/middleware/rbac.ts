import { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/ApiError'
import { User } from '../models/User'
import { Role } from './auth'

/** Require one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized())
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden())
    next()
  }
}

/**
 * Require a per-module permission flag (A3). Super Admin always passes.
 * Looks up the user's permissions document; flags are stored on the user.
 */
export function requirePermission(module: string, action: 'view' | 'create' | 'edit' | 'delete') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) return next(ApiError.unauthorized())
      if (req.user.role === 'superadmin') return next()
      const user = await User.findById(req.user.id).select('permissions role').lean()
      if (!user) return next(ApiError.unauthorized())
      const perm = (user.permissions as Record<string, Record<string, boolean>> | undefined)?.[module]
      if (perm && perm[action]) return next()
      // Admins get broad defaults except hard delete.
      if (req.user.role === 'admin' && action !== 'delete') return next()
      next(ApiError.forbidden(`Missing permission: ${module}.${action}`))
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Branch scope: returns a Mongo filter fragment restricting non-Super-Admins
 * to their own branch. Super Admin sees everything.
 */
export function branchScope(req: Request): Record<string, unknown> {
  if (!req.user || req.user.role === 'superadmin') return {}
  if (!req.user.branchId) return {}
  return { branchId: req.user.branchId }
}

/**
 * Branch filter for reads. Non-Super-Admins are locked to their branch.
 * Super Admin may optionally pass ?branchId= to view a specific branch (else all).
 */
export function branchFilter(req: Request): Record<string, unknown> {
  if (req.user?.role === 'superadmin') {
    const b = (req.query?.branchId as string) || ''
    return b ? { branchId: b } : {}
  }
  return branchScope(req)
}
