/**
 * HTTP 内核：超时、指数退避重试（仅可重试失败）、四种上游错误形态的归一，
 * 以及 OAuth 令牌端点（授权码换令牌 / 刷新令牌）。secretKey 只出现在令牌
 * 端点的请求体里，诊断信息只保留方法与 URL。
 * The HTTP core: timeouts, exponential-backoff retries (retryable failures
 * only), normalization of all four upstream error shapes, and the OAuth
 * token endpoints (code-to-token / refresh). The secretKey appears only in
 * the token endpoint's request body; diagnostics keep method and URL only.
 *
 * @module @veren/baidu-pan
 */
import { TOKEN_ENDPOINT } from './config.js'
import type { ResolvedConfig } from './config.js'
import { baiduPanError, mapUpstream, networkError } from './errors.js'
import type { BaiduPanError } from './errors.js'
import type { OAuthTokens } from './types.js'

/** fetch 注入点（测试换假实现）。The fetch injection point (tests swap in fakes). */
export type FetchLike = typeof fetch

/** 一次出网请求的选项。The options of one outbound request. */
export interface WireRequest {
  readonly method: 'GET' | 'POST'
  readonly query: Readonly<Record<string, string>>
  /** POST 表单体（令牌端点用；不进诊断）。The POST form body (token endpoint only; never enters diagnostics). */
  readonly form?: Readonly<Record<string, string>>
  /** POST multipart 体（分片上传用）。The POST multipart body (slice uploads). */
  readonly multipart?: FormData
  /** 额外请求头（dlink 下载要求 User-Agent: netdisk）。Extra headers (the dlink download demands User-Agent: netdisk). */
  readonly headers?: Readonly<Record<string, string>>
  /** 二进制响应（下载直链用）。Binary response (the download dlink). */
  readonly binary?: boolean
}

/** 归一化响应：JSON 对象、原始文本或二进制流。The normalized response: JSON object, raw text, or binary stream. */
export interface WireResponse {
  readonly status: number
  /** text=binary=false 时携带 JSON；raw=true 时携带原文。json when binary=false and parsed; rawText only when requested. */
  readonly json: Record<string, unknown>
  readonly rawText?: string
  readonly body?: Awaited<ReturnType<Response['body']>>
}

/** 单请求参数（超时与重试次数）。The per-call parameters (timeout and attempts). */
export interface WireBudget {
  readonly timeoutMs: number
  readonly maxAttempts: number
  readonly fetch: FetchLike
}

/** 指数退避：第 n 次重试前等待 1s/2s/4s…。The backoff: 1s/2s/4s… before the n-th retry. */
export function backoffDelayMs(attempt: number): number {
  return 1000 * 2 ** Math.max(0, attempt - 1)
}

/** 把非 2xx 的 HTTP 状态折成统一失败：5xx/429 可重试，其余不可。Folds a non-2xx status into the unified failure: 5xx/429 retryable, the rest not. */
function httpFailure(status: number, method: string, url: string): BaiduPanError {
  const retryable = status >= 500 || status === 429
  const error = baiduPanError('BDPAN_UPSTREAM', { retryable, detail: `HTTP ${status}`, diagnostics: { method, url } })
  return error
}

/** 组装目标 URL：保留 URL 自带查询参数，请求参数同名覆盖（dlink 直链场景）。Builds the target URL: the URL's own query survives; request params override same-named keys (the dlink case). */
function buildTarget(url: string, query: Readonly<Record<string, string>>): string {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(query)) parsed.searchParams.set(key, value)
  return parsed.toString()
}

/** 单次尝试：发请求、套超时、归一响应。One attempt: fire, apply the timeout, normalize. */
async function attemptOnce(url: string, request: WireRequest, budget: WireBudget): Promise<WireResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget.timeoutMs)
  try {
    const target = buildTarget(url, request.query)
    const response = await budget.fetch(target, {
      method: request.method,
      ...(request.form === undefined ? {} : { body: new URLSearchParams(request.form) }),
      ...(request.multipart === undefined ? {} : { body: request.multipart }),
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      signal: controller.signal,
    })
    if (!response.ok) throw httpFailure(response.status, request.method, url)
    if (request.binary === true) return { status: response.status, json: {}, body: response.body }
    const rawText = await response.text()
    let json: Record<string, unknown>
    try {
      json = JSON.parse(rawText) as Record<string, unknown>
    } catch {
      // HTTP 200 但 JSON 解析失败：BDPAN_UPSTREAM，不重试，保留响应摘要。
      // HTTP 200 with a JSON parse failure: BDPAN_UPSTREAM, no retry, summary kept.
      throw baiduPanError('BDPAN_UPSTREAM', { detail: 'non-JSON response', diagnostics: { method: request.method, url } })
    }
    return { status: response.status, json, rawText }
  } catch (error) {
    if (error instanceof BaiduPanError) throw error
    // 连接中断、超时、DNS 失败：可重试的 BDPAN_NETWORK。
    // Connection drops, timeouts, DNS failures: retryable BDPAN_NETWORK.
    throw networkError(error, { method: request.method, url })
  } finally {
    clearTimeout(timer)
  }
}

