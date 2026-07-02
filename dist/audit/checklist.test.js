"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Checklist points (category/subcategory) seeding + per-stage authority test.
 *   npm run test:checklist     (self-cleaning)
 */
const db_1 = require("../config/db");
const Project_1 = require("../models/Project");
const qa_1 = require("../models/qa");
const Task_1 = require("../models/Task");
const User_1 = require("../models/User");
const catalog_1 = require("../models/catalog");
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
const EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com';
const PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345';
let sa = '', dev = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m, p, body, tok = sa) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}
const check = (n, c, d = '') => { c ? pass++ : fail++; };
async function main() {

    sa = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).json.data?.accessToken;
    const saId = (await call('GET', '/auth/me')).json.data?._id;
    // category + subcategory
    const catId = (await call('POST', '/categories', { name: 'CL Test Cat ' + Date.now() })).json.data._id;
    const subId = (await call('POST', '/subcategories', { name: 'CL Sub', categoryId: catId })).json.data._id;
    // points: category-level (both), sub-level c1, sub-level c2
    await call('POST', '/checklist-points/bulk', { categoryId: catId, appliesTo: 'both', texts: ['Mobile responsive'] });
    await call('POST', '/checklist-points/bulk', { categoryId: catId, subCategoryId: subId, appliesTo: 'c1', texts: ['Dev: lint clean'] });
    await call('POST', '/checklist-points/bulk', { categoryId: catId, subCategoryId: subId, appliesTo: 'c2', texts: ['QA: cross-browser'] });
    check('bulk checklist points created', true);
    // throwaway developer employee
    const devEmail = `cl.dev.${Date.now()}@gdc.com`;
    const devId = (await call('POST', '/employees', { fullName: 'CL Dev', email: devEmail, password: 'Test@12345', role: 'employee', moduleAccess: { qa: true } })).json.data._id;
    dev = (await call('POST', '/auth/login', { email: devEmail, password: 'Test@12345' })).json.data?.accessToken;
    // live project in that category/subcategory, owned by the dev
    const projId = (await call('POST', '/projects', { type: 'live', name: 'CL Proj', categoryId: catId, subCategoryId: subId, ownerId: devId })).json.data._id;
    await call('PATCH', `/projects/${projId}/status`, { status: 'development' });
    await call('PATCH', `/projects/${projId}/status`, { status: 'qa' });
    const qaRes = (await call('GET', `/projects/${projId}/qa`)).json.data;
    const qa = qaRes.qa;
    const s1 = (qa.stage1.items || []).map((i) => i.text);
    const s2 = (qa.stage2.items || []).map((i) => i.text);
    check('Checklist 1 seeded from category+sub points', s1.includes('Mobile responsive') && s1.includes('Dev: lint clean'), s1.join(', '));
    check('Checklist 2 seeded from category+sub points', s2.includes('Mobile responsive') && s2.includes('QA: cross-browser'), s2.join(', '));
    check('c1-only point NOT in Checklist 2', !s2.includes('Dev: lint clean'));
    // a second (non-admin) employee who will be the QA reviewer for Checklist 2
    const revEmail = `cl.rev.${Date.now()}@gdc.com`;
    const revId = (await call('POST', '/employees', { fullName: 'CL Reviewer', email: revEmail, password: 'Test@12345', role: 'employee', moduleAccess: { qa: true } })).json.data._id;
    const rev = (await call('POST', '/auth/login', { email: revEmail, password: 'Test@12345' })).json.data?.accessToken;
    // developer completes Checklist 1
    const n1 = qa.stage1.items.length;
    const t1 = await call('PATCH', `/qa/${qa._id}/stage1/items`, { items: Array.from({ length: n1 }, (_, i) => ({ index: i, checked: true })) }, dev);
    check('developer CAN complete Checklist 1', t1.status === 200);
    // assign Checklist 2 to the reviewer (different employee)
    await call('POST', `/qa/${qa._id}/stage2/assign`, { reviewerId: revId });
    // developer tries Checklist 2 → forbidden
    const t2 = await call('PATCH', `/qa/${qa._id}/stage2/items`, { items: [{ index: 0, checked: true }] }, dev);
    check('developer CANNOT edit Checklist 2 (403)', t2.status === 403, t2.json?.error?.message);
    // reviewer tries Checklist 1 → forbidden
    const r1 = await call('PATCH', `/qa/${qa._id}/stage1/items`, { items: [{ index: 0, checked: false }] }, rev);
    check('reviewer CANNOT edit Checklist 1 (403)', r1.status === 403, r1.json?.error?.message);
    // reviewer CAN edit Checklist 2
    const r2 = await call('PATCH', `/qa/${qa._id}/stage2/items`, { items: [{ index: 0, checked: true }] }, rev);
    check('reviewer CAN edit Checklist 2', r2.status === 200);
    // super admin (not an assigned reviewer) cannot cross-edit either checklist — strict, no override
    const a1 = await call('PATCH', `/qa/${qa._id}/stage1/items`, { items: [{ index: 0, checked: false }] }, sa);
    const a2 = await call('PATCH', `/qa/${qa._id}/stage2/items`, { items: [{ index: 0, checked: false }] }, sa);
    check('non-reviewer admin CANNOT edit Checklist 1 (403)', a1.status === 403);
    check('non-reviewer admin CANNOT edit Checklist 2 (403)', a2.status === 403);
    // ---- cleanup (direct DB) ----
    await (0, db_1.connectDB)();
    await Task_1.Task.deleteMany({ linkedQaId: qa._id });
    await qa_1.QaProcess.deleteMany({ projectId: projId });
    await Project_1.Project.deleteMany({ _id: projId });
    await qa_1.ChecklistPoint.deleteMany({ categoryId: catId });
    await catalog_1.Subcategory.deleteMany({ _id: subId });
    await catalog_1.Category.deleteMany({ _id: catId });
    await User_1.User.deleteMany({ _id: { $in: [devId, revId] } });
    await (0, db_1.disconnectDB)();
   
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=checklist.test.js.map