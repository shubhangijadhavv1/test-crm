"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QaProcess = exports.ChecklistPoint = exports.ChecklistTemplate = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const checklistTemplateSchema = new mongoose_1.Schema({
    category: { type: String, index: true },
    name: String,
    color: String,
    items: [
        {
            text: String,
            appliesTo: { type: String, enum: ['both', 'c1', 'c2'], default: 'both' },
            order: Number,
        },
    ],
    isActive: { type: Boolean, default: true },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
// Category/subcategory-scoped checklist points that seed a project's QA checklists.
// subCategoryId null/absent = applies to all subcategories of the category.
const checklistPointSchema = new mongoose_1.Schema({
    categoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Category', index: true },
    subCategoryId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Subcategory', index: true },
    text: { type: String, required: true },
    appliesTo: { type: String, enum: ['both', 'c1', 'c2'], default: 'both' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
const stageItem = {
    templateItemId: mongoose_1.Schema.Types.ObjectId,
    text: String,
    checked: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'pass', 'fail', 'na'], default: 'pending' },
    failComment: String,
    checkedAt: Date,
};
const stageSchema = {
    reviewerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['notstarted', 'inprogress', 'done', 'failed'], default: 'notstarted' },
    items: [stageItem],
    progress: { type: Number, default: 0 },
    completedAt: Date,
};
const qaProcessSchema = new mongoose_1.Schema({
    projectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Project' },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch' },
    stage1: stageSchema,
    stage2: stageSchema,
    state: {
        type: String,
        enum: ['stage1', 'stage2_locked', 'stage2_ready', 'stage2_inprogress', 'passed'],
        default: 'stage1',
        index: true,
    },
    failures: [
        {
            stage: Number,
            text: String,
            comment: String,
            reviewerId: mongoose_1.Schema.Types.ObjectId,
            at: Date,
        },
    ],
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
// one QA process per project, reusable after soft delete
qaProcessSchema.index({ projectId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
exports.ChecklistTemplate = (0, mongoose_1.model)('ChecklistTemplate', checklistTemplateSchema);
exports.ChecklistPoint = (0, mongoose_1.model)('ChecklistPoint', checklistPointSchema);
exports.QaProcess = (0, mongoose_1.model)('QaProcess', qaProcessSchema);
//# sourceMappingURL=qa.js.map