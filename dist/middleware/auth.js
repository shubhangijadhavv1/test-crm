"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jwt_1 = require("../utils/jwt");
const ApiError_1 = require("../utils/ApiError");
/** Validates the Bearer access token and attaches req.user. */
function requireAuth(req, _res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token)
        return next(ApiError_1.ApiError.unauthorized());
    try {
        const payload = (0, jwt_1.verifyAccess)(token);
        req.user = { id: payload.sub, role: payload.role, branchId: payload.branchId };
        next();
    }
    catch {
        next(ApiError_1.ApiError.unauthorized('Invalid or expired token'));
    }
}
//# sourceMappingURL=auth.js.map