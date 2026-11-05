/**
 * 分派器（设计文档 modules/02-endpoint.md §2.4）。
 * 一条钩子管线服务两种入口：HTTP 路由与 `auth.api.*` 内嵌调用共用同一分派，
 * before/after 时序完全一致。before：用户级在前、插件级在后；matcher 抛错转
 * 内部错误；返回非上下文对象即短路拦截。原始 Response 跳过 after 钩子；
 * after 抛错仍携带已设置的响应头（登出清 Cookie 不因失败丢失）。
 *
 * The dispatcher (design modules/02-endpoint.md §2.4). One hook pipeline
 * serves both entries: HTTP routes and `auth.api.*` embedded calls share the
 * same dispatch with identical before/after timing. Before: user hooks
 * first, plugins after; a matcher throw becomes an internal error; a
 * non-context return short-circuits. Raw Responses skip after hooks; an
 * after-hook error still carries the headers set so far (cookie clearing
 * survives failure).
 *
 * @module @veren/auth-core/endpoint/dispatch.ts
 */

import { APIError, isAPIError } from '../diagnostics/api-error.ts'
import type { AuthHook, EndpointContext } from './endpoint-types.ts'

/** 重定向信号：以异常穿透钩子链。 / The redirect signal: thrown through the hook chain. */
export class RedirectSignal extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`redirect to ${url}`)
    this.name = 'RedirectSignal'
  }
}

/** 是否为上下文补丁对象：仅 `{ context: {...} }` 形态视为补丁（§2.4）。 / A context patch: only the `{ context: {...} }` shape counts (§2.4). */
function isContextPatch(value: unknown): value is { context: Record<string, unknown> } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'context' in value && typeof (value as { context: unknown }).context === 'object'
    && (value as { context: unknown }).context !== null
    && !isRawResponse(value)
}

/** 是否为原始 Response。 / Whether the value is a raw Response. */
function isRawResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response
}

/** 分派输入。 / The dispatch input. */
export interface DispatchInput {
  returnHeaders?: boolean
  asResponse?: boolean
}

/** 分派产物：返回值 + 合并后的响应头。 / The dispatch product: the return value plus merged headers. */
export interface DispatchResult<T = unknown> {
  response: T
  headers: Headers
}

/**
 * 分派一次端点调用：before 钩子 → 处理器 → after 钩子。
 * / Dispatch one endpoint call: before hooks → handler → after hooks.
 */
export async function dispatchAuthEndpoint<T = unknown>(
  ctx: EndpointContext,
  hooks: { before: AuthHook[], after: AuthHook[] },
  handler: (ctx: EndpointContext) => Promise<unknown>,
  input: DispatchInput = {},
): Promise<DispatchResult<T>> {
  ctx.context.responseHeaders = ctx.context.responseHeaders ?? new Headers()
  for (const hook of hooks.before) {
    let matched: boolean
    try {
      matched = hook.matcher(ctx)
    } catch {
      throw APIError.code('INTERNAL_SERVER_ERROR', `hook matcher failed for ${hook.source}.`, 'INTERNAL_SERVER_ERROR')
    }
    if (!matched) continue
    const returned = await hook.handler(ctx)
    if (isContextPatch(returned)) {
      Object.assign(ctx.context, returned.context)
      continue
    }
    // 短路：拦截生效，返回值原样回传（§2.4）。
    // Short-circuit: interception wins; the return value passes through (§2.4).
    if (returned !== undefined) return shapeResult(returned, ctx, input)
  }
  const returned = await handler(ctx)
  if (isRawResponse(returned)) return { response: returned as T, headers: ctx.context.responseHeaders }
  for (const hook of hooks.after) {
    if (!hook.matcher(ctx)) continue
    const patched = await hook.handler(ctx)
    if (patched !== undefined) ctx.context.returned = patched
  }
  return shapeResult(ctx.context.returned ?? returned, ctx, input)
}

/** 形态化结果：returnHeaders 返回 { headers, response }，asResponse 返回原始 Response。 / Shape the result: returnHeaders answers { headers, response }, asResponse answers a raw Response. */
function shapeResult<T>(value: unknown, ctx: EndpointContext, input: DispatchInput): DispatchResult<T> {
  const headers = ctx.context.responseHeaders ?? new Headers()
  if (input.asResponse === true) {
    const body = JSON.stringify(value ?? null)
    const response = new Response(body, { status: 200, headers: new Headers(headers) })
    response.headers.delete('set-cookie')
    for (const cookie of headers.getSetCookie()) response.headers.append('set-cookie', cookie)
    return { response: response as T, headers }
  }
  if (input.returnHeaders === true) return { response: { headers, response: value } as T, headers }
  return { response: value as T, headers }
}

/** 错误路径头合并：APIError 携带已设置的 Set-Cookie。 / Error-path header merge: the APIError carries Set-Cookie set so far. */
export function errorWithHeaders(error: unknown, ctx?: EndpointContext): unknown {
  if (!isAPIError(error) || ctx === undefined) return error
  const headers = ctx.context.responseHeaders
  if (headers === undefined) return error
  for (const cookie of headers.getSetCookie()) error.headers.append('set-cookie', cookie)
  return error
}

/** 抛出重定向信号。 / Throw a redirect signal. */
export function redirect(ctx: EndpointContext, url: string, status = 302): never {
  throw new RedirectSignal(url, status)
}
