"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const express_mongo_sanitize_1 = __importDefault(require("express-mongo-sanitize"));
const env_1 = require("./config/env");
const http_1 = require("./utils/http");
const error_1 = require("./middleware/error");
const auth_1 = __importDefault(require("./modules/auth"));
const catalog_1 = __importDefault(require("./modules/catalog"));
const branches_1 = __importDefault(require("./modules/branches"));
const employees_1 = __importDefault(require("./modules/employees"));
const projects_1 = __importDefault(require("./modules/projects"));
const qa_1 = __importDefault(require("./modules/qa"));
const tasks_1 = __importDefault(require("./modules/tasks"));
const attendance_1 = __importDefault(require("./modules/attendance"));
const agent_1 = __importDefault(require("./modules/agent"));
const performance_1 = __importDefault(require("./modules/performance"));
const leave_1 = __importDefault(require("./modules/leave"));
const announcements_1 = __importDefault(require("./modules/announcements"));
const notifications_1 = __importDefault(require("./modules/notifications"));
const dashboard_1 = __importDefault(require("./modules/dashboard"));
const push_1 = __importDefault(require("./modules/push"));
function createApp() {
    const app = (0, express_1.default)();
    app.set('trust proxy', true); // honour X-Forwarded-For so req.ip is the real client IP
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: false,
        crossOriginOpenerPolicy: false,
        originAgentCluster: false,
    }));
    app.use((0, cors_1.default)({ origin: (origin, cb) => cb(null, true), credentials: true }));
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use((0, cookie_parser_1.default)());
    app.use((0, express_mongo_sanitize_1.default)()); // strip $ / . from body, query & params → blocks NoSQL operator injection
    if (!env_1.env.isProd)
        app.use((0, morgan_1.default)('dev'));
    // Stricter limit on auth endpoints (Blueprint A5)
    app.use('/api/v1/auth', (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false }));
    app.use('/api/v1', (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
    app.get('/health', (_req, res) => (0, http_1.ok)(res, { status: 'ok', ts: Date.now() }));
    // Serve uploaded screenshots (cross-origin images allowed for the dashboard).
    app.use('/uploads', helmet_1.default.crossOriginResourcePolicy({ policy: 'cross-origin' }), express_1.default.static('uploads'));
    const api = express_1.default.Router();
    api.use('/auth', auth_1.default);
    api.use('/', catalog_1.default); // /categories, /subcategories, /website-types, /servers
    api.use('/branches', branches_1.default);
    api.use('/employees', employees_1.default);
    api.use('/projects', projects_1.default);
    api.use('/', qa_1.default); // /checklist-templates, /qa, /projects/:id/qa
    api.use('/tasks', tasks_1.default);
    api.use('/attendance', attendance_1.default);
    api.use('/agent', agent_1.default);
    api.use('/performance', performance_1.default);
    api.use('/leaves', leave_1.default);
    api.use('/announcements', announcements_1.default);
    api.use('/notifications', notifications_1.default);
    api.use('/dashboard', dashboard_1.default);
    api.use('/push', push_1.default);
    app.use('/api/v1', api);
    // Serve frontend files from the 'dist' directory
    app.use(express_1.default.static(path_1.default.join(__dirname, 'dist')));
    // Handle SPA routing: redirect all non-API requests to index.html
    app.get('*', (req, res, next) => {
        if (req.originalUrl.startsWith('/api')) {
            return next();
        }
        res.sendFile(path_1.default.join(__dirname, 'dist', 'index.html'));
    });
    app.use(error_1.notFound);
    app.use(error_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map