"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const User_1 = require("../models/User");
const Branch_1 = require("../models/Branch");
const misc_1 = require("../models/misc");
const http_1 = require("../utils/http");
const http_2 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const ApiError_1 = require("../utils/ApiError");
const password_1 = require("../utils/password");
const jwt_1 = require("../utils/jwt");
const audit_1 = require("../utils/audit");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
const refreshCookie = 'gdc_refresh';
function setRefreshCookie(res, token) {
    res.cookie(refreshCookie, token, {
        httpOnly: true,
        secure: env_1.env.cookie.secure,
        sameSite: env_1.env.cookie.sameSite,
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
}
async function publicUser(id) {
    return User_1.User.findById(id)
        .select('-passwordHash -security.twoFactorSecret')
        .populate('branchId', 'name code')
        .lean();
}
/** Normalise the client IP (strip IPv6-mapped prefix) for allowlist comparison. */
function clientIp(req) {
    return (req.ip || '').replace(/^::ffff:/, '');
}
// POST /auth/login  (password step; 2FA is out of scope for the core build)
router.post('/login', (0, validate_1.validate)(loginSchema), (0, http_2.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    const user = await User_1.User.findOne({ email: email.toLowerCase(), isDeleted: false }).select('+passwordHash');
    // Anti-enumeration: identical error for missing user / wrong password.
    if (!user)
        throw ApiError_1.ApiError.unauthorized('Invalid email or password');
    if (user.status === 'suspended')
        throw ApiError_1.ApiError.forbidden('Account suspended');
    const lockedUntil = user.security?.lockedUntil;
    if (lockedUntil && lockedUntil > new Date())
        throw ApiError_1.ApiError.forbidden('Account temporarily locked');
    const valid = await (0, password_1.verifyPassword)(password, user.passwordHash);
    if (!valid) {
        user.security = user.security || {};
        user.security.failedLoginCount =
            (user.security.failedLoginCount || 0) + 1;
        if ((user.security.failedLoginCount || 0) >= 8) {
            ;
            user.security.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        }
        await user.save();
        throw ApiError_1.ApiError.unauthorized('Invalid email or password');
    }
    // IP allowlist: per-user IPs ∪ their branch IPs. If configured, only allow matching IPs.
    const branchIps = user.branchId
        ? (await Branch_1.Branch.findById(user.branchId).select('allowedIps').lean())?.allowedIps || []
        : [];
    const allowed = [...(user.allowedIps || []), ...branchIps];
    if (allowed.length && !allowed.includes(clientIp(req))) {
        await (0, audit_1.audit)({ id: String(user._id), role: user.role, branchId: null }, 'auth.login.ip_blocked', 'User', user._id, { ip: clientIp(req) });
        throw ApiError_1.ApiError.forbidden(`Login not allowed from this network (${clientIp(req)})`);
    }
    ;
    user.security.failedLoginCount = 0;
    user.security.lockedUntil = undefined;
    await user.save();
    const session = await misc_1.Session.create({
        userId: user._id,
        device: 'web',
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const refresh = (0, jwt_1.signRefresh)({ sub: String(user._id), sid: String(session._id) });
    session.refreshTokenHash = crypto_1.default.createHash('sha256').update(refresh).digest('hex');
    await session.save();
    const accessToken = (0, jwt_1.signAccess)({
        sub: String(user._id),
        role: user.role,
        branchId: user.branchId ? String(user.branchId) : null,
    });
    setRefreshCookie(res, refresh);
    await (0, audit_1.audit)({ id: String(user._id), role: user.role, branchId: null }, 'auth.login', 'User', user._id, { ip: req.ip });
    (0, http_1.ok)(res, { accessToken, user: await publicUser(String(user._id)) });
}));
// POST /auth/refresh — rotate tokens using the refresh cookie
router.post('/refresh', (0, http_2.asyncHandler)(async (req, res) => {
    const token = req.cookies?.[refreshCookie];
    if (!token)
        throw ApiError_1.ApiError.unauthorized('No refresh token');
    let payload;
    try {
        payload = (0, jwt_1.verifyRefresh)(token);
    }
    catch {
        throw ApiError_1.ApiError.unauthorized('Invalid refresh token');
    }
    const session = await misc_1.Session.findById(payload.sid);
    const hash = crypto_1.default.createHash('sha256').update(token).digest('hex');
    if (!session || session.revoked || session.refreshTokenHash !== hash) {
        throw ApiError_1.ApiError.unauthorized('Session expired');
    }
    const user = await User_1.User.findById(payload.sub);
    if (!user || user.status === 'suspended')
        throw ApiError_1.ApiError.unauthorized();
    // rotation
    const newRefresh = (0, jwt_1.signRefresh)({ sub: payload.sub, sid: payload.sid });
    session.refreshTokenHash = crypto_1.default.createHash('sha256').update(newRefresh).digest('hex');
    session.lastSeenAt = new Date();
    await session.save();
    setRefreshCookie(res, newRefresh);
    const accessToken = (0, jwt_1.signAccess)({
        sub: String(user._id),
        role: user.role,
        branchId: user.branchId ? String(user.branchId) : null,
    });
    (0, http_1.ok)(res, { accessToken, user: await publicUser(String(user._id)) });
}));
// POST /auth/logout — revoke current session
router.post('/logout', (0, http_2.asyncHandler)(async (req, res) => {
    const token = req.cookies?.[refreshCookie];
    if (token) {
        try {
            const payload = (0, jwt_1.verifyRefresh)(token);
            await misc_1.Session.findByIdAndUpdate(payload.sid, { revoked: true });
        }
        catch {
            /* ignore */
        }
    }
    res.clearCookie(refreshCookie);
    (0, http_1.ok)(res, { loggedOut: true });
}));
// GET /auth/me — current user
router.get('/me', auth_1.requireAuth, (0, http_2.asyncHandler)(async (req, res) => {
    const user = await publicUser(req.user.id);
    if (!user)
        throw ApiError_1.ApiError.unauthorized();
    (0, http_1.ok)(res, user);
}));
// GET /auth/sessions — list own devices
router.get('/sessions', auth_1.requireAuth, (0, http_2.asyncHandler)(async (req, res) => {
    const sessions = await misc_1.Session.find({ userId: req.user.id, revoked: false }).sort({ lastSeenAt: -1 }).lean();
    (0, http_1.ok)(res, sessions);
}));
// POST /auth/change-password — the signed-in user changes their own password
const changePwSchema = zod_1.z.object({ currentPassword: zod_1.z.string().min(1), newPassword: zod_1.z.string().min(6) });
router.post('/change-password', auth_1.requireAuth, (0, validate_1.validate)(changePwSchema), (0, http_2.asyncHandler)(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User_1.User.findById(req.user.id).select('+passwordHash');
    if (!user)
        throw ApiError_1.ApiError.unauthorized();
    if (!(await (0, password_1.verifyPassword)(currentPassword, user.passwordHash)))
        throw ApiError_1.ApiError.badRequest('Current password is incorrect');
    user.passwordHash = await (0, password_1.hashPassword)(newPassword);
    if (user.security)
        user.security.lastPasswordChangeAt = new Date();
    await user.save();
    await (0, audit_1.audit)(req.user, 'auth.change_password', 'User', user._id);
    (0, http_1.ok)(res, { ok: true });
}));
// GET /auth/ip — the caller's current IP (helps admins configure the allowlist)
router.get('/ip', auth_1.requireAuth, (0, http_2.asyncHandler)(async (req, res) => (0, http_1.ok)(res, { ip: clientIp(req) })));
// POST /auth/impersonate/:userId — Super Admin opens an employee's dashboard (audited).
router.post('/impersonate/:userId', auth_1.requireAuth, (0, http_2.asyncHandler)(async (req, res) => {
    if (req.user.role !== 'superadmin')
        throw ApiError_1.ApiError.forbidden('Super Admin only');
    const target = await User_1.User.findOne({ _id: req.params.userId, isDeleted: false });
    if (!target)
        throw ApiError_1.ApiError.notFound('Employee not found');
    if (target.role === 'superadmin')
        throw ApiError_1.ApiError.badRequest('Cannot impersonate another Super Admin');
    const accessToken = (0, jwt_1.signAccess)({
        sub: String(target._id), role: target.role,
        branchId: target.branchId ? String(target.branchId) : null,
        imp: req.user.id, // marks this token as an impersonation session
    });
    await (0, audit_1.audit)(req.user, 'auth.impersonate', 'User', target._id);
    (0, http_1.ok)(res, { accessToken, user: await publicUser(String(target._id)) });
}));
exports.default = router;
//# sourceMappingURL=auth.js.map