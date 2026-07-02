"use strict";
/**
 * Work-time / late-mark engine (Desktop Agent — Blueprint Phase 4).
 *
 * Pure, deterministic, DB-free: given raw facts (clock in/out, per-tick idle flags,
 * break intervals) plus a branch policy, it produces the defensible daily numbers.
 * The agent reports raw; THIS decides. Re-runnable from stored ticks if rules change.
 *
 * Math (see GDC blueprint §3):
 *   span            = clockOut − clockIn
 *   pureIdle        = idle ticks × tickSeconds   (break time excluded by the agent)
 *   counted(type)   = min(taken, allowance)      → paid
 *   overage(type)   = max(0, taken − allowance)  → pushed into idle
 *   effectiveIdle   = pureIdle + Σ overage
 *   netWork (B)     = span − pureIdle − Σ overage     (allowed breaks paid)
 *   netWork (A)     = span − pureIdle − Σ taken       (every break unpaid)
 *   lateBy          = max(0, clockIn − shiftStart)
 *   lateMark        = clockIn > shiftStart + grace
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDay = computeDay;
exports.productiveTotals = productiveTotals;
exports.policyFromBranch = policyFromBranch;
/** Build a Date at `HH:MM` on the same calendar day as `ref` (local time). */
function hhmmOn(ref, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(ref);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
}
function computeDay(input) {
    const tickSeconds = input.tickSeconds ?? 60;
    const spanSeconds = Math.max(0, Math.round((input.clockOut.getTime() - input.clockIn.getTime()) / 1000));
    const pureIdleSeconds = input.ticks.reduce((n, t) => n + (t.isIdle ? 1 : 0), 0) * tickSeconds;
    // Group breaks by type, then apply per-type allowance.
    const takenByType = {};
    for (const b of input.breaks)
        takenByType[b.type] = (takenByType[b.type] || 0) + b.seconds;
    let breakSeconds = 0, countedBreakSeconds = 0, overageSeconds = 0;
    const breakdown = {};
    for (const [type, taken] of Object.entries(takenByType)) {
        const allowance = input.policy.breakAllowanceSeconds[type] ?? 0;
        const counted = Math.min(taken, allowance);
        const overage = Math.max(0, taken - allowance);
        breakSeconds += taken;
        countedBreakSeconds += counted;
        overageSeconds += overage;
        breakdown[type] = { takenSeconds: taken, countedSeconds: counted, overageSeconds: overage };
    }
    const effectiveIdleSeconds = pureIdleSeconds + overageSeconds;
    const netWorkSeconds = input.policy.billingModel === 'A'
        ? Math.max(0, spanSeconds - pureIdleSeconds - breakSeconds)
        : Math.max(0, spanSeconds - pureIdleSeconds - overageSeconds);
    const shiftStart = hhmmOn(input.clockIn, input.policy.shiftStart);
    const effectiveStart = shiftStart.getTime() + input.policy.graceMinutes * 60_000;
    const lateBySeconds = Math.max(0, Math.round((input.clockIn.getTime() - shiftStart.getTime()) / 1000));
    const lateMark = input.clockIn.getTime() > effectiveStart;
    let dayStatus = 'PRESENT';
    if (lateMark)
        dayStatus = 'LATE';
    const halfDay = input.policy.halfDayAfterMinutes;
    if (halfDay && input.clockIn.getTime() > shiftStart.getTime() + halfDay * 60_000)
        dayStatus = 'HALF_DAY';
    return {
        spanSeconds, pureIdleSeconds, breakSeconds, countedBreakSeconds, overageSeconds,
        effectiveIdleSeconds, netWorkSeconds, productiveSeconds: netWorkSeconds,
        lateMark, lateBySeconds, dayStatus, breakdown,
    };
}
function productiveTotals(input) {
    const shiftStart = hhmmOn(input.clockIn, input.policy.shiftStart);
    let shiftEnd = hhmmOn(input.clockIn, input.policy.shiftEnd);
    if (shiftEnd.getTime() <= shiftStart.getTime())
        shiftEnd = new Date(shiftEnd.getTime() + 24 * 3600_000); // overnight shift
    const shiftLenSeconds = Math.max(0, Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 1000));
    const allowedLunchSeconds = input.policy.breakAllowanceSeconds.lunch ?? 0;
    const allowedTeaSeconds = input.policy.breakAllowanceSeconds.tea ?? 0;
    const requiredProductiveSeconds = Math.max(0, shiftLenSeconds - allowedLunchSeconds - allowedTeaSeconds);
    const lunch = Math.max(0, input.lunchSeconds || 0);
    const tea = Math.max(0, input.teaSeconds || 0);
    const idle = Math.max(0, Math.round(input.idleSeconds || 0)); // exact seconds, no minute rounding
    const countedLunchSeconds = Math.min(lunch, allowedLunchSeconds);
    const countedTeaSeconds = Math.min(tea, allowedTeaSeconds);
    const extraLunchSeconds = Math.max(0, lunch - allowedLunchSeconds);
    const extraTeaSeconds = Math.max(0, tea - allowedTeaSeconds);
    const extraBreakSeconds = extraLunchSeconds + extraTeaSeconds;
    const spanSeconds = input.spanSeconds != null
        ? Math.max(0, Math.round(input.spanSeconds))
        : Math.max(0, Math.round(((input.now?.getTime() ?? Date.now()) - input.clockIn.getTime()) / 1000));
    // Model A: every break minute is unpaid → subtract the FULL breaks plus idle.
    const netProductiveSeconds = Math.max(0, spanSeconds - lunch - tea - idle);
    const remainingProductiveSeconds = Math.max(0, requiredProductiveSeconds - netProductiveSeconds);
    const overtimeSeconds = Math.max(0, netProductiveSeconds - requiredProductiveSeconds);
    const completionPct = requiredProductiveSeconds > 0
        ? Math.min(100, Math.round((netProductiveSeconds / requiredProductiveSeconds) * 100))
        : 100;
    // Expected logout = clockIn + required + actual breaks + idle (≡ now + remaining).
    const expectedLogout = new Date(input.clockIn.getTime() + (requiredProductiveSeconds + lunch + tea + idle) * 1000);
    return {
        shiftLenSeconds, spanSeconds, requiredProductiveSeconds,
        allowedLunchSeconds, allowedTeaSeconds, countedLunchSeconds, countedTeaSeconds,
        extraLunchSeconds, extraTeaSeconds, extraBreakSeconds,
        idleSeconds: idle, netProductiveSeconds, remainingProductiveSeconds,
        overtimeSeconds, completionPct, expectedLogout,
    };
}
/** Derive a WorkPolicy from a Branch document (reuses existing CRM branch settings). */
function policyFromBranch(branch) {
    return {
        shiftStart: branch.shift?.startTime || '09:00',
        shiftEnd: branch.shift?.endTime || '18:00',
        graceMinutes: branch.shift?.graceMinutes ?? 15,
        halfDayAfterMinutes: branch.monitoring?.halfDayAfterMinutes || undefined,
        breakAllowanceSeconds: {
            lunch: (branch.breaks?.lunchMinutes ?? 45) * 60,
            tea: (branch.breaks?.teaMinutes ?? 15) * 60,
        },
        // Net Productive model: every break minute is unpaid (Model A) for ALL branches.
        billingModel: 'A',
    };
}
//# sourceMappingURL=engine.js.map