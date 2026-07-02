"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regression: idle accrued in a tick that ENDS active must not be dropped.
 *   npx tsx src/audit/idle-aggregation.test.ts
 */
const db_1 = require("../config/db");
const Attendance_1 = require("../models/Attendance");
const ActivityTick_1 = require("../models/ActivityTick");
const session_1 = require("../agent/session");
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; };
async function main() {
    await (0, db_1.connectDB)();
    const date = '2099-01-01'; // far future → never clashes with real data
    const loginAt = new Date('2099-01-01T10:00:00.000Z');
    await Attendance_1.Attendance.deleteMany({ date });
    const att = await Attendance_1.Attendance.create({
        date, loginAt, source: 'agent',
        segments: [{ type: 'work', startAt: loginAt, endAt: new Date('2099-01-01T11:00:00.000Z'), seconds: 3600 }],
    });
    await ActivityTick_1.ActivityTick.insertMany([
        { attendanceId: att._id, ts: new Date('2099-01-01T10:00:15Z'), isIdle: true, idleSeconds: 15, state: 'idle' },
        // user was idle 7s then moved the mouse → tick ENDS active but carries 7s of real idle
        { attendanceId: att._id, ts: new Date('2099-01-01T10:00:30Z'), isIdle: false, idleSeconds: 7, state: 'active' },
        { attendanceId: att._id, ts: new Date('2099-01-01T10:00:45Z'), isIdle: false, idleSeconds: 0, state: 'active' },
    ]);
    const updated = await (0, session_1.recomputeSession)(att._id);
    const idle = updated?.totals?.idleSeconds;
    check('idle = 22s (15 + 7), not 15 — active-ending idle kept', idle === 22, `got ${idle}s`);
    await ActivityTick_1.ActivityTick.deleteMany({ attendanceId: att._id });
    await Attendance_1.Attendance.deleteMany({ date });
    await (0, db_1.disconnectDB)();
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=idle-aggregation.test.js.map