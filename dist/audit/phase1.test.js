"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** Phase-1 fixes verification: G1 (analytics cast), G2 (leave→attendance+balance),
 *  G4 (partial-unique reuse after soft delete). Self-cleaning. */
const db_1 = require("../config/db");
const catalog_1 = require("../models/catalog");
const User_1 = require("../models/User");
const leave_1 = require("../models/leave");
const Attendance_1 = require("../models/Attendance");
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
let sa = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m, p, body, tok = sa) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}
const check = (n, c, d = '') => { c ? pass++ : fail++;  };
async function main() {

    sa = (await call('POST', '/auth/login', { email: 'aarav@gdc.com', password: 'Admin@12345' })).json.data?.accessToken;
    // ---- G1: analytics aggregation works (no cast error), returns array ----
    const branches = (await call('GET', '/branches')).json.data;
    const branchId = branches[0]?._id;
    const an = await call('GET', `/projects/analytics/by-employee?branchId=${branchId}`);
    check('G1: analytics/by-employee returns array (cast ok)', an.status === 200 && Array.isArray(an.json.data), `status ${an.status}`);
    // ---- G4: unique name among active; reusable after soft delete ----
    const name = 'Phase1 Cat ' + Date.now();
    const c1 = await call('POST', '/categories', { name });
    const dup = await call('POST', '/categories', { name });
    check('G4: duplicate active name rejected', dup.status >= 400, `status ${dup.status}`);
    await call('DELETE', `/categories/${c1.json.data._id}`);
    const c2 = await call('POST', '/categories', { name });
    check('G4: same name reusable after soft delete', c2.status === 201, `status ${c2.status}`);
    // ---- G2: leave approve → attendance + balance ----
    const email = `p1.${Date.now()}@gdc.com`;
    const empId = (await call('POST', '/employees', { fullName: 'Phase1 Emp', email, password: 'Test@12345', role: 'employee', branchId })).json.data._id;
    const emp = (await call('POST', '/auth/login', { email, password: 'Test@12345' })).json.data.accessToken;
    await call('POST', '/leaves', { type: 'casual', fromDate: '2026-07-01', toDate: '2026-07-02', reason: 'p1' }, emp);
    const meAfterApply = (await call('GET', '/leaves/me', undefined, emp)).json.data;
    check('G2: pending balance held on apply', (meAfterApply.balance?.pending?.casual || 0) === 2, `pending=${meAfterApply.balance?.pending?.casual}`);
    const lrId = meAfterApply.history[0]._id;
    await call('PATCH', `/leaves/${lrId}/decision`, { decision: 'approved' });
    const meAfter = (await call('GET', '/leaves/me', undefined, emp)).json.data;
    check('G2: used incremented, pending released', (meAfter.balance?.used?.casual || 0) === 2 && (meAfter.balance?.pending?.casual || 0) === 0, `used=${meAfter.balance?.used?.casual} pending=${meAfter.balance?.pending?.casual}`);
    const att = (await call('GET', '/attendance/me?month=2026-07', undefined, emp)).json.data;
    const leaveDays = att.filter((a) => a.status === 'leave').length;
    check('G2: attendance marked leave for both days', leaveDays === 2, `leave days=${leaveDays}`);
    // ---- cleanup ----
    await (0, db_1.connectDB)();
    await catalog_1.Category.deleteMany({ name });
    await Attendance_1.Attendance.deleteMany({ userId: empId });
    await leave_1.LeaveRequest.deleteMany({ userId: empId });
    await leave_1.LeaveBalance.deleteMany({ userId: empId });
    await User_1.User.deleteMany({ _id: empId });
    await (0, db_1.disconnectDB)();

    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=phase1.test.js.map