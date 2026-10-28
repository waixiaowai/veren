/**
 * 模型目录在线刷新：GET `{listingBaseURL}/models` 是协议无关的可用性事实。
 * 401 意味着 key 失效，但与登录先例一致——失效不清除已存登录，清除是
 * 用户的显式动作。
 * Online catalog freshness: GET `{listingBaseURL}/models` is the
 * protocol-neutral availability fact. HTTP 401 means the key is invalid but,
 * matching the account-route precedent, invalidity never deletes the stored
 * sign-in — removal is an explicit user action.
 *
 * @module @veren/opencode-go
 */
import type { ResolvedConfig } from './config.js'
import { wireError } from './wire.js'

/** 单个 key 的目录缓存条目。One key's catalog cache entry. */
interface ListingCacheEntry {
  ids: readonly string[]
  fetchedAt: number
}

/** 目录客户端：一次拉取 + 按 key 缓存。The catalog client: one fetch plus a per-key cache. */
export class ListingClient {
  private readonly cache = new Map<string, ListingCacheEntry>()

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * 在线拉取目录 id 列表。非 2xx 一律映射为结构化 LlmError。
   * Fetches the listing ids live. Any non-2xx maps to a structured LlmError.
   */
  async fetchIds(key: string, signal: AbortSignal): Promise<readonly string[]> {
    const response = await fetch(`${this.config.listingBaseURL}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal,
    })
    if (!response.ok) throw await wireError(response, 'model listing')
    const body: unknown = await response.json()
    const ids = parseListing(body)
    if (ids.length > 0) this.cache.set(key, { ids, fetchedAt: Date.now() })
    return ids
  }

  /** 命中缓存的 id 列表；未加载过回答 undefined。The cached ids; undefined before the first successful load. */
  cachedIds(key: string): readonly string[] | undefined {
    return this.cache.get(key)?.ids
  }

  /** 缓存是否已老于 modelsMaxAgeMs。Whether the cache is older than modelsMaxAgeMs. */
  isStale(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry === undefined) return true
    return Date.now() - entry.fetchedAt >= this.config.modelsMaxAgeMs
  }
}

/**
 * 解析标准 OpenAI 目录响应（`{"object":"list","data":[{"id":…}]}`）。
 * 只取字符串 id；形状不符回答空列表（目录失败不炸请求路径）。
 * Parses the standard OpenAI listing (`{"object":"list","data":[{"id":…}]}`).
 * String ids only; a wrong shape answers an empty list — a listing failure
 * never breaks the request path.
 */
export function parseListing(body: unknown): readonly string[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}
