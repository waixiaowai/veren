/**
 * 校验令牌：HS256 紧凑 JWS（设计文档 api.md API-05-05）。
 * 载荷携带邮箱、用途与过期；令牌过期报 TOKEN_EXPIRED，签名不符报
 * INVALID_TOKEN。改邮箱两步流程经 `updateTo` 区分确认与落地两阶段。
 *
 * Verification tokens: compact HS256 JWS (design api.md API-05-05). The
 * payload carries the email, purpose and expiry; expiry answers
 * TOKEN_EXPIRED, a signature mismatch answers INVALID_TOKEN. The two-step
 * email change distinguishes confirm from commit via `updateTo`.
 *
 * @module @veren/auth-core/routes/email-token
 */

import { signWithSecret, verifyWithSecret } from '../context/secret.ts'
import type { SecretConfig } from '../context/secret.ts'

/** 令牌载荷。 / The token payload. */
export interface EmailTokenPayload {
  /** 目标邮箱（小写）。 / The target email (lowercased). */
  email: string
  /** 改邮箱两步流程的目标地址。 / The two-step email-change target. */
  updateTo?: string
  /** 过期（毫秒时间）。 / Expiry (epoch millis). */
  exp: number
}

/** base64url 编码。 / base64url encoding. */
function encodeB64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/** base64url 解码。 / base64url decoding. */
function decodeB64(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

/** 签发校验令牌。 / Sign a verification token. */
export function signEmailToken(config: string | SecretConfig, payload: Omit<EmailTokenPayload, 'exp'>, lifetimeSeconds: number): string {
  const body = encodeB64(JSON.stringify({ ...payload, exp: Date.now() + lifetimeSeconds * 1000 }))
  const head = encodeB64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  return `${head}.${body}.${signWithSecret(config, `${head}.${body}`)}`
}

/** 校验产物。 / The verification verdict. */
export type EmailTokenVerdict = EmailTokenPayload | 'expired' | null

/** 校验令牌：签名不符 null，过期 'expired'。 / Verify: null on signature mismatch, 'expired' past due. */
export function verifyEmailToken(config: string | SecretConfig, token: string): EmailTokenVerdict {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, signature] = parts as [string, string, string]
  if (!verifyWithSecret(config, `${head}.${body}`, signature)) return null
  let payload: EmailTokenPayload
  try {
    payload = JSON.parse(decodeB64(body)) as EmailTokenPayload
  } catch {
    return null
  }
  if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp < Date.now()) return 'expired'
  return payload
}
