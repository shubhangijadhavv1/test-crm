import crypto from 'crypto'

/**
 * Dependency-free TOTP (RFC 6238) + Base32 (RFC 4648), compatible with
 * Google Authenticator, Authy, 1Password, Microsoft Authenticator, etc.
 * Defaults: SHA-1, 6 digits, 30-second step (what every authenticator app expects).
 */

const STEP = 30 // seconds
const DIGITS = 6
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // RFC 4648 base32

/** Random Base32 secret (default 20 bytes → 160-bit, the RFC-recommended size). */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes))
}

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) continue // skip padding / invalid chars
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** HOTP for an explicit counter (RFC 4226) — the building block for TOTP. */
function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  // 64-bit big-endian counter
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** Current TOTP code for a secret (mainly for tests/tooling). */
export function totp(secret: string, at = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP))
}

/**
 * Verify a user-supplied code, tolerating ±`window` steps of clock drift
 * (default ±1 → accepts the previous, current and next 30-second code).
 */
export function verifyTotp(secret: string, token: string, window = 1, at = Date.now()): boolean {
  const code = (token || '').replace(/\D/g, '')
  if (code.length !== DIGITS) return false
  const counter = Math.floor(at / 1000 / STEP)
  for (let w = -window; w <= window; w++) {
    // constant-time compare to avoid leaking timing on the match
    const expected = hotp(secret, counter + w)
    if (expected.length === code.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
      return true
    }
  }
  return false
}

/** otpauth:// URI that authenticator apps import (via QR or manual entry). */
export function otpauthUri(secret: string, account: string, issuer = 'GDC CRM'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
