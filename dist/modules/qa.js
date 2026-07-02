"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureQaProcess = ensureQaProcess;
const express_1 = require("express");
const zod_1 = require("zod");
const qa_1 = require("../models/qa");
const Project_1 = require("../models/Project");
const Task_1 = require("../models/Task");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const notify_1 = require("../utils/notify");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const DEFAULT_STAGE1 = ['SEO meta tags & schema', 'Responsive breakpoints', 'Forms & validation', 'Cross-browser render', 'Page speed < 2.5s', 'Broken links scan', 'Image alt text'];
const DEFAULT_STAGE2 = ['Security headers & SSL', 'Accessibility WCAG AA', 'Content proofreading', 'Final UX walkthrough'];
function progressOf(items) {
    if (!items.length)
        return 0;
    return Math.round((items.filter(i => i.checked).length / items.length) * 100);
}
/** Create a linked Task for a checklist stage so it appears on the assignee's board (Blueprint D1.2). Idempotent. */
async function ensureChecklistTask(opts) {
    if (!opts.assigneeId)
        return;
    const title = `Checklist ${opts.stage} — ${opts.projectName || 'project'}`;
    const existing = await Task_1.Task.findOne({ linkedQaId: opts.qaId, title, isDeleted: false });
    if (existing)
        return existing;
    return Task_1.Task.create({
        title, source: 'checklist', linkedQaId: opts.qaId,
        projectId: opts.projectId, projectName: opts.projectName,
        assigneeId: opts.assigneeId, assignerId: opts.assignerId,
        priority: 'high', difficulty: 3, status: 'todo',
        timer: { running: false, accumulatedSeconds: 0 }, branchId: opts.branchId,
    });
}
/** Mark a stage's linked task as Done when the checklist is complete. */
async function completeChecklistTask(qaId, stage, projectName) {
    const title = `Checklist ${stage} — ${projectName || 'project'}`;
    await Task_1.Task.findOneAndUpdate({ linkedQaId: qaId, title, isDeleted: false }, { status: 'done', completedAt: new Date(), 'timer.running': false });
}
/** Resolve checklist items for a project from its category/subcategory points (fallback to defaults). */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function seedItemsFor(project) {
    let c1items = DEFAULT_STAGE1.map(t => ({ text: t }));
    let c2items = DEFAULT_STAGE2.map(t => ({ text: t }));
    if (project?.categoryId) {
        const points = await qa_1.ChecklistPoint.find({
            isActive: true, isDeleted: false, categoryId: project.categoryId,
            $or: [{ subCategoryId: project.subCategoryId || null }, { subCategoryId: null }, { subCategoryId: { $exists: false } }],
        }).sort({ order: 1, createdAt: 1 }).lean();
        if (points.length) {
            const c1 = points.filter(p => p.appliesTo === 'both' || p.appliesTo === 'c1').map(p => ({ text: p.text }));
            const c2 = points.filter(p => p.appliesTo === 'both' || p.appliesTo === 'c2').map(p => ({ text: p.text }));
            if (c1.length)
                c1items = c1;
            if (c2.length)
                c2items = c2;
        }
    }
    return { c1items, c2items };
}
/** Create the QA process for a project if it doesn't exist (called when status → qa).
 *  Both checklists start at 0%. Checklist 1 is assigned to the developer (owner) and a
 *  linked task is created so it appears on their board. */
