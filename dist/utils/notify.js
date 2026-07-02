"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
const misc_1 = require("../models/misc");
const socket_1 = require("../realtime/socket");
const webpush_1 = require("../services/webpush");
/** Create an in-app notification, push over WebSocket, and fan out to browser Web Push (Module 13). */
async function notify(userId, data) {
    const doc = await misc_1.Notification.create({ userId, read: false, ...data });
    (0, socket_1.emitToUser)(String(userId), 'notification:new', doc);
    // Background browser push (works even when the CRM tab is closed). Fire-and-forget.
    (0, webpush_1.sendPush)(String(userId), data).catch(() => { });
    return doc;
}
//# sourceMappingURL=notify.js.map