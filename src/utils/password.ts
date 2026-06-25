import bcrypt from 'bcryptjs'

// Blueprint A5 specifies Argon2id. bcryptjs is used here for zero-native-build
// portability; swap for `argon2` in production (same hash/verify interface).
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
