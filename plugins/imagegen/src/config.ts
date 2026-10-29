/**
 * 插件配置：付费门、端点根、模型与超时。所有字段可选，缺省值集中在
 * resolveConfig；`enabled` 默认 false 是成本治理底线——安装不等于授权付费。
 * Plugin configuration: the paid-call gate, endpoint root, model, and timeouts.
 * Every field is optional with defaults centralized in resolveConfig; `enabled`
 * defaults to false as the cost-governance floor — installing is not consenting
 * to paid calls.
 *
 * @module @veren/imagegen
 */

/** 插件配置形状（z 契约在 index.ts 单处声明）。The plugin config shape (the z contract is declared once in index.ts). */
export interface Config {
  /** 付费门：缺省 false，未开启时工具一律 IMAGEGEN_DISABLED。Paid gate: false by default; tools refuse with IMAGEGEN_DISABLED until on. */
  enabled?: boolean
  /** OpenAI 兼容 Images API 根。OpenAI-compatible Images API root. */
  baseURL?: string
  /** 缺省图像模型。Default image model. */
  model?: string
  /** 单次请求超时（图像生成可达数分钟）。Per-request timeout (image generation can take minutes). */
  requestTimeoutMs?: number
  /** 瞬态错误最大尝试次数。Maximum attempts for transient failures. */
  maxAttempts?: number
}

/**
 * 官方 OpenAI Images API 端点根：生成落 `{baseURL}/images/generations`。
 * The official OpenAI Images API root: generation lands at
 * `{baseURL}/images/generations`.
 */
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** 草稿优先的缺省质量：迭代阶段用 low，成品由调用方显式升级。Draft-first default quality: low while iterating; finals upgrade explicitly. */
export const DEFAULT_QUALITY = 'low'

/** 插件配置形状。The plugin config shape. */

/** 解析后的完整配置。The fully resolved configuration. */
export interface ResolvedConfig {
  enabled: boolean
  baseURL: string
  model: string
  requestTimeoutMs: number
  maxAttempts: number
}

/** 缺省值与配置行合并；非法值在此响亮失败，不带病运行。 */
/** Merges defaults with the config row; illegal values fail loudly here instead of running sick. */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    enabled: config.enabled ?? false,
    baseURL: config.baseURL?.replace(/\/+$/, '') || DEFAULT_BASE_URL,
    model: config.model || 'gpt-image-2',
    requestTimeoutMs: config.requestTimeoutMs ?? 600_000,
    maxAttempts: config.maxAttempts ?? 3,
  }
  if (!Number.isFinite(resolved.requestTimeoutMs) || resolved.requestTimeoutMs <= 0) {
    throw new Error('@veren/imagegen: config.requestTimeoutMs must be a positive number')
  }
  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1 || resolved.maxAttempts > 10) {
    throw new Error('@veren/imagegen: config.maxAttempts must be an integer between 1 and 10')
  }
  return resolved
}
