"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushSubscription = void 0;
const mongoose_1 = require("mongoose");
/** A browser Web Push subscription (one per device/browser per user). */
const pushSubscriptionSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
    },
    userAgent: String,
}, { timestamps: true, versionKey: false });
exports.PushSubscription = (0, mongoose_1.model)('PushSubscription', pushSubscriptionSchema);
//# sourceMappingURL=push.js.map