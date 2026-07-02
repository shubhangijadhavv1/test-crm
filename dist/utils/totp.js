"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecret = generateSecret;
exports.base32Encode = base32Encode;
exports.base32Decode = base32Decode;
exports.totp = totp;
exports.verifyTotp = verifyTotp;
exports.otpauthUri = otpauthUri;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Dependency-free TOTP (RFC 6238) + Base32 (RFC 4648), compatible with
 * Google Authenticator, Authy, 1Password, Microsoft Authenticator, etc.
 * Defaults: SHA-1, 6 digits, 30-second step (what every authenticator app expects).
 */
const STEP = 30; // seconds
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32
/** Random Base32 secret (default 20 bytes → 160-bit, the RFC-recommended size). */
function generateSecret(bytes = 20) {
    return base32Encode(crypto_1.default.randomBytes(bytes));
}
function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
function base32Decode(input) {
    const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1)
            continue; // skip padding / invalid chars
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}
/** HOTP for an explicit counter (RFC 4226) — the building block for TOTP. */
function hotp(secret, counter) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    // 64-bit big-endian counter
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto_1.default.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const bin = ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}
/** Current TOTP code for a secret (mainly for tests/tooling). */
function totp(secret, at = Date.now()) {
    return hotp(secret, Math.floor(at / 1000 / STEP));
}
/**
 * Verify a user-supplied code, tolerating ±`window` steps of clock drift
 * (default ±1 → accepts the previous, current and next 30-second code).
 */
function verifyTotp(secret, token, window = 1, at = Date.now()) {
    const code = (token || '').replace(/\D/g, '');
    if (code.length !== DIGITS)
        return false;
    const counter = Math.floor(at / 1000 / STEP);
    for (let w = -window; w <= window; w++) {
        // constant-time compare to avoid leaking timing on the match
        const expected = hotp(secret, counter + w);
        if (expected.length === code.length && crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
            return true;
        }
    }
    return false;
}
/** otpauth:// URI that authenticator apps import (via QR or manual entry). */
function otpauthUri(secret, account, issuer = 'GDC CRM') {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(DIGITS),
        period: String(STEP),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
//# sourceMappingURL=totp.js.map