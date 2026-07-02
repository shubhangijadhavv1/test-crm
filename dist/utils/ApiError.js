"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
class ApiError extends Error {
    status;
    code;
    fields;
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields;
    }
    static badRequest(message = 'Bad request', fields) {
        return new ApiError(400, 'BAD_REQUEST', message, fields);
    }
    static unauthorized(message = 'Authentication required') {
        return new ApiError(401, 'UNAUTHORIZED', message);
    }
    static forbidden(message = 'You do not have permission to perform this action') {
        return new ApiError(403, 'FORBIDDEN', message);
    }
    static notFound(message = 'Resource not found') {
        return new ApiError(404, 'NOT_FOUND', message);
    }
    static conflict(message = 'Conflict') {
        return new ApiError(409, 'CONFLICT', message);
    }
    static validation(message = 'Validation failed', fields) {
        return new ApiError(422, 'VALIDATION_ERROR', message, fields);
    }
}
exports.ApiError = ApiError;
//# sourceMappingURL=ApiError.js.map