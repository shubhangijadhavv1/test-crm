"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const misc_1 = require("../models/misc");
const http_1 = require("../utils/http");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /notifications
router.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const rows = await misc_1.Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = await misc_1.Notification.countDocuments({ userId: req.user.id, read: false });
    (0, http_1.ok)(res, rows, { total: unread });
}));
// PATCH /notifications/:id/read
router.patch('/:id/read', (0, http_1.asyncHandler)(async (req, res) => {
    await misc_1.Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { read: true });
    (0, http_1.ok)(res, { read: true });
}));
// POST /notifications/read-all
router.post('/read-all', (0, http_1.asyncHandler)(async (req, res) => {
    await misc_1.Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
    (0, http_1.ok)(res, { read: true });
}));
exports.default = router;
//# sourceMappingURL=notifications.js.map