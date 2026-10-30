/**
 * 上游客户端：chat 流式、token 刷新、推理档位探测。
 * The upstream client: chat streaming, token refresh, reasoning-effort probe.
 *
 * chat/探测共享同一套头建造器与身份解析——探测若能在真实消息会被拒的通道上
 * 通过，它就什么也没测量。探测读完首个可解析事件即挂断：要的是"上游收了"
 * 信号，不是补全。
 * Chat and probe share the same header builders and identity resolution — a
 * probe that passes on a channel where a real message would be refused measures
 * nothing. The probe hangs up after the first parseable event: it wants the
 * acceptance signal, not a completion.
 *
 * 证据：docs/workbuddy-protocol.cn.md §3/§7；卷宗 upstream.ts。
 * Evidence: docs/workbuddy-protocol.md §3/§7; dossier upstream.ts.
 *
 * @module @veren/workbuddy-protocol/upstream-client
 */

import { prepareBodyForRegion } from './chat-body.ts'
import { classifyUpstreamError, extractDisplayErrorMessage } from './classify.ts'
import { withGatewayChatHeaders } from './conversation-ids.ts'
import { fallbackChatIdentity, chatUserAgent, resolveChatIdentity, type ChatIdentity, type IdentityConfig } from './identity.ts'
import { regionProfile, type WorkBuddyRegion } from './region.ts'
import { REFRESH_PATH, extractRefreshTokens, type RefreshableCredential } from './refresh.ts'
import { agentHeadersFor, chatHeaders, refreshRequestHeaders } from './upstream-headers.ts'

/** JSON 端点默认超时。Default JSON-endpoint timeout. */
export const JSON_TIMEOUT_MS = 30_000
/** 错误体保存上限。Error-body keep limit. */
export const ERROR_BODY_LIMIT = 4_096
/** 国际版探测的 max_tokens 下限（GPT-5.6 家族拒 `1`：400/11133）。 */
/** International probe output floor (the GPT-5.6 family rejects `1` with 400/11133). */
export const INTERNATIONAL_PROBE_MAX_TOKENS = 16
/** 探测提示词体：不带任何用户特定内容。The probe prompt body: nothing user-specific. */
export const PROBE_PROMPT = 'ping'

// FetchLike 以 oauth.ts 的那份为准（同型不二 declare）。
// FetchLike is oauth.ts's declaration — one shape, never a shadow copy.
import type { FetchLike } from './oauth.ts'
export type { FetchLike }

/** chat 答案：活的 SSE 响应，或已分类的失败。A chat answer: a live SSE response, or a classified failure. */
export type ChatResult =
  | { readonly ok: true; readonly response: Response }
  | {
    readonly ok: false
    readonly status: number
    readonly kind: 'hard_credit' | 'soft_rate' | 'session_dead' | 'not_found' | 'server' | 'client'
    readonly message: string
    readonly displayMessage?: string
  }

/** chat 调用选项。Options of one chat call. */
export interface ChatCallOptions {
  readonly credential: RefreshableCredential
  /** 已由宿主词汇翻译出的 OpenAI 兼容体（未备方言）。The OpenAI-compatible body before dialect preparation. */
  readonly body: string
  readonly signal?: AbortSignal
  /** 会话键（仅用于派生追踪头，绝不外发原文）。The session key (feeds the derived tracking headers only, never forwarded raw). */
  readonly sessionKey?: string
  /** 身份覆盖（测试注入）；缺省用内置默认并吞掉解析失败。Identity override (test injection); defaults absorb resolution failures. */
  readonly identity?: IdentityConfig
  readonly fetchImpl?: FetchLike
  /** base 覆盖；仅测试指向 mock 上游，生产恒用区域表。Base override; tests point at a mock upstream, production always the region table. */
  readonly baseUrl?: string
}

/** 失败路径收敛的身份解析：解析失败降级为桌面兜底形，绝不落 CLI 形。 */
/** Identity resolution that converges on the fallback on any failure — never the CLI shape. */
export function resolveRequestIdentity(region: WorkBuddyRegion, config: IdentityConfig = {}): { identity: ChatIdentity; userAgent: string } {
  let identity: ChatIdentity
  try {
    identity = config.appVersion !== undefined || config.cliVersion !== undefined
      ? resolveChatIdentity(region, config)
      : fallbackChatIdentity(region)
  } catch {
    identity = fallbackChatIdentity(region)
  }
  return { identity, userAgent: chatUserAgent(identity, region) }
}

