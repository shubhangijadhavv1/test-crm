"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeSession = recomputeSession;
exports.finalizeStaleSessions = finalizeStaleSessions;
const Attendance_1 = require("../models/Attendance");
const Branch_1 = require("../models/Branch");
const ActivityTick_1 = require("../models/ActivityTick");
const engine_1 = require("./engine");
/**
 * Recompute Attendance.totals + lateMark — SEGMENT-BASED, so multiple clock-in/out
 * cycles in one day accumulate correctly and the clocked-out gaps count as neither
 * work nor idle. Single source of truth: re-derivable from segments + ticks.
 *
 *   presence  = Σ segment durations (work + lunch + tea)   ← excludes gaps
 *   idle      = idle ticks within the clocked-in windows (+ break overage, Model B)
 *   net work  = Σ work-segment seconds − idle
 *   lunch/tea = min(taken, allowance)   (overage pushed into idle)
 */
async function recomputeSession(attendanceId) {
    const att = await Attendance_1.Attendance.findById(attendanceId);
    if (!att || !att.loginAt)
        return att;
    const branch = att.branchId ? await Branch_1.Branch.findById(att.branchId).lean() : null;
    const policy = (0, engine_1.policyFromBranch)((branch || {}));
    const now = Date.now();
    // An OPEN segment only accrues up to the last heartbeat (+1 interval grace). If the
    // agent crashed / quit / lost network, presence stops growing instead of running forever.
    const last = await ActivityTick_1.ActivityTick.findOne({ attendanceId }).sort({ ts: -1 }).select('ts').lean();
    const liveEnd = last ? Math.min(now, new Date(last.ts).getTime() + 120_000) : now;
    // Sum segment durations (an open segment runs to the live end, not blindly to now).
    let workSeg = 0, lunchTaken = 0, teaTaken = 0;
    for (const s of att.segments) {
        const start = new Date(s.startAt).getTime();
        const end = s.endAt ? new Date(s.endAt).getTime() : liveEnd;
        const sec = Math.max(0, Math.floor((end - start) / 1000));
        if (s.type === 'work')
            workSeg += sec;
        else if (s.type === 'lunch')
            lunchTaken += sec;
        else if (s.type === 'tea')
            teaTaken += sec;
    }
    // Pure idle = exact idle seconds the agent measured, summed over EVERY tick — not only
    // ticks flagged isIdle. A tick carries the precise idle it accrued in its window even when
    // it ENDS active (user idle for a few seconds, then moved the mouse before the heartbeat):
    // that idle is real and must be kept, or it's silently lost on the next refresh. Legacy
    // ticks have no idleSeconds → fall back to isIdle×60; break ticks store idleSeconds 0.
    const [idleAgg] = await ActivityTick_1.ActivityTick.aggregate([
        { $match: { attendanceId } },
        { $group: { _id: null, idle: { $sum: { $ifNull: ['$idleSeconds', { $cond: ['$isIdle', 60, 0] }] } } } },
    ]);
    const pureIdle = idleAgg?.idle || 0;
    // Net Productive Hours model — single source of truth (engine.productiveTotals).
    // pureIdle is the EXACT agent-measured idle (sum of per-tick idleSeconds), never rounded.
    // Presence = Σ segment durations (work + breaks) — excludes clocked-out gaps, and an open
    // segment is capped at liveEnd so a crashed/quit agent stops accruing.
    const presence = workSeg + lunchTaken + teaTaken;
    const p = (0, engine_1.productiveTotals)({
        clockIn: att.loginAt,
        spanSeconds: presence,
        idleSeconds: pureIdle,
        lunchSeconds: lunchTaken,
        teaSeconds: teaTaken,
        policy,
    });
    att.totals = {
        // workSeconds / productiveSeconds = Net Productive (full breaks + idle removed).
        workSeconds: p.netProductiveSeconds,
        productiveSeconds: p.netProductiveSeconds,
        idleSeconds: p.idleSeconds, // exact pure idle, to the second
        lunchSeconds: p.countedLunchSeconds,
        teaSeconds: p.countedTeaSeconds,
        // Net Productive model fields (live dashboards read these directly).
        requiredSeconds: p.requiredProductiveSeconds,
        remainingSeconds: p.remainingProductiveSeconds,
        overtimeSeconds: p.overtimeSeconds,
        completionPct: p.completionPct,
        shiftLenSeconds: p.shiftLenSeconds,
        actualLunchSeconds: lunchTaken,
        actualTeaSeconds: teaTaken,
        allowedLunchSeconds: p.allowedLunchSeconds,
        allowedTeaSeconds: p.allowedTeaSeconds,
        extraLunchSeconds: p.extraLunchSeconds,
        extraTeaSeconds: p.extraTeaSeconds,
        extraBreakSeconds: p.extraBreakSeconds,
        expectedLogout: p.expectedLogout,
    };
    // Late mark is based on the FIRST clock-in of the day.
    const r = (0, engine_1.computeDay)({ clockIn: att.loginAt, clockOut: att.logoutAt || new Date(), ticks: [], breaks: [], policy });
    att.lateMark = r.lateMark;
    att.lateBySeconds = r.lateBySeconds;
    await att.save();
    return att;
}
/**
 * Finalize forgotten/agent sessions from prior days: an open session (loginAt set,
 * no logoutAt) on a past date is auto-closed at its last heartbeat (fallback loginAt),
 * then recomputed from ticks. Idempotent.
 */
async function finalizeStaleSessions() {
    const today = new Date().toISOString().slice(0, 10);
    const stale = await Attendance_1.Attendance.find({ logoutAt: { $in: [null, undefined] }, loginAt: { $ne: null }, date: { $lt: today } });
    let closed = 0;
    for (const att of stale) {
        const last = await ActivityTick_1.ActivityTick.findOne({ attendanceId: att._id }).sort({ ts: -1 }).select('ts').lean();
        const logoutAt = last?.ts ? new Date(last.ts) : new Date(att.loginAt);
        const open = att.segments.find(s => !s.endAt);
        if (open) {
            open.endAt = logoutAt;
            open.seconds = Math.max(0, Math.floor((logoutAt.getTime() - new Date(open.startAt).getTime()) / 1000));
        }
        att.logoutAt = logoutAt;
        att.autoClosed = true;
        await att.save();
        await recomputeSession(att._id);
        closed++;
    }
    return closed;
}
//# sourceMappingURL=session.js.map