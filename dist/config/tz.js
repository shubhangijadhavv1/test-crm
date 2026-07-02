"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_TZ = void 0;
// Force the server's timezone so ALL local-time math — shift start, late marks, expected
// logout, daily boundaries — is computed in one consistent zone: India (Asia/Kolkata) by
// default. This makes results identical whether the server runs locally (IST) or in a cloud
// region (UTC). Must be imported FIRST, before anything touches Date.
// Override with GDC_TZ if you ever need a different zone.
process.env.TZ = process.env.GDC_TZ || 'Asia/Kolkata';
exports.SERVER_TZ = process.env.TZ;
//# sourceMappingURL=tz.js.map