/** POST chat 端点：成功答案即原始 SSE 响应；失败已分类。 */
/** POST the chat endpoint: a successful answer is the raw SSE response; failures arrive classified. */
export async function chatStream(options: ChatCallOptions): Promise<ChatResult> {
  const region = options.credential.region
  const { identity, userAgent } = resolveRequestIdentity(region, options.identity)
  const prepared = prepareBodyForRegion(region, options.body)
  const headers = chatHeaders(options.credential, { identity, userAgent })
  withGatewayChatHeaders(headers, prepared, options.sessionKey)
  Object.assign(headers, agentHeadersFor(region))
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${options.baseUrl ?? regionProfile(region).base}/v2/chat/completions`, {
      method: 'POST',
      headers,
      body: prepared,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    return { ok: false, status: 0, kind: 'server', message: `transport error: ${String(error)}` }
  }
  if (response.ok) return { ok: true, response }
  const text = (await response.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT)
  return {
    ok: false,
    status: response.status,
    kind: classifyUpstreamError(response.status, text),
    message: text,
    ...((): { displayMessage?: string } => {
      const displayMessage = extractDisplayErrorMessage(text)
      return displayMessage === undefined ? {} : { displayMessage }
    })(),
  }
}

/** 刷新调用结果。The outcome of a refresh call. */
export type RefreshCallResult =
  | { readonly ok: true; readonly tokens: { accessToken: string; refreshToken?: string; expiresInSec?: number; domain?: string } }
  | { readonly ok: false; readonly kind: 'session_dead' | 'server' | 'client'; readonly message: string }

/**
 * POST 刷新端点并解令牌。会话死（401/12153）归类为需要重新登录，不是可重试
 * 故障；编排层（单飞 + 锁 + 惰性判定）在壳层。
 * POST the refresh endpoint and extract the tokens. A dead session (401/12153)
 * classifies as sign-in-again, not a retryable fault; the orchestration
 * (single flight + lock + laziness) lives in the shell.
 */
export async function callRefresh(
  credential: RefreshableCredential,
  deps: { fetchImpl?: FetchLike; timeoutMs?: number; baseUrl?: string } = {},
): Promise<RefreshCallResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${deps.baseUrl ?? regionProfile(credential.region).base}${REFRESH_PATH}`, {
      method: 'POST',
      headers: refreshRequestHeaders(credential),
      body: '{}',
      signal: AbortSignal.timeout(deps.timeoutMs ?? JSON_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, kind: 'server', message: `刷新请求失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const text = await response.text().catch(() => '')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'server', message: `刷新响应不是 JSON（HTTP ${response.status}）` }
  }
  const tokens = extractRefreshTokens(payload)
  if (tokens !== undefined) return { ok: true, tokens }
  const kind = classifyUpstreamError(response.status, text)
  if (kind === 'hard_credit' || kind === 'soft_rate' || kind === 'not_found') {
    // 刷新端点上这些类别没有实测语义，统一按服务端故障处理并带上原文。
    // These classes carry no measured semantics on the refresh endpoint; fold
    // them into a server failure and keep the body excerpt.
    return { ok: false, kind: 'server', message: `刷新未返回新 token：${text.slice(0, 200)}` }
  }
  return {
    ok: false,
    kind: kind === 'session_dead' ? 'session_dead' : kind === 'client' ? 'client' : 'server',
    message: text.slice(0, 200) || `HTTP ${response.status}`,
  }
}

/** 一次探测尝试的观测。One probe attempt's observation. */
export interface ProbeAttempt {
  /** HTTP 状态，0=传输失败。HTTP status, 0 for a transport failure. */
  readonly status: number
  /** 是否真有一个可解析 SSE 事件到达。Whether a parseable SSE event actually arrived. */
  readonly streamed: boolean
  /** JSON 错误体里的 `extError.code`（若有）。`extError.code` from a JSON error body. */
  readonly errorCode?: string
  readonly detail?: string
}

/** 发一次带指定档位的探测 chat。Send one probe chat carrying the effort under test. */
export async function probeEffort(
  credential: RefreshableCredential,
  model: string,
  effort: string | undefined,
  signal: AbortSignal,
  deps: { fetchImpl?: FetchLike; identity?: IdentityConfig; baseUrl?: string } = {},
): Promise<ProbeAttempt> {
  const region = credential.region
  const { identity, userAgent } = resolveRequestIdentity(region, deps.identity)
  const payload: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: 'user', content: PROBE_PROMPT }],
    max_tokens: region === 'global' ? INTERNATIONAL_PROBE_MAX_TOKENS : 1,
  }
  // effort 未定义时字段整个缺席（而不是发空值）——基线就该是一次真正的裸请求。
  // An undefined effort omits the field entirely — the baseline is a genuinely bare request.
  if (effort !== undefined) payload['reasoning_effort'] = effort
  const body = prepareBodyForRegion(region, JSON.stringify(payload))
  const headers = chatHeaders(credential, { identity, userAgent })
  withGatewayChatHeaders(headers, body)
  Object.assign(headers, agentHeadersFor(region))
  const fetchImpl = deps.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${deps.baseUrl ?? regionProfile(region).base}/v2/chat/completions`, {
      method: 'POST', headers, body, signal,
    })
  } catch (error) {
    return { status: 0, streamed: false, detail: `transport error: ${String(error)}` }
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT)
    return { status: response.status, streamed: false, ...errorCodeOf(text) }
  }
  return { status: response.status, streamed: await readFirstEvent(response) }
}

/** 从错误体抽 `extError.code`（若有）。Pull `extError.code` out of an error body. */
function errorCodeOf(text: string): { errorCode?: string; detail?: string } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const extError = (parsed as Record<string, unknown>)['extError']
      if (typeof extError === 'object' && extError !== null && !Array.isArray(extError)) {
        const code = (extError as Record<string, unknown>)['code']
        if (typeof code === 'string') return { errorCode: code, detail: code }
      }
    }
  } catch {
    // 非 JSON：落普通 detail。Not JSON: a plain detail line.
  }
  return { detail: text.slice(0, 200) }
}

/** 消费刚好够判定"真的在流"的量：首个含 data 的块；随后取消响应体。 */
/** Consume just enough to know it really streams: the first chunk with a data line; the body is cancelled after. */
async function readFirstEvent(response: Response): Promise<boolean> {
  const body = response.body
  if (body === null) return false
  const reader = body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return false
      if (decoder.decode(value, { stream: true }).includes('data:')) return true
    }
  } catch {
    return false
  } finally {
    await reader.cancel().catch(() => {})
  }
}
