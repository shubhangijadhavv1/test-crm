import { Request, Response, NextFunction } from 'express'
import { ApiError } from '../utils/ApiError'
import { env } from '../config/env'

export function notFound(_req: Request, res: Response) {
  res.status(404).json({
    success: false,
    data: null,
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      data: null,
      error: { code: err.code, message: err.message, fields: err.fields || {} },
    })
  }

  // Mongoose duplicate key
  const anyErr = err as { code?: number; name?: string; message?: string }
  if (anyErr?.code === 11000) {
    return res.status(409).json({
      success: false,
      data: null,
      error: { code: 'DUPLICATE', message: 'A record with these unique fields already exists' },
    })
  }
  if (anyErr?.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: anyErr.message || 'Validation failed' },
    })
  }

  if (!env.isProd) console.error(err)
  res.status(500).json({
    success: false,
    data: null,
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  })
}
