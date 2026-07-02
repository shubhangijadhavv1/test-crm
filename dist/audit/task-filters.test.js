"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Task list filters + role scoping test, then full cleanup.
 *   npx tsx src/audit/task-filters.test.ts
 * Verifies superadmin sees all, employee sees only own, and assignee/priority/range filters.
 */
const db_1 = require("../config/db");
const Task_1 = require("../models/Task");
const User_1 = require("../models/User");
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com';
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345';
let sa = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m, p, body, tok = sa) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({}));
}
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };
async function main() {
    console.log(`\nTask filters + scoping test → ${BASE}\n${'─'.repeat(60)}`);
    sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).data?.accessToken;
    const branchId = (await call('GET', '/branches')).data?.[0]?._id;
    const tag = Date.now();
    const aEmail = `tf.a.${tag}@gdc.com`, bEmail = `tf.b.${tag}@gdc.com`;
    const aId = (await call('POST', '/employees', { fullName: 'TF Alpha', email: aEmail, password: 'Test@12345', role: 'employee', branchId })).data._id;
    const bId = (await call('POST', '/employees', { fullName: 'TF Beta', email: bEmail, password: 'Test@12345', role: 'employee', branchId })).data._id;
    const aTok = (await call('POST', '/auth/login', { email: aEmail, password: 'Test@12345' })).data.accessToken;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const t1 = (await call('POST', '/tasks', { title: `TF crit ${tag}`, assigneeId: aId, priority: 'critical', dueAt: today.toISOString() })).data._id;
    const t2 = (await call('POST', '/tasks', { title: `TF low ${tag}`, assigneeId: bId, priority: 'low' })).data._id;
    // superadmin sees both
    const all = (await call('GET', '/tasks')).data || [];
    check('superadmin sees both new tasks', all.some((t) => t._id === t1) && all.some((t) => t._id === t2));
    // employee A sees only own
    const mine = (await call('GET', '/tasks', undefined, aTok)).data || [];
    check('employee sees only own task', mine.some((t) => t._id === t1) && !mine.some((t) => t._id === t2));
    // assignee filter
    const byA = (await call('GET', `/tasks?assignee=${aId}`)).data || [];
    check('assignee filter returns only that user', byA.every((t) => String(t.assigneeId?._id || t.assigneeId) === aId) && byA.some((t) => t._id === t1));
    // priority filter
    const crit = (await call('GET', '/tasks?priority=critical')).data || [];
    check('priority filter returns only critical', crit.every((t) => t.priority === 'critical') && crit.some((t) => t._id === t1));
    // range=today returns the due-today task, hides the no-due one
    const todayList = (await call('GET', '/tasks?range=today')).data || [];
    check('range=today includes due-today task, excludes no-due', todayList.some((t) => t._id === t1) && !todayList.some((t) => t._id === t2));
    // ---- cleanup ----
    await (0, db_1.connectDB)();
    await Task_1.Task.deleteMany({ _id: { $in: [t1, t2] } });
    await User_1.User.deleteMany({ _id: { $in: [aId, bId] } });
    await (0, db_1.disconnectDB)();
    console.log(`${'─'.repeat(60)}\n${pass} passed, ${fail} failed · test docs cleaned up\n`);
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=task-filters.test.js.map