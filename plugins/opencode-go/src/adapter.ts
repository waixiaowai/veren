/**
 * 专用 provider 适配器：`opencode-go` 路由的 LlmAdapter 实现。
 * 请求路径 = 解析凭据 → 翻译 → 网关 → SSE 聚合；登录态由凭据缝决定，
 * 配置变更随下一次请求生效（无重启）。
 * The dedicated provider adapter: the LlmAdapter implementation behind the
 * `opencode-go` route. Request path = resolve credential → translate →
 * gateway → SSE aggregation; sign-in state comes from the credential seam and
 * configuration changes apply on the next request (no restart).
 *
 * @module @veren/opencode-go
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './config.js'
import { OPENCODE_GO_PROVIDER, type GoCatalog } from './catalog.js'
import { readStoredKey, requireStoredKey } from './credential.js'
import { buildRequestHeaders, translateRequest, wireError } from './wire.js'
import { parseSse, StreamAggregator } from './stream.js'

/** 适配器依赖注入面（测试可整体顶替）。The adapter's injectable deps (tests can replace them wholesale). */
export interface AdapterDeps {
  ctx: Context
  config: ResolvedConfig
  catalog: GoCatalog
}

/** `opencode-go` 路由适配器。The `opencode-go` route adapter. */
export class OpencodeGoAdapter extends LlmAdapter {
  constructor(private readonly deps: AdapterDeps) {
    super()
  }

  /** 路由展示名。The route's display name. */
  providerInfo(provider: string): { id: string; name: string } {
    return provider === OPENCODE_GO_PROVIDER ? { id: provider, name: 'OpenCode Go' } : { id: provider, name: provider }
  }

  /**
   * go 路由的重试策略：normal 五次，退避上限 30s——网关容量拒绝（429
   * `ttft_admission_refused`，实测 "after 26 s" 形态）给出的 Retry-After
   * 恰好落在界内，被 llm-retry 原样采用而不是封顶截断。
   * The go route's retry policy: normal five attempts, backoff capped at 30s —
   * the gateway's capacity rejections (429 ttft_admission_refused, observed
   * as "after 26 s") carry a Retry-After that fits these bounds and is
   * honored verbatim by llm-retry instead of being clipped.
   */
  providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    if (provider !== OPENCODE_GO_PROVIDER) return undefined
    return {
      mode: 'normal',
      maxRetries: 5,
      retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
      initialDelayMs: 1000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    }
  }

  /**
   * GUI 选择面：未登录回答空目录（登出门面），已登录返回
   * 静态+在线目录并按需后台刷新。
   * The GUI face: signed out answers an empty catalog (the signed-out
   * facade); signed in returns the static+online catalog with a background
   * refresh when stale.
   */
  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider !== OPENCODE_GO_PROVIDER) return []
    const key = await readStoredKey(this.deps.ctx)
    if (key === undefined) return []
    if (this.deps.catalog.isStale(key)) void this.refreshInBackground(key)
    return this.deps.catalog.listModels()
  }

  /** 精确模型元数据（不校验登录，目录事实独立于凭据）。Exact model metadata (sign-in not checked; catalog facts are credential-independent). */
  async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return this.deps.catalog.resolveModel(provider, model)
  }

  /** 一次流式调用：凭据 → 翻译 → 网关 → 聚合；流必以 finish 终局。One streaming call: credential → translate → gateway → aggregate; the stream always settles with finish. */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = await requireStoredKey(this.deps.ctx)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(onAbort, this.deps.config.requestTimeoutMs)
    try {
      const response = await fetch(`${this.deps.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: buildRequestHeaders(key, options.sessionId === undefined ? undefined : String(options.sessionId)),
        body: JSON.stringify(translateRequest(options)),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw await wireError(response, `model ${options.model}`)
      }
      const aggregator = new StreamAggregator()
      for await (const delta of parseSse(response.body)) {
        for (const chunk of aggregator.absorb(delta)) yield chunk
      }
      for (const chunk of aggregator.settle(controller.signal.aborted)) yield chunk
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 后台目录刷新：失败只落日志，不影响请求路径。Background listing refresh: failures only log, the request path never notices. */
  private async refreshInBackground(key: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.deps.config.modelsTimeoutMs)
    try {
      this.deps.catalog.noteListing(await this.deps.catalog.refresh(key, controller.signal))
    } catch {
      // 目录失败保持既有目录（与登录先例一致）；401 亦不清登录。
      // A listing failure keeps the previous catalog (matching the account precedent); 401 keeps the sign-in too.
    } finally {
      clearTimeout(timer)
    }
  }
}
