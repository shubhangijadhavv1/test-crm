"use strict";
/**
 * Focused test: branch weekend/lunch/tea/grace policy persists to MongoDB and is
 * correctly applied by the attendance calendar (weekly-off computation).
 * Run with the server up:  npm run test:branch
 */
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com';
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345';
let token = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(method, path, body, tok = token) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
}
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
    }
    else {
        fail++;
    }
}
async function main() {
    token = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json?.data?.accessToken;
    check('super admin login', !!token);
    // 1) Create a branch with a specific weekend policy: Sundays + 2nd & 4th Saturdays off
    const name = 'Policy Test Branch ' + Date.now();
    const created = await call('POST', '/branches', {
        name, code: 'PTB',
        shift: { startTime: '10:00', endTime: '19:00', graceMinutes: 20 },
        breaks: { lunchMinutes: 30, teaMinutes: 10 },
        weekend: { sundayOff: true, saturdayWeeks: [2, 4] },
    });
    check('branch created (201)', created.status === 201);
    const branchId = created.json?.data?._id;
    // 2) Read back from MongoDB and assert every field persisted
    const list = await call('GET', '/branches');
    const b = (list.json.data || []).find((x) => x._id === branchId);
    check('branch persisted & readable', !!b);
    check('grace persisted = 20', b?.shift?.graceMinutes === 20, `got ${b?.shift?.graceMinutes}`);
    check('lunch persisted = 30', b?.breaks?.lunchMinutes === 30, `got ${b?.breaks?.lunchMinutes}`);
    check('tea persisted = 10', b?.breaks?.teaMinutes === 10, `got ${b?.breaks?.teaMinutes}`);
    check('weekend saturdays = [2,4]', JSON.stringify(b?.weekend?.saturdayWeeks) === '[2,4]', JSON.stringify(b?.weekend?.saturdayWeeks));
    check('weekend label correct', /2nd, 4th Sat/.test(b?.weekendLabel || ''), b?.weekendLabel);
    // 3) Create an employee in that branch, then check the weekend-aware calendar
    const email = `policy.test.${Date.now()}@gdc.com`;
    const emp = await call('POST', '/employees', { fullName: 'Policy Tester', email, password: 'Welcome@123', role: 'employee', branchId });
    check('employee created in branch', emp.status === 201);
    const empTok = (await call('POST', '/auth/login', { email, password: 'Welcome@123' })).json?.data?.accessToken;
    // June 2026: 1st=Mon → Saturdays 6,13,20,27 ; Sundays 7,14,21,28
    const cal = await call('GET', '/attendance/calendar?month=2026-06', undefined, empTok);
    const days = cal.json?.data?.days || [];
    const stat = (d) => days.find(x => x.day === d)?.status;
    check('calendar returned 30 days', days.length === 30, `got ${days.length}`);
    check('Sun 7 = weekoff', stat(7) === 'weekoff', stat(7));
    check('Sun 28 = weekoff', stat(28) === 'weekoff', stat(28));
    check('2nd Sat (13) = weekoff', stat(13) === 'weekoff', stat(13));
    check('4th Sat (27) = weekoff', stat(27) === 'weekoff', stat(27));
    check('1st Sat (6) NOT weekoff', stat(6) !== 'weekoff', stat(6));
    check('3rd Sat (20) NOT weekoff', stat(20) !== 'weekoff', stat(20));
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=branch-policy.test.js.map