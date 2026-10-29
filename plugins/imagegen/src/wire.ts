/**
 * Images API wire：OpenAI 兼容 `/images/generations` 与 `/images/edits` 客户端。
 * 重试语义移植自生料 `image_gen.py`（瞬态 429/5xx/网络错误；Retry-After 优先，
 * 否则指数退避封顶 60s）；模型差异按 API 事实处理（gpt-image* 不收
 * response_format，其余模型请求 b64_json）。
 * The Images API wire: an OpenAI-compatible `/images/generations` and
 * `/images/edits` client. Retry semantics port the raw material's
 * `image_gen.py` (transient 429/5xx/network failures; Retry-After first, else
 * exponential backoff capped at 60s); model differences follow API facts
 * (gpt-image* takes no response_format, other models request b64_json).
 *
 * @module @veren/imagegen
 */
import { ImagegenError } from './errors.js'

/** 网络函数注入点（测试换假实现）。The fetch injection point (tests swap in fakes). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 客户端依赖：端点根、key、超时与重试预算、可注入的网络函数。 */
/** Client dependencies: the endpoint root, key, timeout and retry budget, and an injectable fetch. */
export interface WireClient {
  readonly baseURL: string
  readonly apiKey: string
  readonly timeoutMs: number
  readonly maxAttempts: number
  readonly fetch: FetchLike
}

/** 生成请求面（已过校验矩阵的值）。The generation request face (post-validation values). */
export interface GenerateRequest {
  readonly model: string
  readonly prompt: string
  readonly size: string
  readonly quality: string
  readonly outputFormat: string
  readonly background?: 'transparent' | 'opaque' | 'auto'
}

/** 编辑请求面：输入图字节与可选蒙版字节。The edit request face: input image bytes plus an optional mask. */
export interface EditRequest {
  readonly model: string
  readonly prompt: string
  readonly images: ReadonlyArray<{ readonly bytes: Uint8Array; readonly name: string }>
  readonly mask?: { readonly bytes: Uint8Array; readonly name: string }
  readonly size: string
  readonly background?: 'transparent' | 'opaque' | 'auto'
  readonly inputFidelity?: 'low' | 'high'
}

/** 成功响应：解码后的图像字节与元数据。The success response: decoded image bytes plus metadata. */
export interface ImageResult {
  readonly b64Json: string
}

/** gpt-image* 家族不收 response_format；其余模型必须显式要 b64_json。 */
/** The gpt-image* family takes no response_format; other models must request b64_json explicitly. */
function isGptImageFamily(model: string): boolean {
  return model.startsWith('gpt-image-')
}

/** 组装 generations 请求体。Assembles the generations request body. */
export function generateBody(request: GenerateRequest): Record<string, unknown> {
  return {
    model: request.model,
    prompt: request.prompt,
    n: 1,
    size: request.size,
    quality: request.quality,
    output_format: request.outputFormat,
    ...(request.background === undefined ? {} : { background: request.background }),
    ...(isGptImageFamily(request.model) ? {} : { response_format: 'b64_json' }),
  }
}

/** 429/5xx/网络层错误视为瞬态（生料 `_is_transient_error` 语义）。 */
/** 429/5xx and network-layer failures are transient (the raw material's `_is_transient_error` semantics). */
function isTransient(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500
}

/** 解析 Retry-After（秒，可带小数；生料语义）。Parses Retry-After (seconds, fractional allowed; the raw material's semantics). */
export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined
  const value = Number(header.trim())
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** 第 attempt 次失败后的等待毫秒：Retry-After 优先，否则 2^n 封顶 60s。 */
/** Delay in milliseconds after attempt `attempt`: Retry-After first, else 2^n capped at 60s. */
export function backoffDelay(attempt: number, retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds !== undefined) return Math.max(0, retryAfterSeconds) * 1000
  return Math.min(60, 2 ** attempt) * 1000
}

