/**
 * Configuration of the unified API gateway.
 *
 * `resolveConfig` applies every default once, so the gateway and the OpenAPI
 * generator read a fully resolved value and never re-derive one.
 *
 * 统一 API 网关的配置。`resolveConfig` 一次性应用全部默认值，网关与 OpenAPI 生成器
 * 只读已解析值，不再各自推导。
 *
 * @module @veren/admin-api-kernel/config
 */

import z from '@deepseek-ai/schemastery'

/** Plugin configuration. 插件配置。 */
export interface Config {
  /** Path the gateway mounts on. 网关挂载路径。 */
  mountPath?: string
  /** Maximum accepted JSON body size. 可接受的最大 JSON 体积。 */
  maxBodyBytes?: number
  /** Baseline rate limit. 基线限流。 */
  rateLimit?: { window?: number; max?: number }
  /** Extra browser origins allowed to call the API. 允许调用 API 的额外浏览器来源。 */
  trustedOrigins?: string[]
  /** Advertised URL used by generated OpenAPI. 生成的 OpenAPI 使用的对外 URL。 */
  publicUrl?: string
}

export const Config: z<Config> = z.object({
  mountPath: z.string().default('/api'),
  maxBodyBytes: z.natural().default(1_048_576),
  rateLimit: z.object({
    window: z.natural().default(60),
    max: z.natural().default(120),
  }).default(undefined as never),
  trustedOrigins: z.array(z.string()).default([]),
  publicUrl: z.string().default(''),
})

/** Validated configuration with every default applied. 已应用全部默认值的配置。 */
export interface ResolvedConfig {
  /** Mount path. 挂载路径。 */
  readonly mountPath: string
  /** Body ceiling in bytes. 请求体上限（字节）。 */
  readonly maxBodyBytes: number
  /** Baseline rate limit. 基线限流。 */
  readonly rateLimit: { readonly window: number; readonly max: number }
  /** Trusted browser origins. 受信浏览器来源。 */
  readonly trustedOrigins: readonly string[]
  /** Advertised URL, or an empty string. 对外 URL，或空串。 */
  readonly publicUrl: string
}

/**
 * Apply defaults to a validated config.
 *
 * @param config - validated plugin config 已校验插件配置
 * @returns the resolved configuration 解析后的配置
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    mountPath: config.mountPath ?? '/api',
    maxBodyBytes: config.maxBodyBytes ?? 1_048_576,
    rateLimit: { window: config.rateLimit?.window ?? 60, max: config.rateLimit?.max ?? 120 },
    trustedOrigins: config.trustedOrigins ?? [],
    publicUrl: config.publicUrl ?? '',
  }
}
