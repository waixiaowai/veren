/**
 * Optional raw-traffic capture for the iLink client, gated by the
 * `DSH_IM_WECHAT_CAPTURE` environment variable (an append target file path).
 *
 * This is evidence instrumentation, not a feature: the plugin config surface
 * stays empty, and the wrapper is diagnostic by contract — a capture failure
 * must never fail the request it wraps. Authorization headers are reduced to a
 * boolean so no token ever reaches the capture file; bodies are truncated.
 *
 * iLink 客户端的可选原始流量捕获，由 `DSH_IM_WECHAT_CAPTURE` 环境变量（追加目标文件路径）
 * 门控。
 *
 * 这是取证仪表，不是功能：插件配置面保持为空，包装器按诊断契约编写——捕获失败绝不让它
 * 包住的请求失败。Authorization 头被约简为布尔值，token 绝不进捕获文件；请求体截断保存。
 *
 * @module @veren/im-wechat/capture
 */

import { appendFile } from 'node:fs/promises'

/** Hard cap on one captured body, so a huge batch cannot bloat the file. */
/** 单条捕获体上限，防止大批次撑爆文件。 */
const BODY_PREVIEW_CHARS = 2_000

/**
 * Return a fetch wrapper when the capture env var is set, else `undefined`.
 * @param value - raw `DSH_IM_WECHAT_CAPTURE` value: the JSONL file path.
 */
export function captureFromEnv(value: string | undefined): typeof fetch | undefined {
  const file = value?.trim()
  if (file === undefined || file === '') return undefined
  return async (input, init) => {
    const started = Date.now()
    const response = await fetch(input, init)
    void record(file, started, input, init, response).catch(() => undefined)
    return response
  }
}

/** Append one redacted request/response record; failures are swallowed. */
/** 追加一条脱敏的请求/响应记录；失败被吞掉。 */
async function record(
  file: string,
  started: number,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  response: Response,
): Promise<void> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const body = typeof init?.body === 'string' ? init.body : ''
  const text = await response.clone().text().catch(() => '')
  const entry = {
    at: new Date(started).toISOString(),
    method: init?.method ?? 'GET',
    url,
    status: response.status,
    ms: Date.now() - started,
    authorized: hasAuthorization(init?.headers),
    request: preview(body),
    response: preview(text),
  }
  await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

/** Whether any header spelling carries an Authorization value. */
/** 任何大小写拼法的头里是否带了 Authorization 值。 */
function hasAuthorization(headers: unknown): boolean {
  if (headers instanceof Headers) return headers.has('authorization')
  if (Array.isArray(headers)) {
    return headers.some(pair => Array.isArray(pair) && String(pair[0]).toLowerCase() === 'authorization')
  }
  if (headers !== null && headers !== undefined && typeof headers === 'object') {
    return Object.keys(headers).some(name => name.toLowerCase() === 'authorization')
  }
  return false
}

/** One-line preview of a body: first line, truncated. */
/** 单行体预览：取首行并截断。 */
function preview(text: string): string {
  const line = text.split('\n', 1)[0] ?? ''
  return line.length <= BODY_PREVIEW_CHARS ? line : line.slice(0, BODY_PREVIEW_CHARS)
}
