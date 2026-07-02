"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Desktop-agent API pipeline test (clock-in → heartbeat → break → clock-out),
 * asserting ticks land as source-of-truth and Attendance.totals are recomputed
 * by the engine. Self-cleaning.
 *   npx tsx src/audit/agent-api.test.ts
 */
const db_1 = require("../config/db");
const Attendance_1 = require("../models/Attendance");
const ActivityTick_1 = require("../models/ActivityTick");
const User_1 = require("../models/User");
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com';
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345';
let sa = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m, p, body, tok = sa) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}
const check = (n, c, d = '') => { c ? pass++ : fail++; };
const ticks = (idle, active) => [
    ...Array.from({ length: idle }, () => ({ ts: new Date(), isIdle: true })),
    ...Array.from({ length: active }, () => ({ ts: new Date(), isIdle: false, keyCount: 120, mouseCount: 60 })),
];
async function main() {
    sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken;
    const branchId = (await call('GET', '/branches')).json.data?.[0]?._id;
    const tag = Date.now();
    const email = `agent.${tag}@gdc.com`;
    const empId = (await call('POST', '/employees', { fullName: 'Agent Emp', email, password: 'Test@12345', role: 'employee', branchId })).json.data._id;
    const tok = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).json.data.accessToken;
    // clock-in
    const ci = await call('POST', '/agent/clock-in', undefined, tok);
    check('clock-in opens an agent session', ci.status === 201 && ci.json.data?.source === 'agent' && !!ci.json.data?.loginAt);
    // heartbeat — 5 idle + 3 active ticks
    const hb1 = await call('POST', '/agent/heartbeat', { ticks: ticks(5, 3), agentVersion: '1.0.0' }, tok);
    check('heartbeat accepts 8 ticks', hb1.json.data?.accepted === 8, `accepted=${hb1.json.data?.accepted}`);
    check('idle = 5 ticks × 60s = 300s', hb1.json.data?.totals?.idleSeconds === 300, `idle=${hb1.json.data?.totals?.idleSeconds}`);
    // break (quick) — recorded as a segment
    await call('POST', '/agent/break/start', { type: 'lunch' }, tok);
    const be = await call('POST', '/agent/break/end', undefined, tok);
    check('break end recomputes session', be.status === 200 && be.json.data?.totals !== undefined);
    // a second heartbeat — idle accumulates (break ticks excluded)
    const hb2 = await call('POST', '/agent/heartbeat', { ticks: ticks(2, 4), agentVersion: '1.0.0' }, tok);
    check('idle accrues to 7 ticks = 420s', hb2.json.data?.totals?.idleSeconds === 420, `idle=${hb2.json.data?.totals?.idleSeconds}`);
    // screenshot metadata
    const ss = await call('POST', '/agent/screenshot', { url: 'https://store/x.jpg', blurred: true }, tok);
    check('screenshot metadata stored (blurred)', ss.status === 201 && ss.json.data?.blurred === true);
    // clock-out
    const co = await call('POST', '/agent/clock-out', undefined, tok);
    check('clock-out sets logoutAt + totals', co.status === 200 && !!co.json.data?.logoutAt && co.json.data?.totals?.idleSeconds === 420);
    check('lateBySeconds is a number', typeof co.json.data?.lateBySeconds === 'number');
    // source of truth: ticks persisted
    await (0, db_1.connectDB)();
    const att = await Attendance_1.Attendance.findOne({ userId: empId, date: new Date().toISOString().slice(0, 10) });
    const tickCount = await ActivityTick_1.ActivityTick.countDocuments({ attendanceId: att?._id });
    check('all 14 ticks persisted as source of truth', tickCount === 14, `count=${tickCount}`);
    const lunchSeg = att?.segments.find(s => s.type === 'lunch');
    check('lunch break recorded as a segment', !!lunchSeg);
    // ---- cleanup ----
    await ActivityTick_1.ActivityTick.deleteMany({ attendanceId: att?._id });
    await ActivityTick_1.Screenshot.deleteMany({ attendanceId: att?._id });
    await Attendance_1.Attendance.deleteMany({ _id: att?._id });
    await User_1.User.deleteMany({ _id: empId });
    await (0, db_1.disconnectDB)();
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=agent-api.test.js.map