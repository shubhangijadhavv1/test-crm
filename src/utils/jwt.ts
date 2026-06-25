import jwt, { SignOptions } from 'jsonwebtoken'
import { env } from '../config/env'

export interface AccessPayload {
  sub: string // userId
  role: 'superadmin' | 'admin' | 'employee'
  branchId: string | null
  imp?: string // impersonator (superadmin) id, when a superadmin is viewing as this user
}

export function signAccess(payload: AccessPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl } as SignOptions)
}

export function signRefresh(payload: { sub: string; sid: string }): string {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl } as SignOptions)
}

export function verifyAccess(token: string): AccessPayload {
  return jwt.verify(token, env.jwt.accessSecret) as AccessPayload
}

export function verifyRefresh(token: string): { sub: string; sid: string } {
  return jwt.verify(token, env.jwt.refreshSecret) as { sub: string; sid: string }
}
