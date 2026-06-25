import { Request, Response, NextFunction } from 'express'
import { verifyAccess } from '../utils/jwt'
import { ApiError } from '../utils/ApiError'

export type Role = 'superadmin' | 'admin' | 'employee'

export interface AuthUser {
  id: string
  role: Role
  branchId: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

/** Validates the Bearer access token and attaches req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) return next(ApiError.unauthorized())
  try {
    const payload = verifyAccess(token)
    req.user = { id: payload.sub, role: payload.role, branchId: payload.branchId }
    next()
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'))
  }
}
