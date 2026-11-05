/**
 * 凭证域：口令散列与强度策略（设计文档 modules/04-credential.md）。
 * 默认散列 scrypt（N=16384、r=16、p=1、dkLen=64，16 字节十六进制盐，口令先做
 * NFKC 规范化），存储值为自描述的 `salt:key` 十六进制串；长度校验在散列之前。
 * 等时失败（账号不存在同样散列一次）由调用方在登录链路执行。
 *
 * The credential domain: password hashing and strength policy (design
 * modules/04-credential.md). The default hash is scrypt (N=16384, r=16, p=1,
 * dkLen=64, a 16-byte hex salt, NFKC normalization first) stored as a
 * self-describing `salt:key` hex string; length checks precede hashing. The
 * equal-time failure (hash once even when the account is missing) runs in
 * the caller's sign-in chain.
 *
 * @module @veren/auth-core/credential/password
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/** scrypt 的 promise 形态。 / The promise form of scrypt. */
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number, r: number, p: number, maxmem: number },
) => Promise<Buffer>

/**
 * scrypt 成本参数（取证：兼容性夹具 N=16384, r=16, p=1）。
 * maxmem 必须高于 128*N*r = 32MiB——Node 默认 32MiB 上限会以
 * "memory limit exceeded" 拒绝参数。
 * / The scrypt cost parameters (forensics: fixture N=16384, r=16, p=1).
 * maxmem must exceed 128*N*r = 32MiB — Node's 32MiB default rejects the
 * parameters with "memory limit exceeded".
 */
const SCRYPT_PARAMS = { N: 16384, r: 16, p: 1, maxmem: 96 * 1024 * 1024 } as const
/** 派生密钥长度与盐长度。 / The derived-key length and salt length. */
const KEY_LENGTH = 64
const SALT_LENGTH = 16

/** 口令能力：散列、校验与长度策略。 / The password capability: hash, verify and the length policy. */
export interface PasswordCapability {
  /** 散列；输出 `salt:key`。 / Hash; outputs `salt:key`. */
  hash: (password: string) => Promise<string>
  /** 校验。 / Verify. */
  verify: (data: { hash: string, password: string }) => Promise<boolean>
  /** 强度策略。 / The strength policy. */
  config: { minPasswordLength: number, maxPasswordLength: number }
  /** 散列前的长度判定。 / The pre-hash length verdict. */
  checkPassword: (password: string) => { success: true } | { success: false, code: 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' }
}

/** NFKC 规范化。 / NFKC normalization. */
function normalize(password: string): string {
  return password.normalize('NFKC')
}

/** 默认散列：scrypt → `salt:key` 十六进制串。 / The default hash: scrypt → a `salt:key` hex string. */
export async function defaultHash(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const key = await scrypt(normalize(password), salt, KEY_LENGTH, SCRYPT_PARAMS)
  return `${salt}:${key.toString('hex')}`
}

/** 默认校验：拆 `salt:key`，恒时比较。 / The default verify: split `salt:key`, compare constant-time. */
export async function defaultVerify(data: { hash: string, password: string }): Promise<boolean> {
  const separator = data.hash.indexOf(':')
  if (separator <= 0) return false
  const salt = data.hash.slice(0, separator)
  const expectedHex = data.hash.slice(separator + 1)
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(expectedHex)) return false
  const key = await scrypt(normalize(data.password), salt, expectedHex.length / 2, SCRYPT_PARAMS)
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === key.length && timingSafeEqual(expected, key)
}

/**
 * 装配口令能力：默认实现可被 `options.password.hash/verify` 整体替换；
 * 长度策略在散列前判定（廉价拒绝点）。
 * / Assemble the password capability: the defaults are wholesale replaceable
 * via `options.password.hash/verify`; the length policy precedes hashing
 * (the cheap rejection point).
 */
export function createPasswordCapability(config: {
  minPasswordLength: number
  maxPasswordLength: number
  hash?: (password: string) => Promise<string>
  verify?: (data: { hash: string, password: string }) => Promise<boolean>
}): PasswordCapability {
  return {
    hash: config.hash ?? defaultHash,
    verify: config.verify ?? defaultVerify,
    config: { minPasswordLength: config.minPasswordLength, maxPasswordLength: config.maxPasswordLength },
    checkPassword: (password: string) => {
      if (password.length < config.minPasswordLength) return { success: false, code: 'PASSWORD_TOO_SHORT' }
      if (password.length > config.maxPasswordLength) return { success: false, code: 'PASSWORD_TOO_LONG' }
      return { success: true }
    },
  }
}
