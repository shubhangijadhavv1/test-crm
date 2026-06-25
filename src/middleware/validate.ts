import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'
import { ApiError } from '../utils/ApiError'

type Source = 'body' | 'query' | 'params'

/** Validate req[source] against a Zod schema; replaces it with the parsed value. */
export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const err = result.error as ZodError
      const fields: Record<string, string> = {}
      for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message
      return next(ApiError.validation('Validation failed', fields))
    }
    // query/params are read-only getters on Express 5+, assign defensively
    ;(req as unknown as Record<string, unknown>)[source] = result.data
    next()
  }
}
