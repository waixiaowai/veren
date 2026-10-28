/**
 * 插件配置：端点根与超时。所有字段可选，缺省值集中在 resolveConfig，
 * 配置行只需覆盖偏离官方网关默认值的项。
 * Plugin configuration: endpoint roots and timeouts. Every field is optional;
 * defaults live in resolveConfig so a config row only overrides items that
 * deviate from the official gateway defaults.
 *
 * @module @veren/opencode-go
 */
import z from '@deepseek-ai/schemastery'

/**
 * 官方 OpenAI 兼容端点根：chat completions 落在 `{baseURL}/chat/completions`。
 * The official OpenAI-compatible endpoint root: chat completions land at
 * `{baseURL}/chat/completions`.
 */
const DEFAULT_BASE_URL = 'https://opencode.ai/inference/go/openai/v1'

/**
 * 官方模型目录端点根：列表落在 `{listingBaseURL}/models`（协议无关根，
 * 不带 `/openai` 段，2026-10 实测 200）。
 * The official catalog endpoint root: the listing lands at
 * `{listingBaseURL}/models` (protocol-neutral root without the `/openai`
 * segment; verified live 2026-10).
 */
const DEFAULT_LISTING_BASE_URL = 'https://opencode.ai/inference/go/v1'

/** 插件配置形状。The plugin config shape. */
export interface Config {
  baseURL?: string
  listingBaseURL?: string
  modelsTimeoutMs?: number
  modelsMaxAgeMs?: number
  requestTimeoutMs?: number
}

/** 宿主统一配置契约。The host's uniform config contract. */
export const Config: z<Config> = z.object({
  baseURL: z.string().role('url'),
  listingBaseURL: z.string().role('url'),
  modelsTimeoutMs: z.number(),
  modelsMaxAgeMs: z.number(),
  requestTimeoutMs: z.number(),
}).description('OpenCode Go bridge endpoints and timeouts')

/** 解析后的完整配置。The fully resolved configuration. */
export interface ResolvedConfig {
  baseURL: string
  listingBaseURL: string
  modelsTimeoutMs: number
  modelsMaxAgeMs: number
  requestTimeoutMs: number
}

/** 缺省值与配置行合并；非法值（非正数超时）在此显式失败。 */
/** Merges defaults with the config row; illegal values (non-positive timeouts) fail loudly here. */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    baseURL: config.baseURL?.replace(/\/+$/, '') || DEFAULT_BASE_URL,
    listingBaseURL: config.listingBaseURL?.replace(/\/+$/, '') || DEFAULT_LISTING_BASE_URL,
    modelsTimeoutMs: config.modelsTimeoutMs ?? 5_000,
    modelsMaxAgeMs: config.modelsMaxAgeMs ?? 600_000,
    requestTimeoutMs: config.requestTimeoutMs ?? 600_000,
  }
  for (const field of ['modelsTimeoutMs', 'modelsMaxAgeMs', 'requestTimeoutMs'] as const) {
    if (!Number.isFinite(resolved[field]) || resolved[field] <= 0) {
      throw new Error(`@veren/opencode-go: config.${field} must be a positive number`)
    }
  }
  return resolved
}
