"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccess = signAccess;
exports.signRefresh = signRefresh;
exports.verifyAccess = verifyAccess;
exports.verifyRefresh = verifyRefresh;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
function signAccess(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.env.jwt.accessSecret, { expiresIn: env_1.env.jwt.accessTtl });
}
function signRefresh(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.env.jwt.refreshSecret, { expiresIn: env_1.env.jwt.refreshTtl });
}
function verifyAccess(token) {
    return jsonwebtoken_1.default.verify(token, env_1.env.jwt.accessSecret);
}
function verifyRefresh(token) {
    return jsonwebtoken_1.default.verify(token, env_1.env.jwt.refreshSecret);
}
//# sourceMappingURL=jwt.js.map