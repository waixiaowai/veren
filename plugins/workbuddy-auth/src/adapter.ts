/**
 * `workbuddy` 路由的 LlmAdapter：凭据 → 翻译 → 上游 → 聚合，失败分类显式
 * 映射到 llm-retry。
 * The `workbuddy` route's LlmAdapter: credential → translation → upstream →
 * aggregation, with failure classes mapped explicitly onto llm-retry.
 *
 * 失败映射（冷却与重试是两张表，行为面见 providerRetryPolicy）：
 * - hard_credit：冷却该账号 1h + 本次抛 ACCOUNT_QUOTA（不在可重试集——重试
 *   只会撞同一个死账号；下次请求自动落健康账号）。
 * - soft_rate：冷却 1min + 抛 RATE_LIMIT（可重试；重试重进选号 → 健康账号）。
 * - session_dead：抛 AUTH（需要重新登录，不冷却——重试与冷却都无益）。
 * - server：冷却 10s + 抛 SERVER（可重试）。
 * - not_found / client：抛 INVALID_REQUEST（不可重试）。
 * Failure mapping (cooldown and retry are two tables; the retry face is
 * providerRetryPolicy): hard_credit cools the account 1h and throws
 * ACCOUNT_QUOTA (outside the retryable set — a retry would hit the same dead
 * account; the next request lands on a healthy one); soft_rate cools 1min and
 * throws RATE_LIMIT (retryable; the retry re-enters selection → a healthy
 * account); session_dead throws AUTH (sign in again; no cooldown — retry and
 * cooldown are both pointless); server cools 10s and throws SERVER
 * (retryable); not_found/client throw INVALID_REQUEST (not retryable).
 *
 * 流已开始不重试：SSE 一旦吐字，透明重发不存在；本插件不做请求内重试（同一
 * 请求体换账号重发会放大上游风控风险）。
 * No retry once the stream has started: once SSE emits bytes a transparent
 * resend does not exist; this plugin never retries inside one request (resending
 * the same body under another account amplifies upstream risk-control exposure).
 *
 * 已知偏离（有意，记录在案）：本插件**不发**宿主 `attributionHeaders()`——
 * 该头会把 User-Agent 覆盖成 harness 身份，而 WorkBuddy 的 UA 形状本身是
 * 承重身份（网关按它分流目录花名册、按"App 形 vs CLI 形"分叉行为）。保持
 * 卷宗实测的字节形态优先；取舍记录在 docs/workbuddy-protocol.cn.md §9。
 * Known divergence (deliberate, on record): this plugin does **not** send the
 * host's `attributionHeaders()` — it would overwrite the User-Agent with the
 * harness identity, while WorkBuddy's UA shape is itself load-bearing (the
 * gateway splits the catalog roster by it). The dossier's measured bytes win;
 * the trade-off is recorded in docs/workbuddy-protocol.md §9.
 *
 * @module @veren/workbuddy-auth/adapter
 */
import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  assertNeverKind, chatStream, classifyUpstreamError, regionOfDomain,
  type UpstreamErrorKind, type WorkbuddyAccountEntry,
} from '@veren/workbuddy-protocol'
import { NotSignedInError } from '@veren/workbuddy-protocol'
import type { ResolvedConfig } from './config.ts'
import type { WorkbuddyCatalog } from './catalog.ts'
import type { WorkbuddyAccounts } from './state-store.ts'
import { StreamAggregator, parseSse } from './stream.ts'
import { parseModelId, translateEffort, translateRequest } from './translate.ts'

/** 适配器依赖（测试整体顶替；baseUrl 仅测试指向 mock，生产不传）。 */
/** Adapter deps (replaced whole in tests; baseUrl points tests at a mock, production omits it). */
export interface WorkbuddyAdapterDeps {
  readonly config: ResolvedConfig
  readonly accounts: WorkbuddyAccounts
  readonly catalog: WorkbuddyCatalog
  readonly baseUrl?: string
}

