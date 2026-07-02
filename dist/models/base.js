"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSchemaOptions = exports.auditFields = void 0;
const mongoose_1 = require("mongoose");
/** Audit fields present on every collection (Blueprint A4). */
exports.auditFields = {
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
};
exports.baseSchemaOptions = {
    timestamps: true, // createdAt, updatedAt
    versionKey: 'version', // optimistic concurrency (Blueprint D1.8)
};
//# sourceMappingURL=base.js.map