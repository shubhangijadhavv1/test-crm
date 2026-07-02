"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = notFound;
exports.errorHandler = errorHandler;
const ApiError_1 = require("../utils/ApiError");
const env_1 = require("../config/env");
function notFound(_req, res) {
    res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, _req, res, _next) {
    if (err instanceof ApiError_1.ApiError) {
        return res.status(err.status).json({
            success: false,
            data: null,
            error: { code: err.code, message: err.message, fields: err.fields || {} },
        });
    }
    // Mongoose duplicate key
    const anyErr = err;
    if (anyErr?.code === 11000) {
        return res.status(409).json({
            success: false,
            data: null,
            error: { code: 'DUPLICATE', message: 'A record with these unique fields already exists' },
        });
    }
    if (anyErr?.name === 'ValidationError') {
        return res.status(422).json({
            success: false,
            data: null,
            error: { code: 'VALIDATION_ERROR', message: anyErr.message || 'Validation failed' },
        });
    }
    if (!env_1.env.isProd)
        console.error(err);
    res.status(500).json({
        success: false,
        data: null,
        error: { code: 'INTERNAL', message: 'Something went wrong' },
    });
}
//# sourceMappingURL=error.js.map