"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = void 0;
exports.ok = ok;
exports.created = created;
exports.parsePaging = parsePaging;
function ok(res, data, meta, status = 200) {
    return res.status(status).json({ success: true, data, meta: meta || null, error: null });
}
function created(res, data) {
    return ok(res, data, undefined, 201);
}
/** Wrap async route handlers so thrown/rejected errors hit the error middleware. */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
exports.asyncHandler = asyncHandler;
/** Parse standard pagination/sort query params. */
function parsePaging(query) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const sort = query.sort || 'createdAt';
    const order = query.order === 'asc' ? 1 : -1;
    return { page, limit, skip: (page - 1) * limit, sort: { [sort]: order } };
}
//# sourceMappingURL=http.js.map