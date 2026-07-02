"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerModel = exports.WebsiteType = exports.Subcategory = exports.Category = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const categorySchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const subcategorySchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    categoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Category', index: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const websiteTypeSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const serverSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    provider: String,
    type: { type: String, default: 'cloud' },
    region: String,
    status: { type: String, enum: ['ok', 'warning', 'down'], default: 'ok' },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
// Unique names among active (non-deleted) records; reusable after soft delete.
const activeOnly = { partialFilterExpression: { isDeleted: false } };
categorySchema.index({ name: 1 }, { unique: true, ...activeOnly });
subcategorySchema.index({ categoryId: 1, name: 1 }, { unique: true, ...activeOnly });
websiteTypeSchema.index({ name: 1 }, { unique: true, ...activeOnly });
serverSchema.index({ name: 1 }, { unique: true, ...activeOnly });
exports.Category = (0, mongoose_1.model)('Category', categorySchema);
exports.Subcategory = (0, mongoose_1.model)('Subcategory', subcategorySchema);
exports.WebsiteType = (0, mongoose_1.model)('WebsiteType', websiteTypeSchema);
exports.ServerModel = (0, mongoose_1.model)('Server', serverSchema);
//# sourceMappingURL=catalog.js.map