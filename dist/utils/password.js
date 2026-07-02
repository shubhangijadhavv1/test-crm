"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Blueprint A5 specifies Argon2id. bcryptjs is used here for zero-native-build
// portability; swap for `argon2` in production (same hash/verify interface).
async function hashPassword(plain) {
    return bcryptjs_1.default.hash(plain, 12);
}
async function verifyPassword(plain, hash) {
    return bcryptjs_1.default.compare(plain, hash);
}
//# sourceMappingURL=password.js.map