/** 带重试的出网请求：仅可重试失败按 1/2/4 秒退避，次数用尽或不可重试即抛出。The retrying outbound request: retryable failures back off 1/2/4s; exhaustion or a non-retryable failure throws. */
export async function wireRequest(url: string, request: WireRequest, budget: WireBudget): Promise<WireResponse> {
  let lastError: BaiduPanError | undefined
  for (let count = 1; count <= budget.maxAttempts; count += 1) {
    try {
      return await attemptOnce(url, request, budget)
    } catch (error) {
      const failure = error instanceof BaiduPanError ? error : baiduPanError('BDPAN_UNKNOWN', { cause: error })
      if (!failure.retryable) throw failure
      lastError = failure
      if (count < budget.maxAttempts) await new Promise(resolve => setTimeout(resolve, backoffDelayMs(count)))
    }
  }
  throw lastError ?? baiduPanError('BDPAN_NETWORK', { retryable: true })
}

/** xpan 响应的 errno 归一：非零错误号经映射表折成统一失败。Normalizes the xpan errno: non-zero errnos fold through the mapping table. */
export function assertXpanOk(json: Record<string, unknown>, method: string, url: string): void {
  const errno = json['errno']
  if (typeof errno === 'number' && errno !== 0) throw mapUpstream(errno, { method, url })
}

/** OAuth 令牌端点载荷的形状守卫。The token-endpoint payload shape guard. */
function parseTokenPayload(json: Record<string, unknown>, now: number): OAuthTokens {
  const accessToken = json['access_token']
  const refreshToken = json['refresh_token']
  const expiresIn = json['expires_in']
  const scope = json['scope']
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string'
    || typeof expiresIn !== 'number' || typeof scope !== 'string') {
    throw baiduPanError('BDPAN_TOKEN_INVALID', { detail: 'token endpoint returned an unexpected payload' })
  }
  return { accessToken, refreshToken, expiresAt: new Date(now + expiresIn * 1000).toISOString(), scope }
}

/** OAuth 错误载荷（error/error_description）→ 不可重试的令牌失败。The OAuth error payload (error/error_description) → a non-retryable token failure. */
function oauthFailure(json: Record<string, unknown>): BaiduPanError {
  const description = typeof json['error_description'] === 'string' ? json['error_description'] : 'authorization failed'
  return baiduPanError('BDPAN_TOKEN_INVALID', { detail: description })
}

/** 组装令牌端点的公共预算（fetch 可注入，测试换假实现）。Builds the token endpoint's common budget (fetch injectable for tests). */
function tokenBudget(config: ResolvedConfig, fetch: FetchLike): WireBudget {
  return { timeoutMs: config.requestTimeoutMs, maxAttempts: 1, fetch }
}

/** 用授权码换令牌（授权流的落点；授权码只经用户粘贴，不进 URL/进程参数）。Trades the authorization code for tokens (the sign-in flow's landing; the code travels via the user's paste, never in URLs or process args). */
export async function exchangeCodeForTokens(config: ResolvedConfig, code: string, fetch: FetchLike = globalThis.fetch): Promise<OAuthTokens> {
  const response = await wireRequest(TOKEN_ENDPOINT, {
    method: 'POST',
    query: {},
    form: {
      grant_type: 'authorization_code',
      code,
      client_id: config.appKey,
      client_secret: config.secretKey,
      redirect_uri: 'oob',
    },
  }, tokenBudget(config, fetch))
  if (typeof response.json['error'] === 'string') throw oauthFailure(response.json)
  return parseTokenPayload(response.json, Date.now())
}

/** 用刷新令牌换新令牌；刷新失败意味着必须重新授权，不静默降级。Trades the refresh token for a new pair; a failed refresh means re-authorization — never a silent downgrade. */
export async function refreshTokens(config: ResolvedConfig, refreshToken: string, fetch: FetchLike = globalThis.fetch): Promise<OAuthTokens> {
  const response = await wireRequest(TOKEN_ENDPOINT, {
    method: 'POST',
    query: {},
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.appKey,
      client_secret: config.secretKey,
    },
  }, tokenBudget(config, fetch))
  if (typeof response.json['error'] === 'string') throw oauthFailure(response.json)
  return parseTokenPayload(response.json, Date.now())
}
