"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULE_KEYS = void 0;
exports.defaultModuleAccess = defaultModuleAccess;
exports.sanitizeModuleAccess = sanitizeModuleAccess;
// Canonical module-access keys decided by Super Admin (shared meaning with the client).
exports.MODULE_KEYS = [
    'dashboard', 'noticeBoard', 'projects', 'qa', 'tasks',
    'attendance', 'employees', 'performance', 'monitoring', 'config',
];
const ALL = (v) => Object.fromEntries(exports.MODULE_KEYS.map((k) => [k, v]));
/** Sensible defaults per role when Super Admin doesn't specify. */
function defaultModuleAccess(role) {
    if (role === 'superadmin')
        return ALL(true);
    if (role === 'admin') {
        return { ...ALL(true), monitoring: false }; // admin: broad, no monitoring by default
    }
    // employee: limited self-service set
    return {
        ...ALL(false),
        noticeBoard: true,
        attendance: true,
        tasks: true,
        qa: true,
    };
}
/** Normalise an arbitrary access object to the known keys. */
function sanitizeModuleAccess(input) {
    const obj = (input || {});
    return Object.fromEntries(exports.MODULE_KEYS.map((k) => [k, !!obj[k]]));
}
//# sourceMappingURL=access.js.map