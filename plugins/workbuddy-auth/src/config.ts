/**
 * 插件配置形状与缺省收敛。
 * The plugin's config shape and default resolution.
 *
 * schema（宿主契约面）定义在入口 index.ts 照 house 惯例；本模块持有形状、
 * 缺省与校验——非法数值显式抛（misconfiguration fails loud）。
 * The schema (the host contract face) lives in the entry index.ts per house
 * convention; this module owns the shape, defaults and validation — invalid
 * values throw (misconfiguration fails loud).
 *
 * @module @veren/workbuddy-auth/config
 */

/** 配置形状（全可选，缺省在 resolveConfig）。The config shape (all optional; defaults in resolveConfig). */
export interface Config {
  /** 出站身份声称的桌面 App 版本（留空用内置兜底）。The claimed desktop-app version (empty = built-in fallback). */
  readonly appVersion?: string
  /** 出站身份的 CLI 版本段（留空不发该段）。The CLI version token (empty drops the segment). */
  readonly cliVersion?: string
  /** 目录在线刷新的陈旧阈值（毫秒）。Catalog staleness threshold (ms). */
  readonly catalogMaxAgeMs?: number
  /** 一次补全的墙钟上限（毫秒）。Wall-clock ceiling of one completion (ms). */
  readonly requestTimeoutMs?: number
}

/** 解析后的完整配置。The fully resolved config. */
export interface ResolvedConfig {
  readonly identity: { readonly appVersion: string; readonly cliVersion: string }
  readonly catalogMaxAgeMs: number
  readonly requestTimeoutMs: number
}

/** 收敛缺省并校验正数。Resolves defaults and validates positive numbers. */
export function resolveConfig(config: Config): ResolvedConfig {
  const catalogMaxAgeMs = config.catalogMaxAgeMs ?? 600_000
  const requestTimeoutMs = config.requestTimeoutMs ?? 600_000
  if (!Number.isFinite(catalogMaxAgeMs) || catalogMaxAgeMs <= 0) {
    throw new Error(`workbuddy-auth: catalogMaxAgeMs must be positive, got ${String(config.catalogMaxAgeMs)}`)
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(`workbuddy-auth: requestTimeoutMs must be positive, got ${String(config.requestTimeoutMs)}`)
  }
  return {
    identity: { appVersion: config.appVersion ?? '', cliVersion: config.cliVersion ?? '' },
    catalogMaxAgeMs,
    requestTimeoutMs,
  }
}

