/**
 * 模型目录：静态快照保证离线可见，在线目录刷新保证新模型可用。
 * 已登录才对外提供模型（对齐 llm-deepseek-account 的登出门面语义）；
 * 在线目录只增补与排序，不收缩静态目录（一次拉取失败不影响请求路径）。
 * The model catalog: the static snapshot guarantees offline visibility and the
 * online listing keeps new models available. Models are advertised only while
 * signed in (mirroring the account-route's signed-out facade); the online
 * listing only appends and reorders, never shrinks the static catalog, and a
 * failed fetch never breaks the request path.
 *
 * @module @veren/opencode-go
 */
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { OPENCODE_GO_CATALOG } from './catalog-data.js'
import type { ResolvedConfig } from './config.js'
import type { ListingClient } from './listing.js'

/** 本插件暴露的唯一 provider 路由。The single provider route this plugin exposes. */
export const OPENCODE_GO_PROVIDER = 'opencode-go'

/** 目录视图：静态快照 + 在线增补。The catalog view: static snapshot plus online additions. */
export class GoCatalog {
  private listedIds: readonly string[] | undefined

  constructor(
    private readonly config: ResolvedConfig,
    private readonly listing: ListingClient,
  ) {}

  /** 记录一次在线目录结果（adapter 在后台刷新后调用）。Records one online listing result (called by the adapter after background refresh). */
  noteListing(ids: readonly string[]): void {
    this.listedIds = ids
  }

  /** 在线目录是否已老于 modelsMaxAgeMs。Whether the online listing is older than modelsMaxAgeMs. */
  isStale(key: string): boolean {
    return this.listing.isStale(key)
  }

  /**
   * 在线拉取目录（登录校验复用同一请求）。401 等错误向上抛，
   * 由调用方决定门面语义。
   * Fetches the listing live (sign-in validation reuses the same request).
   * Errors like 401 propagate; the caller owns the facade semantics.
   */
  async refresh(key: string, signal: AbortSignal): Promise<readonly string[]> {
    const ids = await this.listing.fetchIds(key, signal)
    this.noteListing(ids)
    return ids
  }

  /** GUI 选择面：静态目录为体，在线目录定序与增补。The GUI selection face: static catalog as the body, online listing orders and appends. */
  listModels(): readonly LlmModelInfo[] {
    const listed = this.listedIds
    if (listed === undefined) {
      return OPENCODE_GO_CATALOG.map((entry) => staticModelInfo(entry.id, entry.name, entry.input))
    }
    const byId = new Map(OPENCODE_GO_CATALOG.map((entry) => [entry.id, entry]))
    const models: LlmModelInfo[] = []
    for (const id of listed) {
      const entry = byId.get(id)
      models.push(entry === undefined
        ? { provider: OPENCODE_GO_PROVIDER, id, name: id }
        : staticModelInfo(entry.id, entry.name, entry.input))
      byId.delete(id)
    }
    // 在线目录未点名的静态模型保留在尾部（网关按模型逐项计费，静态事实不会错）。
    // Static models the listing does not name stay at the tail (per-model billing means static facts are not wrong).
    for (const entry of byId.values()) models.push(staticModelInfo(entry.id, entry.name, entry.input))
    return models
  }

  /** 精确模型元数据；静态目录未知的 id 以保底容量透传。Exact model metadata; ids unknown to the static catalog pass through with fallback capacities. */
  resolveModel(provider: string, model: string): LlmResolvedModelInfo {
    const entry = OPENCODE_GO_CATALOG.find((candidate) => candidate.id === model)
    if (entry === undefined) {
      return { provider, id: model, name: model, inputModalities: ['text'] }
    }
    return {
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.input.includes('image') ? ['text', 'image'] : ['text'],
      context: entry.contextWindow > 0 ? { contextWindow: entry.contextWindow } : undefined,
      defaultMaxTokens: entry.maxTokens > 0 ? entry.maxTokens : undefined,
    }
  }
}

/** 静态条目 → 目录行。Static entry → catalog row. */
function staticModelInfo(id: string, name: string, input: readonly string[]): LlmModelInfo {
  return {
    provider: OPENCODE_GO_PROVIDER,
    id,
    name,
    inputModalities: input.includes('image') ? ['text', 'image'] : ['text'],
  }
}
