/**
 * 目录管理：两区域各自「静态兜底 + 在线目录 + 后台惰性刷新」。
 * The catalog manager: per region, static fallback + live catalog + background
 * lazy refresh.
 *
 * 可见性与内容分离：某区域没有账号时**不暴露任何模型**（把兜底花名册端给未
 * 登录用户等于提供只会失败的模型；模型选择器丢空组，空目录就是隐藏）。
 * 失败保旧目录、401 不清登录：刷新只在成功后落新清单，失败什么都不改，删除
 * 登录是用户显式动作。
 * Visibility is separate from content: a region with no accounts exposes *no*
 * models (serving the fallback roster to a signed-out user offers models that
 * can only fail; the picker drops an empty group). Failure keeps the old
 * catalog and a 401 never clears sign-in: refresh notes listings only on
 * success, and removing a sign-in is the user's explicit act.
 *
 * @module @veren/workbuddy-auth/catalog
 */
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import {
  ALL_REGIONS, fetchCatalog, fallbackModelsFor, normalizeCredits, regionOfDomain,
  type CatalogFetchInfo, type WorkBuddyRegion, type WorkbuddyAccountEntry,
  type WorkbuddyStateDocument, type WorkBuddyUpstreamModel,
} from '@veren/workbuddy-protocol'
import { composeModelId, regionTag } from './translate.ts'
import type { ResolvedConfig } from './config.ts'

/** 协议库凭据视图（目录获取只需要这些字段）。The protocol's credential view (catalog fetches need only these fields). */
type CatalogCredential = Pick<WorkbuddyAccountEntry, 'accessToken' | 'refreshToken' | 'expiresAtMs' | 'domain' | 'uid'> & {
  readonly enterpriseId?: string
  readonly region: WorkBuddyRegion
}

/** 一个区域目录的内存态。One region's in-memory catalog state. */
interface RegionCatalogState {
  models: readonly WorkBuddyUpstreamModel[]
  fetchedAtMs: number
  info: CatalogFetchInfo | undefined
  refreshing: Promise<void> | undefined
}

/** 两区域目录管理器。The two-region catalog manager. */
export class WorkbuddyCatalog {
  private readonly states = new Map<WorkBuddyRegion, RegionCatalogState>()

  constructor(
    private readonly config: ResolvedConfig,
    private readonly accounts: { read(): Promise<WorkbuddyStateDocument> },
    private readonly now: () => number = Date.now,
    /** 测试缝：指向 mock 上游；生产恒空。Test seam: a mock base URL; production always empty. */
    private readonly baseUrl?: string,
  ) {
    for (const region of ALL_REGIONS) {
      this.states.set(region, { models: fallbackModelsFor(region), fetchedAtMs: 0, info: undefined, refreshing: undefined })
    }
  }

  /** 当前可选行（兜底或最近一次成功获取）。The current selectable rows (fallback or the last successful fetch). */
  current(region: WorkBuddyRegion): readonly WorkBuddyUpstreamModel[] {
    return this.states.get(region)?.models ?? fallbackModelsFor(region)
  }

  /** 最近一次成功获取的出处。Provenance of the last successful fetch. */
  info(region: WorkBuddyRegion): CatalogFetchInfo | undefined {
    return this.states.get(region)?.info
  }

  /** 是否该后台刷新（从未取过或超过陈旧阈值）。Whether a background refresh is due (never fetched or past the staleness threshold). */
  isStale(region: WorkBuddyRegion): boolean {
    const state = this.states.get(region)
    if (state === undefined) return true
    return this.now() - state.fetchedAtMs >= this.config.catalogMaxAgeMs
  }

  /**
   * 后台刷新（listModels 触发；失败静默——目录保旧、401 不清登录）。
   * 已在飞的刷新直接复用（并发的 picker 读取只付一次请求）。
   * Background refresh (triggered from listModels; failures stay silent — the
   * old catalog holds and a 401 never clears sign-in). An in-flight refresh is
   * reused (concurrent picker reads pay for one request).
   */
  refreshInBackground(region: WorkBuddyRegion): void {
    const state = this.states.get(region)
    if (state === undefined || state.refreshing !== undefined) return
    state.refreshing = this.refresh(region)
      .catch(() => {})
      .finally(() => { state.refreshing = undefined })
  }

  /** 在线刷新一次（抛错由调用方裁决——授权流的在线校验要拿到失败）。One live refresh (throws; the caller decides — the flow's online validation needs the failure). */
  async refresh(region: WorkBuddyRegion): Promise<void> {
    const document = await this.accounts.read()
    const disabled = new Set(document.disabled)
    const candidate = document.accounts
      .filter(entry => regionOfDomain(entry.domain) === region && !disabled.has(entry.uid))
      .sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0]
    if (candidate === undefined) return
    const { models, info } = await fetchCatalog(toCatalogCredential(candidate), resolvedAppVersion(this.config, region), {
      ...(this.baseUrl === undefined ? {} : { baseUrl: this.baseUrl }),
    })
    const state = this.states.get(region)
    if (state !== undefined) {
      state.models = models
      state.fetchedAtMs = this.now()
      state.info = info
    }
  }

  /**
   * 两区域目录合并为单路由的模型清单：某区域没有可用账号就整区隐藏。
   * Merges both regions into the single route's model list: a region without a
   * usable account hides entirely.
   */
  async listModels(): Promise<readonly LlmModelInfo[]> {
    const document = await this.accounts.read()
    const disabled = new Set(document.disabled)
    const models: LlmModelInfo[] = []
    for (const region of ALL_REGIONS) {
      const hasAccount = document.accounts.some(entry =>
        regionOfDomain(entry.domain) === region && !disabled.has(entry.uid))
      if (!hasAccount) continue
      if (this.isStale(region)) this.refreshInBackground(region)
      for (const entry of this.current(region)) {
        models.push({
          provider: 'workbuddy',
          id: composeModelId(region, entry.id),
          name: displayName(entry, region),
          inputModalities: entry.supportsImages ? ['text', 'image'] : ['text'],
        })
      }
    }
    return models
  }
}

/** 出站身份（区域相关缺省在协议库）。The outbound identity (region defaults live in the protocol). */
function resolvedAppVersion(config: ResolvedConfig, region: WorkBuddyRegion): string {
  if (config.identity.appVersion !== '') return config.identity.appVersion
  return region === 'global' ? '5.5.2' : '5.5.6'
}

/** 条目 → 目录获取的凭据视图（region 按 domain 重算）。Entry → the fetch's credential view (region recomputed from the domain). */
function toCatalogCredential(entry: WorkbuddyAccountEntry): CatalogCredential {
  return {
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
    expiresAtMs: entry.expiresAtMs,
    domain: entry.domain,
    uid: entry.uid,
    ...(entry.enterpriseId === undefined ? {} : { enterpriseId: entry.enterpriseId }),
    region: regionOfDomain(entry.domain),
  }
}

/** 显示名：`名称 · 倍率 · 区域`（倍率/免费/区域标签按存在拼装，宽度有界）。 */
/** Display name: `name · rate · region` (assembled from what exists; width bounded). */
function displayName(entry: WorkBuddyUpstreamModel, region: WorkBuddyRegion): string {
  const rate = normalizeCredits(entry.billing?.credits)
  const parts = [entry.name, rate ?? (entry.billing?.rateUnknown === true ? '?' : undefined), regionTag(region)]
  return parts.filter(part => part !== undefined && part !== '').join(' · ')
}
