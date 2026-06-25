import { Request, Response, NextFunction, RequestHandler } from 'express'

export interface Meta {
  page?: number
  limit?: number
  total?: number
}

export function ok(res: Response, data: unknown, meta?: Meta, status = 200) {
  return res.status(status).json({ success: true, data, meta: meta || null, error: null })
}

export function created(res: Response, data: unknown) {
  return ok(res, data, undefined, 201)
}

/** Wrap async route handlers so thrown/rejected errors hit the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

/** Parse standard pagination/sort query params. */
export function parsePaging(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20))
  const sort = (query.sort as string) || 'createdAt'
  const order = (query.order as string) === 'asc' ? 1 : -1
  return { page, limit, skip: (page - 1) * limit, sort: { [sort]: order } as Record<string, 1 | -1> }
}
