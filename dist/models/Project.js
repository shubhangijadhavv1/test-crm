"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEMO_TRANSITIONS = exports.STATUS_TRANSITIONS = exports.Project = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const projectSchema = new mongoose_1.Schema({
    projectCode: { type: String },
    type: { type: String, enum: ['live', 'demo'], required: true, index: true },
    name: { type: String, required: true },
    url: String,
    clientName: String,
    categoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Category', index: true },
    subCategoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Subcategory', index: true },
    websiteTypeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'WebsiteType', index: true },
    serverId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Server', index: true },
    ownerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
        type: String,
        enum: ['pending', 'development', 'qa', 'revision', 'completed', 'onhold', 'live', 'finished', 'domain_transfer'],
        default: 'pending',
        index: true,
    },
    qaProgress: { type: Number, default: 0, min: 0, max: 100 },
    startDate: Date,
    dueDate: { type: Date, index: true },
    completedAt: Date,
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    notes: String,
    isOverdue: { type: Boolean, default: false },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
projectSchema.index({ type: 1, status: 1 });
projectSchema.index({ projectCode: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
exports.Project = (0, mongoose_1.model)('Project', projectSchema);
// Allowed status transitions (Blueprint M3 §6 state machine).
// LIVE projects go through the mandatory QA gate.
exports.STATUS_TRANSITIONS = {
    pending: ['development', 'onhold'],
    development: ['qa', 'onhold'],
    qa: ['revision', 'completed', 'onhold'],
    revision: ['qa', 'development', 'onhold'],
    onhold: ['pending', 'development', 'qa'],
    completed: ['revision'],
};
// DEMO projects skip QA entirely (QA is only required for live projects).
exports.DEMO_TRANSITIONS = {
    pending: ['development', 'onhold'],
    development: ['completed', 'revision', 'onhold'],
    revision: ['development', 'completed', 'onhold'],
    onhold: ['pending', 'development'],
    completed: ['revision'],
};
//# sourceMappingURL=Project.js.map