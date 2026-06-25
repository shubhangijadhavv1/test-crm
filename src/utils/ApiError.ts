export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }

  static badRequest(message = 'Bad request', fields?: Record<string, string>) {
    return new ApiError(400, 'BAD_REQUEST', message, fields)
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, 'FORBIDDEN', message)
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message)
  }
  static conflict(message = 'Conflict') {
    return new ApiError(409, 'CONFLICT', message)
  }
  static validation(message = 'Validation failed', fields?: Record<string, string>) {
    return new ApiError(422, 'VALIDATION_ERROR', message, fields)
  }
}
