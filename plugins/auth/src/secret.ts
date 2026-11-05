/**
 * The durable signing secret for the auth framework: it lives in the official
 * `ctx.credentials` service (never in plain config) and is minted once on
 * first use.
 * 认证框架的持久签名秘密：保存在官方 `ctx.credentials` 服务中（绝不写入明文
 * 配置），首次使用时铸造一次。
 * @module src/secret
 */

import { randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

/** Credential record holding the signing secret. 保存签名秘密的凭据记录。 */
const SECRET_RECORD = credentialKey('web-login-gate', 'auth-core-secret')

const SECRET_BYTES = 32
/** Stored payload version; a mismatch fails the load instead of guessing. 存储载荷版本；不匹配则加载失败而非猜测。 */
const SECRET_VERSION = 1

/** Extract and validate the secret text from a credential record. 从凭据记录提取并校验秘密文本。 */
function secretOf(record: { kind: string, payload?: unknown } | undefined): string {
  if (record === undefined || record.kind !== 'grant') {
    throw new Error('web-login-gate: the auth secret credential record has an unsupported kind')
  }
  const payload = record.payload as { version?: unknown, secret?: unknown }
  if (payload.version !== SECRET_VERSION || typeof payload.secret !== 'string'
    || payload.secret.length < SECRET_BYTES) {
    throw new Error('web-login-gate: the auth secret credential record has an invalid payload')
  }
  return payload.secret
}

/**
 * Load the durable signing secret, minting one on first use.
 * @param credentials - The official credential provider of this harness home.
 * @returns the secret string for the auth assembly.
 */
export async function loadAuthSecret(credentials: CredentialProvider): Promise<string> {
  const record = await credentials.modifyRecord(SECRET_RECORD, (current) => {
    if (current !== undefined) return Promise.resolve(undefined)
    return Promise.resolve({
      kind: 'grant',
      payload: { version: SECRET_VERSION, secret: randomBytes(SECRET_BYTES).toString('base64url') },
    })
  })
  return secretOf(record)
}
