/**
 * 密钥装配（设计文档 modules/01-context.md 决策 3/4）。
 * 单值 `secret` 与版本数组 `secrets` 归一为 `secretConfig`：新加密只用当前
 * 版本（数组首项），旧版本保留为解密专用，`legacySecret` 兜底旧格式裸载荷。
 * 装配失败必须响亮失败：空数组、版本重复、版本非法、生产环境缺密钥一律抛错。
 *
 * Secret assembly (design modules/01-context.md decisions 3/4). Single
 * `secret` and versioned `secrets` normalize into `secretConfig`: new
 * encryption uses the current version (first entry), older versions stay for
 * decryption, `legacySecret` covers legacy bare payloads. Assembly fails
 * loud: empty arrays, duplicate or invalid versions, and a missing secret in
 * production all throw.
 *
 * @module @veren/auth-core/context/secret
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** 多版本密钥配置。 / The versioned secret config. */
export interface SecretConfig {
  /** 版本号 → 密钥值。 / Version number → secret value. */
  keys: Map<number, string>
  /** 新加密使用的版本（secrets 数组首项）。 / The version new encryption uses (first secrets entry). */
  currentVersion: number
  /** 旧格式裸载荷的兼容密钥。 / The legacy bare-payload fallback key. */
  legacySecret?: string
}

/** 归一后的密钥产物。 / The normalized secret product. */
export interface ResolvedSecret {
  /** 当前密钥（签名/散列用）。 / The current secret (for signing/hashing). */
  secret: string
  /** 单值为字符串，多版本为 SecretConfig。 / A string when single, a SecretConfig when versioned. */
  config: string | SecretConfig
}

/** 校验版本数组：空数组、版本重复、版本非法、空值一律抛错。 / Validate the version array: empty, duplicate, invalid versions and empty values all throw. */
function validateSecrets(secrets: ReadonlyArray<{ version: number, value: string }>): void {
  if (secrets.length === 0) throw new Error('auth-core: secrets must not be an empty array')
  const versions = new Set<number>()
  for (const entry of secrets) {
    if (!Number.isInteger(entry.version) || entry.version < 1) {
      throw new Error(`auth-core: secret version must be a positive integer, got ${String(entry.version)}`)
    }
    if (versions.has(entry.version)) {
      throw new Error(`auth-core: duplicate secret version ${String(entry.version)}`)
    }
    if (typeof entry.value !== 'string' || entry.value.length < 32) {
      throw new Error(`auth-core: secret value for version ${String(entry.version)} must be a 32+ character string`)
    }
    versions.add(entry.version)
  }
}

/**
 * 解析密钥：`secrets` 在位时构建多版本配置，否则沿用单值；生产环境缺密钥
 * 直接抛错，绝不以默认密钥上线（决策 4）。
 * / Resolve the secret: build a versioned config when `secrets` is present,
 * else keep the single value; a missing secret in production throws and the
 * framework never ships on a default secret (decision 4).
 */
export function resolveSecret(options: {
  secret?: string
  secrets?: Array<{ version: number, value: string }>
  legacySecret?: string
  isProduction: boolean
}): ResolvedSecret {
  if (options.secrets !== undefined && options.secrets !== null) {
    validateSecrets(options.secrets)
    const keys = new Map(options.secrets.map((entry) => [entry.version, entry.value]))
    return { secret: options.secrets[0]?.value ?? '', config: { keys, currentVersion: options.secrets[0]?.version ?? 1, legacySecret: options.legacySecret } }
  }
  const secret = options.legacySecret ?? options.secret ?? ''
  if (secret === '' && options.isProduction) {
    throw new Error('auth-core: set options.secret (32+ characters) — refusing to assemble without a signing secret in production')
  }
  return { secret, config: secret }
}

/** 当前版本密钥的 HMAC 签名。 / HMAC-sign with the current-version key. */
export function signWithSecret(config: string | SecretConfig, payload: string): string {
  const key = typeof config === 'string' ? config : config.keys.get(config.currentVersion) ?? ''
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** 用任一版本密钥尝试 HMAC 校验（密钥轮换期旧凭据仍可验）。 / Verify an HMAC against any version key (rotation keeps old credentials valid). */
export function verifyWithSecret(config: string | SecretConfig, payload: string, signature: string): boolean {
  const candidates = typeof config === 'string' ? [config] : [...config.keys.values(), ...(config.legacySecret !== undefined ? [config.legacySecret] : [])]
  const provided = Buffer.from(signature, 'base64url')
  return candidates.some((key) => {
    const candidate = createHmac('sha256', key).update(payload).digest()
    return provided.length === candidate.length && timingSafeEqual(provided, candidate)
  })
}
