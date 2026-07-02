"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
exports.requirePermission = requirePermission;
exports.branchScope = branchScope;
exports.branchFilter = branchFilter;
const ApiError_1 = require("../utils/ApiError");
const User_1 = require("../models/User");
/** Require one of the given roles. */
function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user)
            return next(ApiError_1.ApiError.unauthorized());
        if (!roles.includes(req.user.role))
            return next(ApiError_1.ApiError.forbidden());
        next();
    };
}
/**
 * Require a per-module permission flag (A3). Super Admin always passes.
 * Looks up the user's permissions document; flags are stored on the user.
 */
function requirePermission(module, action) {
    return async (req, _res, next) => {
        try {
            if (!req.user)
                return next(ApiError_1.ApiError.unauthorized());
            if (req.user.role === 'superadmin')
                return next();
            const user = await User_1.User.findById(req.user.id).select('permissions role').lean();
            if (!user)
                return next(ApiError_1.ApiError.unauthorized());
            const perm = user.permissions?.[module];
            if (perm && perm[action])
                return next();
            // Admins get broad defaults except hard delete.
            if (req.user.role === 'admin' && action !== 'delete')
                return next();
            next(ApiError_1.ApiError.forbidden(`Missing permission: ${module}.${action}`));
        }
        catch (err) {
            next(err);
        }
    };
}
/**
 * Branch scope: returns a Mongo filter fragment restricting non-Super-Admins
 * to their own branch. Super Admin sees everything.
 */
function branchScope(req) {
    if (!req.user || req.user.role === 'superadmin')
        return {};
    if (!req.user.branchId)
        return {};
    return { branchId: req.user.branchId };
}
/**
 * Branch filter for reads. Non-Super-Admins are locked to their branch.
 * Super Admin may optionally pass ?branchId= to view a specific branch (else all).
 */
function branchFilter(req) {
    if (req.user?.role === 'superadmin') {
        const b = req.query?.branchId || '';
        return b ? { branchId: b } : {};
    }
    return branchScope(req);
}
//# sourceMappingURL=rbac.js.map