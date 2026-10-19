/**
 * HTTP plumbing shared by every route: request facts, bounded body reading,
 * cookies and the JSON response writer.
 *
 * Nothing here knows about capabilities; it only turns a Node request into
 * plain facts and a payload into a response with the security headers the
 * platform promises.
 *
 * 所有路由共用的 HTTP 基础：请求事实、有上限的请求体读取、Cookie 与 JSON 响应写出。
 * 这里不涉及任何能力，只把 Node 请求变成朴素事实、把载荷变成带平台承诺的安全响应头
 * 的响应。
 *
 * @module @veren/admin-api-kernel/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { AdminError, type CookieOptions } from '@veren/admin-contract'

/** Plain request facts extracted once per request. 每个请求只抽取一次的朴素请求事实。 */
export interface RequestFacts {
  /** Pathname without the query string. 不含查询串的路径。 */
  readonly pathname: string
  /** Parsed query string. 解析后的查询串。 */
  readonly query: URLSearchParams
  /** Lower-cased header table. 小写化的请求头表。 */
  readonly headers: Readonly<Record<string, string>>
  /** Decoded cookies. 解码后的 Cookie。 */
  readonly cookies: Readonly<Record<string, string>>
  /** Peer address. 对端地址。 */
  readonly ip: string
}

/**
 * Parse one `Cookie` header.
 *
 * @param header - raw header value 原始请求头值
 * @returns decoded cookie table 解码后的 Cookie 表
 */
function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (header === undefined) return cookies
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const raw = part.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(raw)
    } catch {
      cookies[name] = raw
    }
  }
  return cookies
}

/**
 * Extract the facts every handler and policy needs.
 *
 * @param req - the incoming request 传入请求
 * @returns plain request facts 朴素请求事实
 */
export function requestFacts(req: IncomingMessage): RequestFacts {
  const url = new URL(req.url ?? '/', 'http://admin.local')
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return {
    pathname: url.pathname,
    query: url.searchParams,
    headers,
    cookies: parseCookies(headers.cookie),
    ip: req.socket.remoteAddress ?? 'unknown',
  }
}

/**
 * Read a JSON body with a hard byte ceiling.
 *
 * @param req - the incoming request 传入请求
 * @param maxBytes - maximum accepted body size 可接受的最大体积
 * @returns the parsed body, or `undefined` for an empty body 解析后的主体；空主体为 `undefined`
 * @throws AdminError `PAYLOAD_TOO_LARGE` or `VALIDATION_FAILED` 超限或非法 JSON
 */
export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AdminError('PAYLOAD_TOO_LARGE', `request body exceeds ${maxBytes} bytes`, { maxBytes })
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > maxBytes) throw new AdminError('PAYLOAD_TOO_LARGE', `request body exceeds ${maxBytes} bytes`, { maxBytes })
    chunks.push(buffer)
  }
  if (total === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AdminError('VALIDATION_FAILED', 'request body is not valid JSON')
  }
}

/**
 * Serialize one `Set-Cookie` value.
 *
 * @param name - cookie name Cookie 名
 * @param value - cookie value Cookie 值
 * @param options - attributes 属性
 * @returns the header value 请求头值
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`)
  if (options.httpOnly === true) parts.push('HttpOnly')
  if (options.secure === true) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  return parts.join('; ')
}

/**
 * Collect response headers and cookies produced by a handler.
 *
 * 收集 handler 产生的响应头与 Cookie。
 */
export class ResponseCollector {
  /** Extra headers. 额外响应头。 */
  private readonly headers = new Map<string, string>()

  /** `Set-Cookie` values in emission order. 按发出顺序的 `Set-Cookie` 值。 */
  private readonly cookies: string[] = []

  /**
   * Attach one cookie.
   * @param name - cookie name Cookie 名
   * @param value - cookie value Cookie 值
   * @param options - attributes 属性
   */
  setCookie(name: string, value: string, options?: CookieOptions): void {
    this.cookies.push(serializeCookie(name, value, options))
  }

  /**
   * Expire one cookie.
   * @param name - cookie name Cookie 名
   */
  clearCookie(name: string): void {
    this.cookies.push(serializeCookie(name, '', { maxAgeSeconds: 0 }))
  }

  /**
   * Attach one header.
   * @param name - header name 响应头名
   * @param value - header value 响应头值
   */
  setHeader(name: string, value: string): void {
    this.headers.set(name, value)
  }

  /**
   * Write the collected headers onto the response.
   * @param res - the response to decorate 要装饰的响应
   */
  applyTo(res: ServerResponse): void {
    for (const [name, value] of this.headers) res.setHeader(name, value)
    if (this.cookies.length > 0) res.setHeader('Set-Cookie', this.cookies)
  }
}

/**
 * Write one JSON response with the platform's security headers.
 *
 * @param res - the response 响应
 * @param status - HTTP status HTTP 状态
 * @param payload - JSON-serializable payload 可 JSON 序列化的载荷
 * @param extraHeaders - headers to merge 要合并的响应头
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent || res.writableEnded) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value)
  res.end(body)
}

/**
 * Write one plain-text response, used for empty and preflight replies.
 *
 * @param res - the response 响应
 * @param status - HTTP status HTTP 状态
 * @param headers - headers to merge 要合并的响应头
 */
export function sendEmpty(res: ServerResponse, status: number, headers: Readonly<Record<string, string>> = {}): void {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.end()
}
