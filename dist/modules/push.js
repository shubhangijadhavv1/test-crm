"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const push_1 = require("../models/push");
const env_1 = require("../config/env");
const http_1 = require("../utils/http");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const webpush_1 = require("../services/webpush");
const router = (0, express_1.Router)();
// Public: the VAPID public key the browser needs to subscribe.
router.get('/vapid', (_req, res) => (0, http_1.ok)(res, { publicKey: env_1.env.vapid.publicKey }));
router.use(auth_1.requireAuth);
const subBody = zod_1.z.object({
    endpoint: zod_1.z.string().url(),
    keys: zod_1.z.object({ p256dh: zod_1.z.string(), auth: zod_1.z.string() }),
});
// Save / refresh this browser's push subscription for the current user.
router.post('/subscribe', (0, validate_1.validate)(subBody), (0, http_1.asyncHandler)(async (req, res) => {
    const { endpoint, keys } = req.body;
    await push_1.PushSubscription.findOneAndUpdate({ endpoint }, { userId: req.user.id, endpoint, keys, userAgent: req.headers['user-agent'] }, { upsert: true, new: true, setDefaultsOnInsert: true });
    (0, http_1.ok)(res, { subscribed: true });
}));
// Remove this browser's subscription.
router.post('/unsubscribe', (0, http_1.asyncHandler)(async (req, res) => {
    const endpoint = req.body.endpoint;
    if (endpoint)
        await push_1.PushSubscription.deleteOne({ endpoint, userId: req.user.id });
    (0, http_1.ok)(res, { unsubscribed: true });
}));
// Send a test push to the current user (verifies the whole pipeline).
router.post('/test', (0, http_1.asyncHandler)(async (req, res) => {
    const sent = await (0, webpush_1.sendPush)(req.user.id, { type: 'test', title: 'GDC CRM', body: 'Push notifications are working 🎉', link: '/' });
    (0, http_1.ok)(res, { sent });
}));
exports.default = router;
//# sourceMappingURL=push.js.map