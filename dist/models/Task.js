"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Task = void 0;
const mongoose_1 = require("mongoose");
const base_1 = require("./base");
const taskSchema = new mongoose_1.Schema({
    title: { type: String, required: true },
    description: String,
    projectId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Project', index: true },
    projectName: String, // denormalised label (prototype shows the short name)
    assigneeId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    assignerId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    difficulty: { type: Number, min: 1, max: 5, default: 2 },
    status: { type: String, enum: ['todo', 'inprogress', 'done', 'overdue'], default: 'todo', index: true },
    dueAt: { type: Date, index: true },
    timer: {
        running: { type: Boolean, default: false },
        startedAt: Date,
        accumulatedSeconds: { type: Number, default: 0 },
    },
    actualSeconds: { type: Number, default: 0 },
    completedAt: Date,
    reminderSentAt: Date, // T-24h deadline reminder guard (one per task)
    source: { type: String, enum: ['manual', 'checklist'], default: 'manual' },
    linkedQaId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'QaProcess' },
    branchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Branch', index: true },
    ...base_1.auditFields,
}, base_1.baseSchemaOptions);
taskSchema.index({ assigneeId: 1, status: 1 });
taskSchema.index({ status: 1, dueAt: 1 });
exports.Task = (0, mongoose_1.model)('Task', taskSchema);
//# sourceMappingURL=Task.js.map