/** 组装带超时与外部取消合并的信号。Builds a signal merging the timeout with external cancellation. */
function requestSignal(client: WireClient, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(client.timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([timeout, signal])
}

/** 带重试地执行一次请求；瞬态失败按 Retry-After/退避等待后重试。 */
/** Runs one request with retries; transient failures wait out Retry-After/backoff and retry. */
async function fetchWithRetry(
  client: WireClient, url: string, init: RequestInit, signal: AbortSignal | undefined, what: string,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= client.maxAttempts; attempt += 1) {
    try {
      const response = await client.fetch(url, { ...init, signal: requestSignal(client, signal) })
      if (response.ok) return response
      lastError = await apiError(response, what)
      if (!isTransient(response.status) || attempt === client.maxAttempts) break
      const retryAfter = parseRetryAfterSeconds(response.headers.get('retry-after'))
      await sleep(backoffDelay(attempt, retryAfter), signal)
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
      if (attempt === client.maxAttempts) break
      await sleep(backoffDelay(attempt, undefined), signal)
    }
  }
  throw lastError instanceof Error ? lastError : new ImagegenError('IMAGEGEN_API_ERROR', `${what} failed`)
}

/** 可中断的睡眠。An interruptible sleep. */
async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

/** 非 2xx 响应 → 结构化错误（带 status 与截断的响应体）。A non-2xx response → a structured error (status plus a truncated body). */
async function apiError(response: Response, what: string): Promise<ImagegenError> {
  const detail = await response.text().catch(() => '')
  const trimmed = detail.length > 300 ? `${detail.slice(0, 300)}…` : detail
  return new ImagegenError('IMAGEGEN_API_ERROR', `${what} failed with HTTP ${response.status}${trimmed.length > 0 ? `: ${trimmed}` : ''}`, {
    status: response.status,
  })
}

/** 解码响应 JSON 为图像结果；形态不符即结构化失败。Decodes the response JSON into image results; a wrong shape fails structurally. */
function parseResponse(payload: unknown, what: string): ImageResult {
  const data = (payload as { data?: unknown }).data
  const first = Array.isArray(data) ? data[0] : undefined
  const b64Json = (first as { b64_json?: unknown } | undefined)?.b64_json
  if (typeof b64Json !== 'string' || b64Json.length === 0) {
    throw new ImagegenError('IMAGEGEN_INVALID_RESPONSE', `${what} returned no image data`, { payload })
  }
  return { b64Json }
}

/** 调用 `/images/generations` 生成一张图。Calls `/images/generations` for one image. */
export async function generateImage(
  client: WireClient, request: GenerateRequest, signal?: AbortSignal,
): Promise<ImageResult> {
  const response = await fetchWithRetry(client, `${client.baseURL}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${client.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(generateBody(request)),
  }, signal, 'image generation')
  return parseResponse(await response.json(), 'image generation')
}

/** 调用 `/images/edits` 编辑输入图（multipart/form-data）。Calls `/images/edits` on input images (multipart/form-data). */
export async function editImage(
  client: WireClient, request: EditRequest, signal?: AbortSignal,
): Promise<ImageResult> {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  form.append('n', '1')
  form.append('size', request.size)
  for (const image of request.images) {
    form.append('image', new Blob([new Uint8Array(image.bytes)], { type: 'image/png' }), image.name)
  }
  if (request.mask !== undefined) {
    form.append('mask', new Blob([new Uint8Array(request.mask.bytes)], { type: 'image/png' }), request.mask.name)
  }
  if (request.background !== undefined) form.append('background', request.background)
  if (request.inputFidelity !== undefined) form.append('input_fidelity', request.inputFidelity)
  if (!isGptImageFamily(request.model)) form.append('response_format', 'b64_json')
  const response = await fetchWithRetry(client, `${client.baseURL}/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${client.apiKey}` },
    body: form,
  }, signal, 'image edit')
  return parseResponse(await response.json(), 'image edit')
}

/** 用 `GET /models` 在线校验一条 key（登录流落库前的唯一校验点）。 */
/** Validates a key online via `GET /models` (the only validation before the sign-in flow commits). */
export async function validateKey(client: WireClient): Promise<boolean> {
  const response = await client.fetch(`${client.baseURL}/models`, {
    headers: { authorization: `Bearer ${client.apiKey}` },
    signal: requestSignal(client, undefined),
  }).catch(() => undefined)
  return response?.ok === true
}
