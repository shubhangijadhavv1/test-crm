"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * QA + checklist→task flow test (live project), then full cleanup of test docs.
 *   npm run test:qa
 * Uses a throwaway developer + reviewer because checklist ticking is strictly
 * limited to the assigned reviewer of each stage (no admin override).
 */
const db_1 = require("../config/db");
const Project_1 = require("../models/Project");
const qa_1 = require("../models/qa");
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
const check = (n, c, d = '') => { c ? pass++ : fail++;  };
async function main() {

    sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).data?.accessToken;
    const branchId = (await call('GET', '/branches')).data?.[0]?._id;
    // throwaway developer + reviewer
    const devEmail = `qaflow.dev.${Date.now()}@gdc.com`;
    const revEmail = `qaflow.rev.${Date.now()}@gdc.com`;
    const devId = (await call('POST', '/employees', { fullName: 'QAFlow Dev', email: devEmail, password: 'Test@12345', role: 'employee', branchId, moduleAccess: { qa: true } })).data._id;
    const revId = (await call('POST', '/employees', { fullName: 'QAFlow Rev', email: revEmail, password: 'Test@12345', role: 'employee', branchId, moduleAccess: { qa: true } })).data._id;
    const dev = (await call('POST', '/auth/login', { email: devEmail, password: 'Test@12345' })).data.accessToken;
    const rev = (await call('POST', '/auth/login', { email: revEmail, password: 'Test@12345' })).data.accessToken;
    // live project owned by the dev → enters QA
    const projId = (await call('POST', '/projects', { type: 'live', name: 'QA Flow Test', ownerId: devId })).data?._id;
    await call('PATCH', `/projects/${projId}/status`, { status: 'development' });
    await call('PATCH', `/projects/${projId}/status`, { status: 'qa' });
    const qa = (await call('GET', '/qa')).data.find((q) => q.projectId?._id === projId);
    check('QA process created on entering QA', !!qa);
    check('both checklists start at 0%', (qa.stage1?.progress || 0) === 0 && (qa.stage2?.progress || 0) === 0, `s1=${qa.stage1?.progress} s2=${qa.stage2?.progress}`);
    // Checklist 1 task created for the developer
    let devTasks = (await call('GET', `/tasks?assignee=${devId}`, undefined, dev)).data || [];
    check('Checklist 1 task on developer board', !!devTasks.find((t) => /Checklist 1/.test(t.title)));
    // developer completes Checklist 1 (as the dev)
    const n1 = qa.stage1.items.length;
    await call('PATCH', `/qa/${qa._id}/stage1/items`, { items: Array.from({ length: n1 }, (_, i) => ({ index: i, checked: true })) }, dev);
    devTasks = (await call('GET', `/tasks?assignee=${devId}`, undefined, dev)).data || [];
    check('Checklist 1 task auto-Done at 100%', devTasks.find((t) => /Checklist 1/.test(t.title))?.status === 'done');
    // assign Checklist 2 to the reviewer
    await call('POST', `/qa/${qa._id}/stage2/assign`, { reviewerId: revId });
    const revTasks = (await call('GET', `/tasks?assignee=${revId}`, undefined, rev)).data || [];
    check('Checklist 2 task appears on reviewer board', !!revTasks.find((t) => /Checklist 2/.test(t.title)));
    // reviewer completes Checklist 2 → project completes
    const n2 = (await call('GET', `/qa/${qa._id}`)).data.stage2.items.length;
    await call('PATCH', `/qa/${qa._id}/stage2/items`, { items: Array.from({ length: n2 }, (_, i) => ({ index: i, checked: true })) }, rev);
    const proj = (await call('GET', `/projects/${projId}`)).data;
    check('project auto-completed after both checklists 100%', proj.status === 'completed' && proj.qaProgress === 100, `status=${proj.status}`);
    // ---- cleanup ----
    await (0, db_1.connectDB)();
    await Task_1.Task.deleteMany({ linkedQaId: qa._id });
    await qa_1.QaProcess.deleteMany({ projectId: projId });
    await Project_1.Project.deleteMany({ _id: projId });
    await User_1.User.deleteMany({ _id: { $in: [devId, revId] } });
    await (0, db_1.disconnectDB)();
   
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=qa-flow.test.js.map