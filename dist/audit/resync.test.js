"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/** Verifies that adding template points AFTER a project is in QA shows up when the
 *  workflow is opened (re-sync of unstarted checklists). Self-cleaning. */
const db_1 = require("../config/db");
const Project_1 = require("../models/Project");
const qa_1 = require("../models/qa");
const Task_1 = require("../models/Task");
const catalog_1 = require("../models/catalog");
const BASE = process.env.AUDIT_BASE || 'http://localhost:4000/api/v1';
let sa = '';
let pass = 0, fail = 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(m, p, body) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(sa ? { Authorization: `Bearer ${sa}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json().catch(() => ({}));
}
const check = (n, c, d = '') => { c ? pass++ : fail++; };
async function main() {
    sa = (await call('POST', '/auth/login', { email: 'aarav@gdc.com', password: 'Admin@12345' })).data?.accessToken;
    const shra = (await call('GET', '/employees?q=Shraddha')).data?.[0]?._id;
    const catId = (await call('POST', '/categories', { name: 'ReSync Cat ' + Date.now() })).data._id;
    // project enters QA BEFORE any points exist → defaults
    const projId = (await call('POST', '/projects', { type: 'live', name: 'ReSync Proj', categoryId: catId, ownerId: shra })).data._id;
    await call('PATCH', `/projects/${projId}/status`, { status: 'development' });
    await call('PATCH', `/projects/${projId}/status`, { status: 'qa' });
    let qa = (await call('GET', `/projects/${projId}/qa`)).data.qa;
    check('starts with default items (no points yet)', qa.stage1.items.some((i) => i.text === 'SEO meta tags & schema'));
    // add points AFTER it's in QA
    await call('POST', '/checklist-points/bulk', { categoryId: catId, appliesTo: 'both', texts: ['ReSync point A', 'ReSync point B'] });
    // re-open the workflow → unstarted checklists re-sync to the new points
    qa = (await call('GET', `/projects/${projId}/qa`)).data.qa;
    const s1 = qa.stage1.items.map((i) => i.text);
    check('checklist re-synced to new template points on open', s1.includes('ReSync point A') && s1.includes('ReSync point B') && !s1.includes('SEO meta tags & schema'), s1.join(', '));
    // cleanup
    await (0, db_1.connectDB)();
    await Task_1.Task.deleteMany({ linkedQaId: qa._id });
    await qa_1.QaProcess.deleteMany({ projectId: projId });
    await Project_1.Project.deleteMany({ _id: projId });
    await qa_1.ChecklistPoint.deleteMany({ categoryId: catId });
    await catalog_1.Category.deleteMany({ _id: catId });
    await (0, db_1.disconnectDB)();
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=resync.test.js.map