"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 4000),
    mongoUri: process.env.MONGODB_URI || '', // empty => in-memory Mongo
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    // Refresh-cookie policy. Same-site deploy (one domain serves web + API) → 'lax'.
    // Cross-site deploy (api.x.com vs app.x.com) → set COOKIE_SAMESITE=none (requires HTTPS).
    cookie: {
        sameSite: (process.env.COOKIE_SAMESITE || 'lax'),
        // 'none' is invalid without Secure; force secure on when cross-site, else follow NODE_ENV.
        secure: process.env.COOKIE_SECURE
            ? process.env.COOKIE_SECURE === 'true'
            : (process.env.COOKIE_SAMESITE === 'none' || (process.env.NODE_ENV || 'development') === 'production'),
    },
    jwt: {
        accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
        accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
        refreshTtl: process.env.REFRESH_TOKEN_TTL || '7d',
    },
    seed: {
        superAdminEmail: process.env.SEED_SUPERADMIN_EMAIL || 'aarav@gdc.com',
        superAdminPassword: process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@12345',
    },
    vapid: {
        publicKey: process.env.VAPID_PUBLIC_KEY || '',
        privateKey: process.env.VAPID_PRIVATE_KEY || '',
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@gdc-crm.local',
    },
    isProd: (process.env.NODE_ENV || 'development') === 'production',
};
//# sourceMappingURL=env.js.map