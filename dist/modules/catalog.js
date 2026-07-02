"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const catalog_1 = require("../models/catalog");
const Project_1 = require("../models/Project");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const ApiError_1 = require("../utils/ApiError");
const audit_1 = require("../utils/audit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const writers = (0, rbac_1.requireRole)('superadmin', 'admin');
// ---------- Categories ----------
const categoryBody = zod_1.z.object({ name: zod_1.z.string().min(1), isActive: zod_1.z.boolean().optional(), sortOrder: zod_1.z.number().optional() });
router.get('/categories', (0, http_1.asyncHandler)(async (_req, res) => {
    const cats = await catalog_1.Category.find({ isDeleted: false }).sort({ sortOrder: 1, name: 1 }).lean();
    const subs = await catalog_1.Subcategory.find({ isDeleted: false }).lean();
    const withSubs = cats.map(c => ({ ...c, subs: subs.filter(s => String(s.categoryId) === String(c._id)) }));
    (0, http_1.ok)(res, withSubs);
}));
router.post('/categories', writers, (0, validate_1.validate)(categoryBody), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await catalog_1.Category.create({ ...req.body, createdBy: req.user.id });
    await (0, audit_1.audit)(req.user, 'category.create', 'Category', doc._id, { after: doc });
    (0, http_1.created)(res, doc);
}));
router.patch('/categories/:id', writers, (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await catalog_1.Category.findByIdAndUpdate(req.params.id, { ...req.body, updatedBy: req.user.id }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Category not found');
    await (0, audit_1.audit)(req.user, 'category.update', 'Category', doc._id, { after: doc });
    (0, http_1.ok)(res, doc);
}));
router.delete('/categories/:id', (0, rbac_1.requireRole)('superadmin'), (0, http_1.asyncHandler)(async (req, res) => {
    const inUse = await Project_1.Project.exists({ categoryId: req.params.id, isDeleted: false });
    if (inUse)
        throw ApiError_1.ApiError.conflict('Category is in use by projects — disable it instead');
    const doc = await catalog_1.Category.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Category not found');
    await (0, audit_1.audit)(req.user, 'category.delete', 'Category', doc._id);
    (0, http_1.ok)(res, { deleted: true });
}));
// ---------- Subcategories ----------
const subBody = zod_1.z.object({ name: zod_1.z.string().min(1), categoryId: zod_1.z.string(), sortOrder: zod_1.z.number().optional() });
router.get('/subcategories', (0, http_1.asyncHandler)(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.categoryId)
        filter.categoryId = req.query.categoryId;
    (0, http_1.ok)(res, await catalog_1.Subcategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean());
}));
router.post('/subcategories', writers, (0, validate_1.validate)(subBody), (0, http_1.asyncHandler)(async (req, res) => {
    const parent = await catalog_1.Category.findOne({ _id: req.body.categoryId, isDeleted: false });
    if (!parent)
        throw ApiError_1.ApiError.badRequest('Parent category does not exist');
    const doc = await catalog_1.Subcategory.create({ ...req.body, createdBy: req.user.id });
    (0, http_1.created)(res, doc);
}));
// POST /subcategories/bulk { categoryId, names:[] } — add many at once (skips blanks & duplicates)
const bulkSubBody = zod_1.z.object({ categoryId: zod_1.z.string(), names: zod_1.z.array(zod_1.z.string()).min(1).max(200) });
router.post('/subcategories/bulk', writers, (0, validate_1.validate)(bulkSubBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { categoryId, names } = req.body;
    const parent = await catalog_1.Category.findOne({ _id: categoryId, isDeleted: false });
    if (!parent)
        throw ApiError_1.ApiError.badRequest('Parent category does not exist');
    const existing = new Set((await catalog_1.Subcategory.find({ categoryId, isDeleted: false }).select('name').lean()).map(s => s.name.toLowerCase()));
    const clean = [...new Set(names.map(n => n.trim()).filter(Boolean))].filter(n => !existing.has(n.toLowerCase()));
    if (!clean.length)
        throw ApiError_1.ApiError.badRequest('No new subcategories to add (all blank or already exist)');
    const docs = await catalog_1.Subcategory.insertMany(clean.map(name => ({ name, categoryId, createdBy: req.user.id })));
    await (0, audit_1.audit)(req.user, 'subcategory.bulk-create', 'Subcategory', categoryId, { after: { added: docs.length } });
    (0, http_1.created)(res, { added: docs.length, names: clean });
}));
router.delete('/subcategories/:id', writers, (0, http_1.asyncHandler)(async (req, res) => {
    const inUse = await Project_1.Project.exists({ subCategoryId: req.params.id, isDeleted: false });
    if (inUse)
        throw ApiError_1.ApiError.conflict('Subcategory is in use by projects — remove it from those projects first');
    const doc = await catalog_1.Subcategory.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Subcategory not found');
    await (0, audit_1.audit)(req.user, 'subcategory.delete', 'Subcategory', doc._id);
    (0, http_1.ok)(res, { deleted: true });
}));
// ---------- Website Types ----------
const typeBody = zod_1.z.object({ name: zod_1.z.string().min(1), isActive: zod_1.z.boolean().optional() });
router.get('/website-types', (0, http_1.asyncHandler)(async (_req, res) => {
    (0, http_1.ok)(res, await catalog_1.WebsiteType.find({ isDeleted: false }).sort({ name: 1 }).lean());
}));
router.post('/website-types', writers, (0, validate_1.validate)(typeBody), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await catalog_1.WebsiteType.create({ ...req.body, createdBy: req.user.id });
    (0, http_1.created)(res, doc);
}));
router.patch('/website-types/:id', writers, (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await catalog_1.WebsiteType.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc)
        throw ApiError_1.ApiError.notFound('Website type not found');
    (0, http_1.ok)(res, doc);
}));
// ---------- Servers ----------
const serverBody = zod_1.z.object({ name: zod_1.z.string().min(1), provider: zod_1.z.string().optional(), region: zod_1.z.string().optional() });
router.get('/servers', (0, http_1.asyncHandler)(async (_req, res) => {
    const servers = await catalog_1.ServerModel.find({ isDeleted: false }).sort({ name: 1 }).lean();
    // attach live/demo/total counts
    const counts = await Project_1.Project.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: { serverId: '$serverId', type: '$type' }, n: { $sum: 1 } } },
    ]);
    const byServer = {};
    for (const c of counts) {
        const sid = String(c._id.serverId);
        byServer[sid] = byServer[sid] || { live: 0, demo: 0 };
        byServer[sid][c._id.type] = c.n;
    }
    (0, http_1.ok)(res, servers.map(s => {
        const c = byServer[String(s._id)] || { live: 0, demo: 0 };
        return { ...s, live: c.live, demo: c.demo, total: c.live + c.demo };
    }));
}));
router.post('/servers', writers, (0, validate_1.validate)(serverBody), (0, http_1.asyncHandler)(async (req, res) => {
    const doc = await catalog_1.ServerModel.create({ ...req.body, createdBy: req.user.id });
    (0, http_1.created)(res, doc);
}));
router.get('/servers/:id/sites', (0, http_1.asyncHandler)(async (req, res) => {
    (0, http_1.ok)(res, await Project_1.Project.find({ serverId: req.params.id, isDeleted: false }).select('name url type status').lean());
}));
exports.default = router;
//# sourceMappingURL=catalog.js.map