/** workbuddy 单路由适配器。The single-route workbuddy adapter. */
export class WorkbuddyAdapter extends LlmAdapter {
  constructor(private readonly deps: WorkbuddyAdapterDeps) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'WorkBuddy' }
  }

  /** 重试策略照 @veren/opencode-go 先例：maxDelayMs 30s 让上游 Retry-After 原样被采用。 */
  /** The retry policy follows the @veren/opencode-go precedent: maxDelayMs 30s lets an upstream Retry-After be adopted verbatim. */
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    if (provider !== 'workbuddy') return undefined
    return {
      mode: 'normal',
      maxRetries: 5,
      // ACCOUNT_QUOTA/AUTH/INVALID_REQUEST 刻意缺席：重试它们只会重撞死账号
      // 或重放必败请求。
      // ACCOUNT_QUOTA/AUTH/INVALID_REQUEST are deliberately absent: retrying
      // them re-hits the dead account or replays a doomed request.
      retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'],
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    }
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return this.deps.catalog.listModels()
  }

  /** 目录事实独立于凭据：未登录也解析静态兜底行（登录门在 stream 的选号处）。 */
  /** Catalog facts are credential-independent: resolution works signed-out (the sign-in gate sits at selection in stream). */
  override async resolveModel(_provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const { region, upstreamId } = parseModelId(model)
    const entry = this.deps.catalog.current(region).find(candidate => candidate.id === upstreamId)
    if (entry === undefined) {
      return { provider: 'workbuddy', id: model, name: model, inputModalities: ['text'] }
    }
    return {
      provider: 'workbuddy',
      id: model,
      name: model,
      inputModalities: entry.supportsImages ? ['text', 'image'] : ['text'],
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: entry.maxTokens,
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { region, upstreamId } = parseModelId(options.model)
    const entry = await this.requireCredential(region, options.sessionId === undefined ? undefined : String(options.sessionId))
    const body = JSON.stringify(translateRequest(options, upstreamId, translateEffort(options.reasoningEffort)))
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(onAbort, this.deps.config.requestTimeoutMs)
    try {
      const result = await chatStream({
        credential: toRefreshable(entry),
        body,
        signal: controller.signal,
        sessionKey: options.sessionId === undefined ? undefined : String(options.sessionId),
        identity: this.deps.config.identity,
        ...(this.deps.baseUrl === undefined ? {} : { baseUrl: this.deps.baseUrl }),
      })
      if (!result.ok) throw await this.failure(result, entry)
      if (result.response.body === null) {
        throw new LlmError('workbuddy: upstream answered 200 with no body', 'EMPTY_RESPONSE')
      }
      const aggregator = new StreamAggregator()
      for await (const delta of parseSse(result.response.body)) {
        for (const chunk of aggregator.absorb(delta)) yield chunk
      }
      for (const chunk of aggregator.settle(controller.signal.aborted)) yield chunk
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 选号 + 惰性刷新；未登录/登录失效响亮报 SIGN_IN_REQUIRED/AUTH。 */
  /** Selection + lazy refresh; signed-out / dead sign-in fail loud with SIGN_IN_REQUIRED / AUTH. */
  private async requireCredential(region: 'cn' | 'global', sessionKey: string | undefined): Promise<WorkbuddyAccountEntry> {
    try {
      return await this.deps.accounts.resolve(region, sessionKey)
    } catch (error) {
      if (error instanceof NotSignedInError) {
        throw new LlmError(`workbuddy: ${error.message}`, 'SIGN_IN_REQUIRED')
      }
      throw error
    }
  }

  /** 上游失败 → 冷却该账号（按分类学）→ 结构化 LlmError。Upstream failure → cool the account (per the taxonomy) → a structured LlmError. */
  private async failure(result: { status: number; kind: UpstreamErrorKind; message: string; displayMessage?: string }, entry: WorkbuddyAccountEntry): Promise<LlmError> {
    await this.deps.accounts.noteFailure(entry.uid, result.kind)
    const detail = result.displayMessage ?? firstLine(result.message)
    switch (result.kind) {
      case 'hard_credit':
        return new LlmError(`workbuddy: account credit exhausted (${detail})`, 'ACCOUNT_QUOTA', { status: result.status })
      case 'soft_rate':
        return new LlmError(`workbuddy: rate limited (${detail})`, 'RATE_LIMIT', { status: result.status })
      case 'session_dead':
        return new LlmError(`workbuddy: session dead, sign in again (${detail})`, 'AUTH', { status: result.status })
      case 'server':
        return new LlmError(`workbuddy: upstream server error (${detail})`, 'SERVER', { status: result.status })
      case 'not_found':
      case 'client':
        return new LlmError(`workbuddy: request rejected (${detail})`, 'INVALID_REQUEST', { status: result.status })
      default:
        return assertNeverKind(result.kind)
    }
  }
}

/** 条目 → 协议库的可刷新凭据视图（region 按 domain 重算——chat 流按它选 base）。 */
/** Entry → the protocol's refreshable credential view (region recomputed from the domain — chatStream picks its base by it). */
function toRefreshable(entry: WorkbuddyAccountEntry): Parameters<typeof chatStream>[0]['credential'] {
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

/** 错误体首行（日志与消息用，截断）。First line of an error body (truncated). */
function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 160 ? `${line.slice(0, 160)}…` : line
}
