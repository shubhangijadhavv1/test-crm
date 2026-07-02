"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Task write-authorization + reassignment-branch consistency test (C1, C2), with cleanup.
 *   npx tsx src/audit/task-authz.test.ts
 */
const db_1 = require("../config/db");
const Task_1 = require("../models/Task");
const User_1 = require("../models/User");
const Branch_1 = require("../models/Branch");
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
const check = (n, c, d = '') => { c ? pass++ : fail++;  };
async function main() {

    sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken;
    const branches = (await call('GET', '/branches')).json.data || [];
    const b1 = branches[0]?._id;
    const b2 = (branches[1]?._id) || b1; // fall back if only one branch
    const tag = Date.now();
    const ownerEmail = `authz.owner.${tag}@gdc.com`, otherEmail = `authz.other.${tag}@gdc.com`, b2Email = `authz.b2.${tag}@gdc.com`;
    const ownerId = (await call('POST', '/employees', { fullName: 'Authz Owner', email: ownerEmail, password: 'Test@12345', role: 'employee', branchId: b1 })).json.data._id;
    const otherId = (await call('POST', '/employees', { fullName: 'Authz Other', email: otherEmail, password: 'Test@12345', role: 'employee', branchId: b1 })).json.data._id;
    const b2Id = (await call('POST', '/employees', { fullName: 'Authz B2', email: b2Email, password: 'Test@12345', role: 'employee', branchId: b2 })).json.data._id;
    const ownerTok = (await call('POST', '/auth/login', { email: ownerEmail, password: 'Test@12345' })).json.data.accessToken;
    const otherTok = (await call('POST', '/auth/login', { email: otherEmail, password: 'Test@12345' })).json.data.accessToken;
    const b2Tok = (await call('POST', '/auth/login', { email: b2Email, password: 'Test@12345' })).json.data.accessToken;
    const taskId = (await call('POST', '/tasks', { title: `Authz ${tag}`, assigneeId: ownerId, priority: 'medium' })).json.data._id;
    // C1 — a different employee (not assignee/assigner) cannot move or edit it
    const m1 = await call('PATCH', `/tasks/${taskId}/move`, { status: 'inprogress' }, otherTok);
    check('non-owner employee CANNOT move task (403)', m1.status === 403, `status=${m1.status}`);
    const e1 = await call('PATCH', `/tasks/${taskId}`, { title: 'hacked' }, otherTok);
    check('non-owner employee CANNOT edit task (403)', e1.status === 403, `status=${e1.status}`);
    // assignee CAN move their own
    const m2 = await call('PATCH', `/tasks/${taskId}/move`, { status: 'inprogress' }, ownerTok);
    check('assignee CAN move own task', m2.status === 200, `status=${m2.status}`);
    // C2 — reassign to a different-branch employee updates branchId; that user now sees it
    const re = await call('PATCH', `/tasks/${taskId}`, { assigneeId: b2Id });
    check('reassignment succeeds', re.status === 200);
    const b2List = (await call('GET', '/tasks', undefined, b2Tok)).json.data || [];
    check('reassigned user (other branch) now sees the task', b2List.some((t) => t._id === taskId), `b2!=b1=${b2 !== b1}`);
    const ownerList = (await call('GET', '/tasks', undefined, ownerTok)).json.data || [];
    check('previous assignee no longer sees it', !ownerList.some((t) => t._id === taskId));
    // pagination meta present
    const paged = (await call('GET', '/tasks?limit=5')).json;
    check('list returns pagination meta', paged.meta && typeof paged.meta.total === 'number' && paged.data.length <= 5, `total=${paged.meta?.total} n=${paged.data?.length}`);
    // ---- cleanup ----
    await (0, db_1.connectDB)();
    await Task_1.Task.deleteMany({ _id: taskId });
    await User_1.User.deleteMany({ _id: { $in: [ownerId, otherId, b2Id] } });
    await (0, db_1.disconnectDB)();
    void Branch_1.Branch;

    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=task-authz.test.js.map