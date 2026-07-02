"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initWebPush = initWebPush;
exports.isPushEnabled = isPushEnabled;
exports.sendPush = sendPush;
const web_push_1 = __importDefault(require("web-push"));
const env_1 = require("../config/env");
const push_1 = require("../models/push");
let configured = false;
/** Configure web-push with the VAPID keys (once). Returns false if keys are missing. */
function initWebPush() {
    if (configured)
        return true;
    if (!env_1.env.vapid.publicKey || !env_1.env.vapid.privateKey) {
        console.warn('[push] VAPID keys not configured — browser push disabled');
        return false;
    }
    web_push_1.default.setVapidDetails(env_1.env.vapid.subject, env_1.env.vapid.publicKey, env_1.env.vapid.privateKey);
    configured = true;
    return true;
}
function isPushEnabled() { return configured; }
/**
 * Send a Web Push notification to every subscription a user has. Dead subscriptions
 * (410 Gone / 404) are pruned automatically. Never throws.
 */
async function sendPush(userId, payload) {
    if (!configured && !initWebPush())
        return 0;
    const subs = await push_1.PushSubscription.find({ userId }).lean();
    if (!subs.length)
        return 0;
    const data = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
        try {
            await web_push_1.default.sendNotification({ endpoint: s.endpoint, keys: s.keys }, data);
            sent++;
        }
        catch (e) {
            const code = e.statusCode;
            // 404/410 = expired/unsubscribed; 403 = subscription bound to a stale VAPID key → unusable, drop it
            if (code === 404 || code === 410 || code === 403)
                await push_1.PushSubscription.deleteOne({ _id: s._id });
        }
    }));
    return sent;
}
//# sourceMappingURL=webpush.js.map