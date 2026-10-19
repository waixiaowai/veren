/**
 * Password hashing and opaque-token helpers built on Node's crypto module.
 *
 * Passwords use scrypt with a per-record salt; session and API-token secrets
 * are stored only as SHA-256 hashes, so a leaked database cannot be replayed as
 * a login. Comparisons are constant-time.
 *
 * 基于 Node crypto 的口令散列与不透明令牌工具。口令使用带逐记录盐的 scrypt；会话与
 * API token 密钥只存 SHA-256 散列，因此数据库泄漏也无法被重放为登录。比较为常量时间。
 *
 * @module @veren/admin-auth-local/passwords
 */

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/** Promisified scrypt. Promise 化的 scrypt。 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>

/** Derived key length in bytes. 派生密钥长度（字节）。 */
const KEY_LENGTH = 64

/** Salt length in bytes. 盐长度（字节）。 */
const SALT_LENGTH = 16

/**
 * Hash one password as `scrypt$<saltHex>$<keyHex>`.
 *
 * @param password - plaintext password 明文口令
 * @returns the stored hash string 存储用的散列串
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

/**
 * Verify one password against a stored hash in constant time.
 *
 * @param password - plaintext candidate 明文候选口令
 * @param stored - stored hash from {@link hashPassword} 存储的散列
 * @returns whether the password matches 口令是否匹配
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || saltHex === undefined || keyHex === undefined) return false
  const expected = Buffer.from(keyHex, 'hex')
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length || KEY_LENGTH)
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

/**
 * Generate one opaque random token.
 *
 * @param bytes - entropy in bytes 熵字节数
 * @returns a URL-safe random string URL 安全的随机串
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Hash a token for storage and lookup.
 *
 * @param token - the presented secret 提交的密钥
 * @returns its SHA-256 hex digest 其 SHA-256 十六进制摘要
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
