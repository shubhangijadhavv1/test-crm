"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOT_DIR = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Attendance_1 = require("../models/Attendance");
const User_1 = require("../models/User");
const Branch_1 = require("../models/Branch");
const ActivityTick_1 = require("../models/ActivityTick");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const session_1 = require("../agent/session");
const socket_1 = require("../realtime/socket");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
/**
 * Timezone-aware shift-start instant: HH:MM on the login's calendar day, in the branch's
 * timezone — so "10:00" means 10:00 in IST (or whatever the branch uses) regardless of where
 * the server runs (UTC in the cloud, etc.). Avoids the wrong late times you get from the
 * server's local clock.
 */
function shiftStartInTz(loginAt, hhmm, tz) {
    const [h, m] = (hhmm || '09:00').split(':').map(Number);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(loginAt);
    const [Y, M, D] = ymd.split('-').map(Number);
    const utcGuess = Date.UTC(Y, M - 1, D, h || 0, m || 0);
    // Offset of tz vs UTC at that wall-clock moment.
    const offset = new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: tz })).getTime()
        - new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    return new Date(utcGuess - offset);
}
/** Fresh, timezone-correct late mark for a session (don't trust possibly-stale stored values). */
function lateInfo(loginAt, branch) {
    if (!loginAt || !branch?.shift?.startTime)
        return { lateMark: false, lateBySeconds: 0 };
    const tz = branch.timezone || 'Asia/Kolkata';
    const start = shiftStartInTz(new Date(loginAt), branch.shift.startTime, tz);
    const grace = (branch.shift.graceMinutes ?? 15) * 60_000;
    const lateBySeconds = Math.max(0, Math.round((new Date(loginAt).getTime() - start.getTime()) / 1000));
    return { lateMark: new Date(loginAt).getTime() > start.getTime() + grace, lateBySeconds };
}
// Screenshot binaries land under uploads/screenshots (gitignored), served statically.
exports.SHOT_DIR = path_1.default.join(process.cwd(), 'uploads', 'screenshots');
fs_1.default.mkdirSync(exports.SHOT_DIR, { recursive: true });
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: exports.SHOT_DIR,
        filename: (req, file, cb) => cb(null, `${req.user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`),
    }),
    limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB cap
    fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/png' || file.mimetype === 'image/jpeg'),
});
/** Find or open today's attendance session for the caller (source: agent). */
async function todaySession(userId) {
    const user = await User_1.User.findById(userId).select('branchId workMode').lean();
    const date = dayKey();
    let att = await Attendance_1.Attendance.findOne({ userId, date });
    if (!att)
        att = await Attendance_1.Attendance.create({ userId, branchId: user?.branchId, date, workMode: user?.workMode || 'office', segments: [], status: 'present', source: 'agent' });
    // Self-heal: if the session was opened before a branch was assigned, adopt the user's
    // current branch so shift/break/remaining figures (which derive from the branch) populate.
    else if (!att.branchId && user?.branchId) {
        att.branchId = user.branchId;
        await att.save();
    }
    return att;
}
/** Authoritative session state so the agent can reconcile clock-in / break / clock-out done elsewhere (e.g. web). */
function sessionState(att) {
    if (!att)
        return { open: false, onBreak: false, breakType: null, clockedOut: false, loginAt: null };
    const openBreak = (att.segments || []).find(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea'));
    return {
        open: !!att.loginAt && !att.logoutAt,
        onBreak: !!openBreak,
        breakType: openBreak?.type || null,
        clockedOut: !!att.logoutAt,
        loginAt: att.loginAt || null,
    };
}
// GET /agent/session — current attendance state (lets the agent sync a web punch-in without ticks)
router.get('/session', (0, http_1.asyncHandler)(async (req, res) => {
    const att = await Attendance_1.Attendance.findOne({ userId: req.user.id, date: dayKey() }).lean();
    (0, http_1.ok)(res, sessionState(att));
}));
// GET /agent/my-status — is THIS user's desktop agent running & tracking? (for the web dashboard)
router.get('/my-status', (0, http_1.asyncHandler)(async (req, res) => {
    const att = await Attendance_1.Attendance.findOne({ userId: req.user.id, date: dayKey() }).select('_id source loginAt logoutAt').lean();
    if (!att)
        return (0, http_1.ok)(res, { connected: false, lastTickAt: null, open: false });
    const last = await ActivityTick_1.ActivityTick.findOne({ attendanceId: att._id }).sort({ ts: -1 }).select('ts').lean();
    const lastTickAt = last?.ts || null;
    const connected = !!lastTickAt && (Date.now() - new Date(lastTickAt).getTime()) < 150_000 && !att.logoutAt;
    (0, http_1.ok)(res, { connected, lastTickAt, open: !!att.loginAt && !att.logoutAt, source: att.source });
}));
// POST /agent/permissions — agent reports its macOS permission status
const permsBody = zod_1.z.object({ screen: zod_1.z.string().optional(), accessibility: zod_1.z.boolean().optional() });
router.post('/permissions', (0, validate_1.validate)(permsBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const att = await todaySession(req.user.id);
    att.agentPermissions = { screen: b.screen || 'unknown', accessibility: !!b.accessibility, at: new Date() };
    await att.save();
    (0, http_1.ok)(res, { ok: true });
}));
// GET /agent/config — capture policy for the caller's branch (agent applies on clock-in)
router.get('/config', (0, http_1.asyncHandler)(async (req, res) => {
    const user = await User_1.User.findById(req.user.id).select('branchId screenshotsEnabled').lean();
    const branch = user?.branchId ? await Branch_1.Branch.findById(user.branchId).select('monitoring').lean() : null;
    const m = branch?.monitoring || {};
    // Per-employee screenshot toggle (Super Admin): when off, interval 0 = agent captures none.
    const screenshotsOff = user?.screenshotsEnabled === false;
    (0, http_1.ok)(res, {
        screenshotIntervalSec: screenshotsOff ? 0 : Math.max(0, (m.screenshotIntervalMinutes ?? 10) * 60),
        screenshotsEnabled: !screenshotsOff,
        // Idle threshold in seconds (default 10s). Existing branches without the field also get 10s.
        idleThresholdSec: Math.max(5, m.idleThresholdSeconds ?? 10),
    });
}));
// POST /agent/clock-in — start a fresh agent session (reopens if the day was already closed)
router.post('/clock-in', (0, http_1.asyncHandler)(async (req, res) => {
    const att = await todaySession(req.user.id);
    const now = new Date();
    if (!att.loginAt) {
        // first clock-in of the day
        att.loginAt = now;
        att.segments.push({ type: 'work', startAt: now });
    }
    else if (att.logoutAt) {
        // resume the SAME day after a clock-out — the gap in between counts as neither
        // work nor idle; a new work segment simply starts now and totals accumulate.
        att.logoutAt = undefined;
        att.autoClosed = false;
        att.segments.push({ type: 'work', startAt: now });
    }
    att.source = 'agent';
    att.liveState = { state: 'active', since: now };
    await att.save();
    await (0, audit_1.audit)(req.user, 'agent.clock-in', 'Attendance', att._id);
    await (0, session_1.recomputeSession)(att._id);
    (0, socket_1.emitScoped)('agent:state', { userId: req.user.id, state: 'active' }, { branchId: att.branchId, userId: req.user.id });
    (0, http_1.created)(res, await Attendance_1.Attendance.findById(att._id));
}));
// POST /agent/clock-out
router.post('/clock-out', (0, http_1.asyncHandler)(async (req, res) => {
    const att = await Attendance_1.Attendance.findOne({ userId: req.user.id, date: dayKey() });
    if (!att || !att.loginAt)
        throw ApiError_1.ApiError.badRequest('No open session to clock out');
    const now = new Date();
    const open = att.segments.find(s => !s.endAt);
    if (open) {
        open.endAt = now;
        open.seconds = Math.floor((now.getTime() - new Date(open.startAt).getTime()) / 1000);
    }
    att.logoutAt = now;
    att.liveState = { state: 'active', since: now };
    await att.save();
    await (0, audit_1.audit)(req.user, 'agent.clock-out', 'Attendance', att._id);
    const out = await (0, session_1.recomputeSession)(att._id);
    (0, socket_1.emitScoped)('agent:state', { userId: req.user.id, state: 'offline' }, { branchId: att.branchId, userId: req.user.id });
    (0, http_1.ok)(res, out);
}));
// POST /agent/break/start { type: lunch|tea }
const breakStartBody = zod_1.z.object({ type: zod_1.z.enum(['lunch', 'tea']) });
router.post('/break/start', (0, validate_1.validate)(breakStartBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { type } = req.body;
    const att = await Attendance_1.Attendance.findOne({ userId: req.user.id, date: dayKey() });
    if (!att || !att.loginAt)
        throw ApiError_1.ApiError.badRequest('Clock in before taking a break');
    // One lunch + one tea per day.
    if (att.segments.some(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea')))
        throw ApiError_1.ApiError.conflict('Finish your current break first');
    if (att.segments.some(s => s.type === type))
        throw ApiError_1.ApiError.conflict(`You have already taken your ${type} break today`);
    const now = new Date();
    const open = att.segments.find(s => !s.endAt);
    if (open) {
        open.endAt = now;
        open.seconds = Math.floor((now.getTime() - new Date(open.startAt).getTime()) / 1000);
    }
    att.segments.push({ type, startAt: now });
    att.liveState = { state: 'break', since: now };
    await att.save();
    (0, socket_1.emitScoped)('agent:state', { userId: req.user.id, state: 'break' }, { branchId: att.branchId, userId: req.user.id });
    (0, http_1.ok)(res, { started: type });
}));
// POST /agent/break/end
router.post('/break/end', (0, http_1.asyncHandler)(async (req, res) => {
    const att = await Attendance_1.Attendance.findOne({ userId: req.user.id, date: dayKey() });
    if (!att)
        throw ApiError_1.ApiError.badRequest('No session');
    const now = new Date();
    const open = att.segments.find(s => !s.endAt && (s.type === 'lunch' || s.type === 'tea'));
    if (!open)
        throw ApiError_1.ApiError.badRequest('No break in progress');
    open.endAt = now;
    open.seconds = Math.floor((now.getTime() - new Date(open.startAt).getTime()) / 1000);
    att.segments.push({ type: 'work', startAt: now });
    att.liveState = { state: 'active', since: now };
    await att.save();
    (0, socket_1.emitScoped)('agent:state', { userId: req.user.id, state: 'active' }, { branchId: att.branchId, userId: req.user.id });
    (0, http_1.ok)(res, await (0, session_1.recomputeSession)(att._id));
}));
// POST /agent/state { state, idleStartedAt? } — instant activity transition (active/idle/break)
const stateBody = zod_1.z.object({ state: zod_1.z.enum(['active', 'idle', 'break']), idleStartedAt: zod_1.z.coerce.date().optional() });
router.post('/state', (0, validate_1.validate)(stateBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const att = await todaySession(req.user.id);
    att.liveState = { state: b.state, since: new Date(), idleStartedAt: b.state === 'idle' ? (b.idleStartedAt || new Date()) : undefined };
    await att.save();
    // push to admin dashboards so the change shows within a second (no poll wait)
    (0, socket_1.emitScoped)('agent:state', { userId: req.user.id, state: b.state }, { branchId: att.branchId, userId: req.user.id });
    (0, http_1.ok)(res, { state: b.state });
}));
// POST /agent/heartbeat { ticks: [{ ts, isIdle, activeApp, keyCount, mouseCount }] }
const heartbeatBody = zod_1.z.object({
    ticks: zod_1.z.array(zod_1.z.object({
        ts: zod_1.z.coerce.date(),
        isIdle: zod_1.z.boolean().optional(),
        idleSeconds: zod_1.z.number().min(0).max(60).optional(),
        state: zod_1.z.enum(['active', 'idle', 'break']).optional(),
        activeApp: zod_1.z.string().optional(),
        activeTitle: zod_1.z.string().optional(),
        activeUrl: zod_1.z.string().optional(),
        keyCount: zod_1.z.number().optional(),
        mouseCount: zod_1.z.number().optional(),
    })).min(1).max(240),
    agentVersion: zod_1.z.string().optional(),
});
router.post('/heartbeat', (0, validate_1.validate)(heartbeatBody), (0, http_1.asyncHandler)(async (req, res) => {
    const body = req.body;
    const att = await todaySession(req.user.id);
    // Break ticks don't count toward idle (agent pauses idle while on break).
    const docs = body.ticks.map(t => ({
        attendanceId: att._id, userId: req.user.id, branchId: att.branchId,
        ts: t.ts, isIdle: t.state === 'break' ? false : !!t.isIdle, state: t.state || (t.isIdle ? 'idle' : 'active'),
        idleSeconds: t.state === 'break' ? 0 : (t.idleSeconds != null ? t.idleSeconds : (t.isIdle ? 60 : 0)),
        activeApp: t.activeApp, activeTitle: t.activeTitle, activeUrl: t.activeUrl,
        keyCount: t.keyCount || 0, mouseCount: t.mouseCount || 0, agentVersion: body.agentVersion,
    }));
    await ActivityTick_1.ActivityTick.insertMany(docs, { ordered: false });
    const updated = await (0, session_1.recomputeSession)(att._id);
    // Authoritative session state so the desktop agent can reconcile when a break is ended /
    // started / the shift is clocked out from ELSEWHERE (e.g. the web CRM).
    (0, http_1.ok)(res, { accepted: docs.length, totals: updated?.totals, session: sessionState(updated) });
}));
// POST /agent/screenshot/upload — multipart binary (field "shot"); stores file + record
router.post('/screenshot/upload', upload.single('shot'), (0, http_1.asyncHandler)(async (req, res) => {
    if (!req.file)
        throw ApiError_1.ApiError.badRequest('No screenshot file');
    const att = await todaySession(req.user.id);
    const url = `/uploads/screenshots/${req.file.filename}`;
    const b = req.body || {};
    const screenCount = Math.max(1, Number(b.screenCount) || 1);
    const doc = await ActivityTick_1.Screenshot.create({
        attendanceId: att._id, userId: req.user.id, ts: new Date(),
        url, thumbnailUrl: url, blurred: b.blurred === 'true',
        screen: Math.max(1, Number(b.screen) || 1), screenCount,
        primary: b.primary === undefined ? true : b.primary === 'true',
        label: typeof b.label === 'string' ? b.label : '',
    });
    (0, http_1.created)(res, doc);
}));
// POST /agent/screenshot — metadata only (binary lives in object storage; DPDP: blur flag)
const shotBody = zod_1.z.object({ url: zod_1.z.string(), thumbnailUrl: zod_1.z.string().optional(), blurred: zod_1.z.boolean().optional(), ts: zod_1.z.coerce.date().optional() });
router.post('/screenshot', (0, validate_1.validate)(shotBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const att = await todaySession(req.user.id);
    const doc = await ActivityTick_1.Screenshot.create({ attendanceId: att._id, userId: req.user.id, ts: b.ts || new Date(), url: b.url, thumbnailUrl: b.thumbnailUrl, blurred: !!b.blurred });
    (0, http_1.created)(res, doc);
}));
/** Resolve which user's data the caller may read: self, or (admin/superadmin) a given userId. */
async function resolveTarget(req) {
    if (req.query.userId && req.user.role !== 'employee') {
        const target = req.query.userId;
        if (req.user.role === 'admin' && req.user.branchId) {
            const u = await User_1.User.findById(target).select('branchId').lean();
            if (String(u?.branchId) !== String(req.user.branchId))
                throw ApiError_1.ApiError.forbidden('Out of your branch');
        }
        return target;
    }
    return req.user.id;
}
// GET /agent/timeline?date=YYYY-MM-DD&userId= — session + ticks + breaks + screenshot count
router.get('/timeline', (0, http_1.asyncHandler)(async (req, res) => {
    const userId = await resolveTarget(req);
    const date = req.query.date || dayKey();
    const existing = await Attendance_1.Attendance.findOne({ userId, date }).select('_id').lean();
    if (!existing)
        return (0, http_1.ok)(res, { date, userId, session: null, ticks: [], breaks: [], screenshotCount: 0 });
    // Recompute so the detail page always shows complete, current Net Productive totals
    // (required / remaining / expected logout) even for sessions saved before this model.
    await (0, session_1.recomputeSession)(existing._id);
    const att = (await Attendance_1.Attendance.findById(existing._id).populate('userId', 'fullName department avatarColor').populate('branchId', 'shift breaks timezone').lean());
    Object.assign(att, lateInfo(att.loginAt, att.branchId)); // fresh, tz-correct late
    const ticks = await ActivityTick_1.ActivityTick.find({ attendanceId: att._id }).sort({ ts: 1 }).select('ts isIdle state activeApp activeTitle activeUrl keyCount mouseCount').lean();
    const screenshotCount = await ActivityTick_1.Screenshot.countDocuments({ attendanceId: att._id });
    const breaks = att.segments.filter(s => s.type === 'lunch' || s.type === 'tea');
    (0, http_1.ok)(res, { date, userId, session: att, ticks, breaks, screenshotCount });
}));
// GET /agent/screenshots?date=&userId= (admin/self)
router.get('/screenshots', (0, http_1.asyncHandler)(async (req, res) => {
    const userId = await resolveTarget(req);
    const date = req.query.date || dayKey();
    const att = await Attendance_1.Attendance.findOne({ userId, date }).select('_id').lean();
    if (!att)
        return (0, http_1.ok)(res, []);
    const shots = await ActivityTick_1.Screenshot.find({ attendanceId: att._id }).sort({ ts: 1 }).lean();
    (0, http_1.ok)(res, shots);
}));
// POST /agent/screenshots/bulk-delete { ids } — remove many at once (admin; branch-scoped)
const bulkDelBody = zod_1.z.object({ ids: zod_1.z.array(zod_1.z.string()).min(1).max(1000) });
router.post('/screenshots/bulk-delete', (0, validate_1.validate)(bulkDelBody), (0, http_1.asyncHandler)(async (req, res) => {
    if (req.user.role === 'employee')
        throw ApiError_1.ApiError.forbidden('Admins only');
    const { ids } = req.body;
    let shots = await ActivityTick_1.Screenshot.find({ _id: { $in: ids } });
    if (req.user.role === 'admin' && req.user.branchId) {
        const userIds = [...new Set(shots.map(s => String(s.userId)))];
        const inBranch = await User_1.User.find({ _id: { $in: userIds }, branchId: req.user.branchId }).select('_id').lean();
        const ok2 = new Set(inBranch.map(u => String(u._id)));
        shots = shots.filter(s => ok2.has(String(s.userId)));
    }
    for (const shot of shots) {
        if (shot.url) {
            try {
                fs_1.default.unlinkSync(path_1.default.join(process.cwd(), String(shot.url).replace(/^\//, '')));
            }
            catch { /* gone */ }
        }
        await ActivityTick_1.Screenshot.deleteOne({ _id: shot._id });
    }
    await (0, audit_1.audit)(req.user, 'agent.screenshot.bulk-delete', 'Screenshot', ids.join(','), { after: { deleted: shots.length } });
    (0, http_1.ok)(res, { deleted: shots.length });
}));
// DELETE /agent/screenshots/:id — remove a screenshot (admin; branch-scoped) + its file
router.delete('/screenshots/:id', (0, http_1.asyncHandler)(async (req, res) => {
    if (req.user.role === 'employee')
        throw ApiError_1.ApiError.forbidden('Admins only');
    const shot = await ActivityTick_1.Screenshot.findById(req.params.id);
    if (!shot)
        throw ApiError_1.ApiError.notFound('Screenshot not found');
    if (req.user.role === 'admin' && req.user.branchId) {
        const u = await User_1.User.findById(shot.userId).select('branchId').lean();
        if (String(u?.branchId) !== String(req.user.branchId))
            throw ApiError_1.ApiError.forbidden('Out of your branch');
    }
    if (shot.url) {
        try {
            fs_1.default.unlinkSync(path_1.default.join(process.cwd(), String(shot.url).replace(/^\//, '')));
        }
        catch { /* file already gone */ }
    }
    await ActivityTick_1.Screenshot.deleteOne({ _id: shot._id });
    await (0, audit_1.audit)(req.user, 'agent.screenshot.delete', 'Screenshot', shot._id);
    (0, http_1.ok)(res, { deleted: true });
}));
// GET /agent/summary?date=&branchId= — admin daily roll-up across the branch
router.get('/summary', (0, http_1.asyncHandler)(async (req, res) => {
    if (req.user.role === 'employee')
        throw ApiError_1.ApiError.forbidden('Admins only');
    const date = req.query.date || dayKey();
    const filter = { date, ...(0, rbac_1.branchScope)(req) };
    if (req.query.branchId && req.user.role === 'superadmin')
        filter.branchId = req.query.branchId;
    const allRows = await Attendance_1.Attendance.find(filter)
        .populate('userId', 'fullName department avatarColor isDeleted')
        .populate('branchId', 'shift breaks timezone') // shift window + break allowances + tz for late/remaining math
        .sort({ lateBySeconds: -1 })
        .lean();
    // Drop sessions of removed/soft-deleted employees (and orphaned rows whose user is gone),
    // so deleting a tester actually clears them from the live board.
    const rows = allRows.filter(r => r.userId && !r.userId.isDeleted);
    // Latest heartbeat tick per session → lets the client tick idle/work live.
    const ids = rows.map(r => r._id);
    const lastTicks = ids.length ? await ActivityTick_1.ActivityTick.aggregate([
        { $match: { attendanceId: { $in: ids } } },
        { $sort: { ts: -1 } },
        { $group: { _id: '$attendanceId', ts: { $first: '$ts' }, state: { $first: '$state' }, isIdle: { $first: '$isIdle' } } },
    ]) : [];
    const lastMap = new Map(lastTicks.map((t) => [String(t._id), t]));
    // Expose the currently-open segment + last tick so the client can tick break/idle/work live.
    const out = rows.map(r => ({
        ...r,
        // Recompute late FRESH (timezone-aware) so the card always shows the real late time,
        // not a possibly-stale value computed under a different server timezone.
        ...lateInfo(r.loginAt, r.branchId),
        openSegment: (r.segments || []).find((s) => !s.endAt) || null,
        lastTick: lastMap.get(String(r._id)) || null,
    }));
    // Include every (non-superadmin) employee in scope so the roster shows who has NOT logged in.
    const uf = { isDeleted: false, role: { $ne: 'superadmin' }, ...(0, rbac_1.branchScope)(req) };
    if (req.query.branchId && req.user.role === 'superadmin')
        uf.branchId = req.query.branchId;
    const users = await User_1.User.find(uf).select('fullName department avatarColor').lean();
    const present = new Set(out.map(r => String(r.userId?._id || r.userId)));
    const stubs = users.filter(u => !present.has(String(u._id))).map(u => ({
        _id: `nosession-${u._id}`,
        userId: { _id: u._id, fullName: u.fullName, department: u.department, avatarColor: u.avatarColor },
        branchId: null, loginAt: null, logoutAt: null, totals: {}, openSegment: null, lastTick: null, noSession: true,
    }));
    (0, http_1.ok)(res, [...out, ...stubs]);
}));
exports.default = router;
//# sourceMappingURL=agent.js.map