async function ensureQaProcess(projectId, branchId) {
    const existing = await qa_1.QaProcess.findOne({ projectId });
    if (existing)
        return existing;
    const project = await Project_1.Project.findById(projectId).lean();
    const { c1items, c2items } = await seedItemsFor(project);
    const qa = await qa_1.QaProcess.create({
        projectId,
        branchId: branchId || undefined,
        stage1: { reviewerId: project?.ownerId, status: 'inprogress', items: c1items, progress: 0 },
        stage2: { status: 'notstarted', items: c2items, progress: 0 },
        state: 'stage1',
    });
    if (project?.ownerId) {
        await ensureChecklistTask({ qaId: qa._id, stage: 1, assigneeId: project.ownerId, assignerId: project.createdBy || project.ownerId, projectId, projectName: project.name, branchId: project.branchId });
    }
    return qa;
}
// ----- Checklist templates -----
router.get('/checklist-templates', (0, http_1.asyncHandler)(async (_req, res) => {
    (0, http_1.ok)(res, await qa_1.ChecklistTemplate.find({ isDeleted: false }).lean());
}));
router.post('/checklist-templates', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await qa_1.ChecklistTemplate.create({ ...req.body, createdBy: req.user.id });
    (0, http_1.created)(res, doc);
}));
router.post('/checklist-templates/:id/items', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await qa_1.ChecklistTemplate.findByIdAndUpdate(req.params.id, { $push: { items: { text: req.body.text, appliesTo: req.body.appliesTo || 'both' } } }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Template not found');
    (0, http_1.ok)(res, doc);
}));
// ----- Checklist points (category/subcategory-scoped) -----
// GET /checklist-points?categoryId= — list points, newest grouping done client-side
router.get('/checklist-points', (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.categoryId)
        filter.categoryId = req.query.categoryId;
    if (req.query.subCategoryId)
        filter.subCategoryId = req.query.subCategoryId;
    const rows = await qa_1.ChecklistPoint.find(filter)
        .populate('categoryId', 'name').populate('subCategoryId', 'name')
        .sort({ createdAt: 1 }).lean();
    (0, http_1.ok)(res, rows);
}));
// POST /checklist-points/bulk — { categoryId, subCategoryId?, appliesTo, texts: [] }
const bulkBody = zod_1.z.object({
    categoryId: zod_1.z.string(),
    subCategoryId: zod_1.z.string().optional().nullable(),
    appliesTo: zod_1.z.enum(['both', 'c1', 'c2']).default('both'),
    texts: zod_1.z.array(zod_1.z.string().min(1)).min(1),
});
router.post('/checklist-points/bulk', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, validate_1.validate)(bulkBody), (0, http_1.asyncHandler)(async (req, res) => {
    const b = req.body;
    const base = await qa_1.ChecklistPoint.countDocuments({ categoryId: b.categoryId });
    const docs = await qa_1.ChecklistPoint.insertMany(b.texts.map((text, i) => ({
        categoryId: b.categoryId, subCategoryId: b.subCategoryId || undefined,
        text: text.trim(), appliesTo: b.appliesTo, order: base + i, createdBy: req.user.id,
    })));
    await (0, audit_1.audit)(req.user, 'checklist.points.add', 'ChecklistPoint', b.categoryId, { after: { count: docs.length, appliesTo: b.appliesTo } });
    (0, http_1.created)(res, docs);
}));
router.delete('/checklist-points/:id', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await qa_1.ChecklistPoint.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Checklist point not found');
    (0, http_1.ok)(res, { deleted: true });
}));
// ----- Checklist templates (legacy) -----
// ----- QA register -----
router.get('/qa', (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.state)
        filter.state = req.query.state;
    const rows = await qa_1.QaProcess.find(filter)
        .populate({ path: 'projectId', select: 'name url type categoryId', populate: { path: 'categoryId', select: 'name' } })
        .populate('stage1.reviewerId', 'fullName')
        .populate('stage2.reviewerId', 'fullName')
        .lean();
    (0, http_1.ok)(res, rows);
}));
router.get('/qa/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await qa_1.QaProcess.findById(req.params.id).populate('projectId', 'name url').lean();
    if (!doc)
        throw ApiError_1.ApiError.notFound('QA process not found');
    (0, http_1.ok)(res, doc);
}));
// GET /projects/:id/qa — a project + its QA process (or null) for the QA workflow screen.
// Re-syncs any checklist that hasn't been started yet (progress 0) from the latest
// category/subcategory template points, so newly added points always show.
router.get('/projects/:id/qa', (0, http_1.asyncHandler)(async (req, res) => {
    const project = await Project_1.Project.findOne({ _id: req.params.id, isDeleted: false })
        .select('name url type status ownerId categoryId subCategoryId').populate('ownerId', 'fullName').lean();
    if (!project)
        throw ApiError_1.ApiError.notFound('Project not found');
    const doc = await qa_1.QaProcess.findOne({ projectId: req.params.id });
    if (doc) {
        const { c1items, c2items } = await seedItemsFor(project);
        let changed = false;
        const sig = (items) => (items || []).map((i) => i.text).join('|');
        if ((doc.stage1?.progress || 0) === 0 && sig(doc.stage1.items) !== sig(c1items)) {
            doc.stage1.items = c1items;
            changed = true;
        }
        if ((doc.stage2?.progress || 0) === 0 && sig(doc.stage2.items) !== sig(c2items)) {
            doc.stage2.items = c2items;
            changed = true;
        }
        if (changed)
            await doc.save();
    }
    const qa = await qa_1.QaProcess.findOne({ projectId: req.params.id })
        .populate('stage1.reviewerId', 'fullName')
        .populate('stage2.reviewerId', 'fullName')
        .lean();
    (0, http_1.ok)(res, { project, qa: qa || null });
}));
// POST /projects/:id/qa — start QA explicitly
router.post('/projects/:id/qa', (0, rbac_1.requireRole)('superadmin', 'admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const project = await Project_1.Project.findById(req.params.id);
    if (!project)
        throw ApiError_1.ApiError.notFound('Project not found');
    if (project.type === 'demo')
        throw ApiError_1.ApiError.badRequest('QA is only required for live projects — demo projects skip QA');
    if (!project.ownerId)
        throw ApiError_1.ApiError.badRequest('Assign an owner before starting QA');
    const qa = await ensureQaProcess(String(project._id), project.branchId ? String(project.branchId) : null);
    (0, http_1.created)(res, qa);
}));
const itemsBody = zod_1.z.object({ items: zod_1.z.array(zod_1.z.object({ index: zod_1.z.number(), checked: zod_1.z.boolean(), status: zod_1.z.enum(['pending', 'pass', 'fail', 'na']).optional(), failComment: zod_1.z.string().optional() })) });
// Strict: ONLY the assigned reviewer of a stage may tick it — no cross-editing, no admin override.
// (Checklist 1 = the developer/owner; Checklist 2 = the independent reviewer.)
/* eslint-disable @typescript-eslint/no-explicit-any */
function canEditStage(user, qa, stage) {
    if (!user)
        return false;
    const reviewer = stage === 1 ? qa.stage1?.reviewerId : qa.stage2?.reviewerId;
    return !!reviewer && String(reviewer) === user.id;
}
// PATCH /qa/:id/stage1/items
router.patch('/qa/:id/stage1/items', (0, validate_1.validate)(itemsBody), (0, http_1.asyncHandler)(async (req, res) => {
    const qa = await qa_1.QaProcess.findById(req.params.id);
    if (!qa)
        throw ApiError_1.ApiError.notFound('QA process not found');
    if (!canEditStage(req.user, qa, 1))
        throw ApiError_1.ApiError.forbidden('Only the assigned developer can complete Checklist 1');
    const stage = qa.stage1;
    for (const u of req.body.items) {
        const item = stage.items[u.index];
        if (!item)
            continue;
        item.checked = u.checked;
        item.checkedAt = u.checked ? new Date() : undefined;
        if (u.status)
            item.status = u.status;
    }
    stage.progress = progressOf(stage.items);
    stage.status = stage.progress === 100 ? 'done' : 'inprogress';
    if (stage.progress === 100) {
        stage.completedAt = new Date();
        qa.state = 'stage2_ready';
        const proj = await Project_1.Project.findById(qa.projectId).select('name').lean();
        await completeChecklistTask(qa._id, 1, proj?.name); // checklist 1 task → Done
    }
    else {
        qa.state = 'stage1';
    }
    await qa.save();
    await (0, audit_1.audit)(req.user, 'qa.stage1.tick', 'QaProcess', qa._id, { after: { progress: stage.progress } });
    (0, http_1.ok)(res, qa);
}));
// POST /qa/:id/stage2/assign — gated: stage1=100 and reviewer ≠ developer
const assignBody = zod_1.z.object({ reviewerId: zod_1.z.string() });
router.post('/qa/:id/stage2/assign', (0, validate_1.validate)(assignBody), (0, http_1.asyncHandler)(async (req, res) => {
    const qa = await qa_1.QaProcess.findById(req.params.id);
    if (!qa)
        throw ApiError_1.ApiError.notFound('QA process not found');
    if ((qa.stage1?.progress || 0) !== 100)
        throw ApiError_1.ApiError.badRequest('Checklist 1 must reach 100% before assigning Checklist 2');
    const { reviewerId } = req.body;
    if (String(qa.stage1?.reviewerId) === reviewerId)
        throw ApiError_1.ApiError.badRequest('Checklist 2 reviewer must be different from the developer');
    qa.stage2.reviewerId = reviewerId;
    qa.stage2.status = 'inprogress';
    qa.state = 'stage2_inprogress';
    await qa.save();
    // Linked task so Checklist 2 appears on the reviewer's Task Board.
    const proj = await Project_1.Project.findById(qa.projectId).select('name branchId').lean();
    await ensureChecklistTask({ qaId: qa._id, stage: 2, assigneeId: reviewerId, assignerId: req.user.id, projectId: qa.projectId, projectName: proj?.name, branchId: proj?.branchId });
    await (0, notify_1.notify)(reviewerId, { type: 'qa.stage2_assigned', title: 'Checklist 2 assigned', body: `Independent QA review for ${proj?.name || 'a project'}`, color: 'brand' });
    await (0, audit_1.audit)(req.user, 'qa.stage2.assign', 'QaProcess', qa._id, { after: { reviewerId } });
    (0, http_1.ok)(res, qa);
}));
// PATCH /qa/:id/stage2/items
router.patch('/qa/:id/stage2/items', (0, validate_1.validate)(itemsBody), (0, http_1.asyncHandler)(async (req, res) => {
    const qa = await qa_1.QaProcess.findById(req.params.id);
    if (!qa)
        throw ApiError_1.ApiError.notFound('QA process not found');
    if ((qa.stage1?.progress || 0) !== 100)
        throw ApiError_1.ApiError.badRequest('Checklist 1 is not complete');
    if (!canEditStage(req.user, qa, 2))
        throw ApiError_1.ApiError.forbidden('Only the assigned Checklist 2 reviewer can complete it — the developer cannot');
    const stage = qa.stage2;
    for (const u of req.body.items) {
        const item = stage.items[u.index];
        if (!item)
            continue;
        item.checked = u.checked;
        if (u.status)
            item.status = u.status;
    }
    stage.progress = progressOf(stage.items);
    if (stage.progress === 100) {
        // Both checklists complete → QA passed → live project auto-completes.
        stage.status = 'done';
        stage.completedAt = new Date();
        qa.state = 'passed';
        const proj = await Project_1.Project.findByIdAndUpdate(qa.projectId, { qaProgress: 100, status: 'completed', completedAt: new Date() }, { new: true }).select('name').lean();
        await completeChecklistTask(qa._id, 2, proj?.name); // checklist 2 task → Done
    }
    else {
        stage.status = 'inprogress';
        // QA reopened/incomplete → ensure project isn't marked completed
        await Project_1.Project.findByIdAndUpdate(qa.projectId, { qaProgress: stage.progress });
    }
    await qa.save();
    (0, http_1.ok)(res, qa);
}));
exports.default = router;
//# sourceMappingURL=qa.js.map