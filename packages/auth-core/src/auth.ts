/**
 * 装配入口：`createAuth` 交付 `{ handler, api, context }`。
 * HTTP 路由与 `auth.api.*` 内嵌调用共用同一条钩子管线（§3.14）——两条入口
 * 的 before/after 时序完全一致。api 面按端点键生成，携带
 * `returnHeaders` / `asResponse` 形态开关；SERVER_ONLY 端点只出现在 api 面。
 *
 * The assembly entry: `createAuth` delivers `{ handler, api, context }`.
 * HTTP routes and `auth.api.*` embedded calls share one hook pipeline
 * (§3.14) — identical before/after timing on both entries. The api face is
 * keyed by endpoint key with `returnHeaders` / `asResponse` switches;
 * SERVER_ONLY endpoints appear only in the api face.
 *
 * @module @veren/auth-core/auth
 */

import { APIError } from './diagnostics/api-error.ts'
import type { AuthContext, CreateAuthContextInput } from './context/auth-context.ts'
import { createAuthContext } from './context/auth-context.ts'
import { buildRouteTable, createAuthEndpoint, matchRoute } from './endpoint/endpoint.ts'
import type { AuthEndpoint } from './endpoint/endpoint.ts'
import type { EndpointContext, EndpointTable } from './endpoint/endpoint-types.ts'
import { dispatchAuthEndpoint, errorWithHeaders } from './endpoint/dispatch.ts'
import { createRequestHandler } from './endpoint/handler.ts'
import { collectHooksForRoute } from './endpoint/embedded.ts'
import { baseRoutes } from './routes/ok-error.ts'
import { sessionRoutes } from './routes/session-routes.ts'
import { credentialRoutes } from './routes/credential-routes.ts'
import { identityRoutes } from './routes/identity-routes.ts'

/** 核心端点全集（插件端点由装配域按键合并）。 / The core endpoint set (plugin endpoints merge by key in the context domain). */
const CORE_ENDPOINTS: readonly AuthEndpoint[] = [...sessionRoutes, ...credentialRoutes, ...identityRoutes]

/** 装配产物。 / The assembly product. */
export interface Auth {
  /** 共享上下文（只读；请求派生走克隆体）。 / The shared context (read-only; requests derive clones). */
  context: AuthContext
  /** HTTP 请求处理器。 / The HTTP request handler. */
  handler: (request: Request) => Promise<Response>
  /** 服务端内嵌调用面：`auth.api.<key>`。 / The embedded call face: `auth.api.<key>`. */
  api: Record<string, (input: EmbeddedInput) => Promise<unknown>>
  /** 路由表（诊断/自检用）。 / The route table (for diagnostics/self-check). */
  router: EndpointTable
}

/** 内嵌调用输入（§3.14）。 / The embedded call input (§3.14). */
export interface EmbeddedInput {
  body?: unknown
  query?: unknown
  headers?: Headers
  /** 以请求头身份参与校验与会话解析。 / Participate in validation and session resolution as request headers. */
  returnHeaders?: boolean
  asResponse?: boolean
}

/** 组装全部端点与路由表。 / Assemble all endpoints and the route table. */
function assembleRouter(context: AuthContext): EndpointTable {
  return buildRouteTable(context, CORE_ENDPOINTS, baseRoutes)
}

/** 构建单条路由的请求处理器（HTTP 与内嵌共用）。 / Build one route's request handler (shared by HTTP and embedded). */
function routeDispatcher(context: AuthContext, table: EndpointTable) {
  return async (routePath: string, request: Request, input: EmbeddedInput): Promise<unknown> => {
    const match = matchRoute(table, request.method, routePath)
    if (match === null || match.endpoint.metadata?.SERVER_ONLY === true) {
      throw APIError.code('NOT_FOUND', 'Route not found.', 'NOT_FOUND')
    }
    const headers = input.headers ?? new Headers()
    const url = new URL(request.url)
    const query = input.query !== undefined && typeof input.query === 'object' ? input.query as Record<string, unknown> : Object.fromEntries(url.searchParams)
    const body = input.body !== undefined && typeof input.body === 'object' && input.body !== null ? input.body as Record<string, unknown> : {}
    const ctx: EndpointContext = {
      path: routePath,
      params: match.params,
      body,
      query,
      headers,
      request,
      setHeader: () => undefined,
      redirect: () => {
        throw new Error('redirects are unsupported in embedded calls')
      },
      context: cloneEmbeddedContext(context),
    }
    const hooks = collectHooksForRoute(context, routePath)
    try {
      const dispatched = await dispatchAuthEndpoint(ctx, hooks, match.endpoint.handler, input)
      return input.returnHeaders === true || input.asResponse === true ? dispatched : dispatched.response
    } catch (error) {
      throw errorWithHeaders(error, ctx)
    }
  }
}

/** 内嵌调用的请求期克隆体（与 HTTP 同构，决策 2）。 / The embedded clone (same shape as HTTP, decision 2). */
function cloneEmbeddedContext(context: AuthContext): EndpointContext['context'] {
  const clone = Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)) as EndpointContext['context']
  clone.session = null
  clone.returned = undefined
  clone.responseHeaders = new Headers()
  return clone
}

/**
 * 装配认证实例。插件端点先按键合并进共享上下文，再随路由表参与匹配。
 * / Assemble the auth instance. Plugin endpoints merge into the shared
 * context by key first, then join route matching through the table.
 */
export async function createAuth(input: CreateAuthContextInput): Promise<Auth> {
  const context = await createAuthContext(input)
  const router = assembleRouter(context)
  const dispatch = routeDispatcher(context, router)
  const api: Record<string, (input: EmbeddedInput) => Promise<unknown>> = {}
  for (const [key, endpoint] of Object.entries(router)) {
    const routePath = endpoint.path
    api[apiMethodKey(endpoint.path)] = async (input: EmbeddedInput) => {
      const url = new URL(`${context.baseURL}${routePath}`)
      const request = new Request(url, { method: endpoint.method, headers: input.headers ?? new Headers() })
      return dispatch(routePath, request, input)
    }
  }
  return { context, handler: createRequestHandler(context, router), api, router }
}

/** api 键的驼峰化（`/sign-in/email` → `signInEmail`）。 / Camelize the api key (`/sign-in/email` → `signInEmail`). */
function apiMethodKey(key: string): string {
  const camel = key
    .split(/[/-]/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return camel.charAt(0).toLowerCase() + camel.slice(1)
}

/** 端点构造器的再导出（插件作者用）。 / Re-export the endpoint constructor (for plugin authors). */
export { createAuthEndpoint }
