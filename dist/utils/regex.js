"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeRegex = safeRegex;
/** Escape a user string for safe use inside a RegExp (prevents regex injection / ReDoS). */
function safeRegex(input, flags = 'i') {
    const escaped = String(input ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
    return new RegExp(escaped, flags);
}
//# sourceMappingURL=regex.js.map