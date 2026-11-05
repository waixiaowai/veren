/**
 * HTTP 入口：请求 → 路由匹配 → 请求上下文构建 → 中间件 → 分派 → 响应
 * （设计文档 modules/02-endpoint.md §2.4 与 modules/01-context.md 请求派生链）。
 * 请求派生状态全部落在共享上下文的克隆体上，绝不回写共享状态（决策 2）。
 * 体解析支持 JSON 与表单编码；模式校验失败报 VALIDATION_ERROR。
 *
 * The HTTP entry: request → route match → per-request context build →
 * middlewares → dispatch → response (design modules/02-endpoint.md §2.4 and
 * the modules/01-context.md derivation chain). All request-derived state
 * lives on a clone of the shared context and never writes back (decision 2).
 * Body parsing covers JSON and form encoding; schema failures answer
 * VALIDATION_ERROR.
 *
 * @module @veren/auth-core/endpoint/handler.ts
 */

import { z } from 'zod'
import { APIError } from '../diagnostics/api-error.ts'
import type { AuthContext } from '../context/auth-context.ts'
import { consumeRateLimit } from '../guard/rate-limit.ts'
import { originCheckMiddleware } from '../guard/origin-check.ts'
import type { AuthHook, EndpointContext, EndpointTable, Middleware } from './endpoint-types.ts'
import { RedirectSignal, dispatchAuthEndpoint, errorWithHeaders } from './dispatch.ts'
import { matchRoute } from './endpoint.ts'
import { collectHooksForRoute } from './embedded.ts'

/** 请求体与查询的解析产物。 / The parsed body and query. */
interface ParsedInput { body: Record<string, unknown>, query: Record<string, unknown> }

/** 请求体解析：JSON 或表单编码；空体为空对象。 / Body parsing: JSON or form encoding; an empty body is an empty object. */
async function parseBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  const text = await request.text()
  if (text === '') return {}
  const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim()
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text))
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    throw APIError.code('BODY_MUST_BE_AN_OBJECT', 'The request body must be a JSON object.', 'BAD_REQUEST')
  }
}

/** 查询解析。 / Query parsing. */
function parseQuery(url: URL): Record<string, unknown> {
  return Object.fromEntries(url.searchParams)
}

/** 模式校验：zod safeParse，失败报 VALIDATION_ERROR。 / Schema validation: zod safeParse; failures answer VALIDATION_ERROR. */
function validateWithSchema(schema: z.ZodType | undefined, value: unknown, kind: string): void {
  if (schema === undefined) return
  const verdict = schema.safeParse(value)
  if (verdict.success) return
  const message = verdict.error.issues[0]?.message ?? 'validation failed'
  throw APIError.code('VALIDATION_ERROR', `${kind}: ${message}`, 'BAD_REQUEST')
}

/** 请求期克隆体：原型 + 自有属性描述符（§1.4）。 / The request clone: prototype plus own descriptors (§1.4). */
function cloneContext(context: AuthContext): EndpointContext['context'] {
  const clone = Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)) as EndpointContext['context']
  clone.session = null
  clone.returned = undefined
  clone.responseHeaders = new Headers()
  return clone
}

/** 组装端点上下文。 / Assemble the endpoint context. */
function buildContext(context: AuthContext, request: Request, routePath: string, params: Record<string, string>, input: ParsedInput): EndpointContext {
  const merged = cloneContext(context)
  return {
    path: routePath,
    params,
    body: input.body,
    query: input.query,
    headers: request.headers,
    request,
    setHeader: (name, value) => {
      // set-cookie 语义是列表头：追加而非覆盖，多枚凭据（会话 + 标记）并存。
      // set-cookie is a list header: append instead of overwrite so multiple
      // credentials (session + marker) coexist.
      if (name.toLowerCase() === 'set-cookie') merged.responseHeaders?.append(name, value)
      else merged.responseHeaders?.set(name, value)
    },
    redirect: (url, status = 302) => {
      throw new RedirectSignal(url, status)
    },
    context: merged,
  }
}

/** 运行中间件链：路由守卫 → 插件中间件 → 端点级 use。 / Run the middleware chain: route guard → plugin middlewares → endpoint-level use. */
async function runMiddlewares(ctx: EndpointContext, endpoint: { use?: Middleware[] }): Promise<Response | null> {
  const guarded = await originCheckMiddleware(ctx)
  if (guarded !== undefined && guarded !== null) return guarded
  for (const plugin of ctx.context.plugins) {
    for (const declared of plugin.middlewares ?? []) {
      if (!declared.matcher(ctx.path)) continue
      const short = await declared.middleware(ctx)
      if (short !== undefined && short !== null) return short
    }
  }
  for (const middleware of endpoint.use ?? []) {
    const short = await middleware(ctx)
    if (short !== undefined && short !== null) return short
  }
  return null
}

/** 响应化：JSON 形态 + 合并响应头。 / Render the response: JSON shape plus merged headers. */
function jsonResponse(value: unknown, headers: Headers, status = 200): Response {
  const merged = new Headers(headers)
  merged.set('content-type', 'application/json')
  const response = new Response(JSON.stringify(value ?? null), { status, headers: merged })
  return response
}

/** HTTP 请求处理器工厂。 / The HTTP request handler factory. */
export function createRequestHandler(context: AuthContext, table: EndpointTable): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handleOnce(context, table, request)
    } catch (error) {
      return errorResponse(error, context)
    }
  }
}

/** 单次请求处理。 / Handle one request. */
async function handleOnce(context: AuthContext, table: EndpointTable, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const basePath = context.options.basePath
  if (!url.pathname.startsWith(basePath)) return jsonResponse({ code: 'NOT_FOUND', message: 'Route not found.', status: 404 }, new Headers(), 404)
  const routePath = url.pathname.slice(basePath.length) || '/'
  if (context.options.disabledPaths.some((path) => path === routePath)) return jsonResponse({ code: 'NOT_FOUND', message: 'Route not found.', status: 404 }, new Headers(), 404)
  const match = matchRoute(table, request.method, routePath)
  if (match === null || match.endpoint.metadata?.SERVER_ONLY === true) {
    return jsonResponse({ code: 'NOT_FOUND', message: 'Route not found.', status: 404 }, new Headers(), 404)
  }
  const input: ParsedInput = { body: await parseBody(request), query: parseQuery(url) }
  validateWithSchema(match.endpoint.body, input.body, 'body')
  validateWithSchema(match.endpoint.query, input.query, 'query')
  const ctx = buildContext(context, request, routePath, match.params, input)
  try {
    const short = await runMiddlewares(ctx, match.endpoint)
    if (short !== null) return short
    const limited = await consumeRateLimit(ctx)
    if (limited !== null) return limited
    const hooks = collectHooksForRoute(context, routePath)
    const dispatched = await dispatchAuthEndpoint(ctx, hooks, match.endpoint.handler)
    return dispatched.response instanceof Response
      ? dispatched.response
      : jsonResponse(dispatched.response, ctx.context.responseHeaders ?? new Headers())
  } catch (error) {
    throw errorWithHeaders(error, ctx)
  }
}

/** 错误响应化：APIError 携带头；跳转穿透；其余 500 记日志。 / Error rendering: APIError carries headers; redirects pass through; the rest 500 with a log. */
function errorResponse(error: unknown, context: AuthContext): Response {
  if (error instanceof RedirectSignal) {
    return new Response(null, { status: error.status, headers: { location: error.url } })
  }
  const settled = errorWithHeaders(error) ?? error
  if (settled instanceof APIError) return settled.toResponse()
  context.logger.error(`unhandled endpoint failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  return APIError.code('INTERNAL_SERVER_ERROR', 'An internal error occurred.', 'INTERNAL_SERVER_ERROR').toResponse()
}
