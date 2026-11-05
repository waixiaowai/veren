/**
 * 端点契约类型（设计文档 modules/02-endpoint.md §2.3）。
 * EndpointDefinition / EndpointContext / Middleware / Hook 的类型面；
 * 运行时（注册、匹配、分派）在 endpoint/ 目录的同级模块。
 *
 * Endpoint contract types (design modules/02-endpoint.md §2.3). The type
 * faces of EndpointDefinition / EndpointContext / Middleware / Hook; the
 * runtime (registration, matching, dispatch) lives in sibling modules.
 *
 * @module @veren/auth-core/endpoint/endpoint-types
 */

import type { z } from 'zod'
import type { APIError } from '../diagnostics/api-error.ts'
import type { AuthContext } from '../context/auth-context.ts'

/** 端点元数据。 / Endpoint metadata. */
export interface EndpointMetadata {
  /** 不进 HTTP 路由、不出现在参考导出。 / Kept off the HTTP router and reference exports. */
  SERVER_ONLY?: boolean
  /** 从参考导出隐藏。 / Hidden from reference exports. */
  HIDE_METADATA?: boolean
  /** 自带会话语义（跳过会话中间件默认）。 / Owns its session semantics. */
  CUSTOM_SESSION?: boolean
  /** 参考导出描述。 / Reference-export description. */
  openapi?: { operationId?: string, tags?: string[], description?: string }
}

/** 端点定义：路径、方法、模式与中间件。 / An endpoint definition: path, method, schemas and middlewares. */
export interface EndpointDefinition {
  /** 路由路径，":name" 为路径参数。 / The route path; ":name" binds a path param. */
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** 请求体模式（zod，Standard Schema）。 / The body schema (zod, Standard Schema). */
  body?: z.ZodType
  /** 查询模式。 / The query schema. */
  query?: z.ZodType
  /** 端点级中间件。 / Endpoint-level middlewares. */
  use?: Middleware[]
  /** 必须携带请求头。 / Headers are required. */
  requireHeaders?: boolean
  metadata?: EndpointMetadata
}

/** 端点处理器上下文。 / The endpoint handler context. */
export interface EndpointContext {
  /** 命中的路由路径。 / The matched route path. */
  path: string
  /** 路径参数绑定。 / The bound path params. */
  params: Record<string, string>
  /** 模式校验后的请求体。 / The schema-validated body. */
  body: Record<string, unknown>
  /** 模式校验后的查询。 / The schema-validated query. */
  query: Record<string, unknown>
  /** 原始请求头。 / The raw request headers. */
  headers: Headers
  /** 原始请求（守卫读取 IP/转发头）。 / The raw request (guards read IP/forwarded headers). */
  request: Request
  /** 写响应头。 / Set a response header. */
  setHeader: (name: string, value: string) => void
  /** 以异常终结并跳转。 / Terminate by throwing a redirect. */
  redirect: (url: string, status?: number) => never
  /** 共享装配上下文 + 请求期状态。 / The shared context plus request state. */
  context: EndpointRequestState
}

/** 请求期状态：装配上下文加会话与返回值暂存。 / Request state: the auth context plus session and return-value slots. */
export interface EndpointRequestState extends AuthContext {
  /** 会话中间件的解析产物。 / The session middleware's resolution. */
  session: SessionContext | null
  /** after 钩子读取的端点返回值。 / The endpoint return value the after hooks read. */
  returned?: unknown
  /** 错误路径也要合并的响应头。 / Response headers merged even on the error path. */
  responseHeaders?: Headers
}

/** SessionContext 的运行时形状引用。 / The runtime shape reference of SessionContext. */
export interface SessionContext {
  session: import('../types.ts').SessionRow
  user: import('../types.ts').UserRow
  dontRemember: boolean
}

/** 中间件：返回 Response 即短路，返回 void 放行。 / A middleware: a returned Response short-circuits, void passes through. */
export type Middleware = (ctx: EndpointContext) => Promise<Response | void>

/** 钩子：matcher 命中时执行；before 可返回非上下文对象短路。 / A hook: runs when its matcher hits; a before hook may short-circuit with a non-context value. */
export interface AuthHook {
  /** 匹配器：抛错转内部错误。 / The matcher; a throw becomes an internal error. */
  matcher: (ctx: EndpointContext) => boolean
  /** 处理器：before 返回值短路或合并上下文；after 改写 returned。 / The handler: before short-circuits or patches context; after rewrites `returned`. */
  handler: (ctx: EndpointContext) => Promise<unknown>
  /** 贡献来源（插件 id 或 user）。 / The contributing source (plugin id or `user`). */
  source: string
}

/** 端点键 → 定义。 / Endpoint key → definition. */
export type EndpointTable = Record<string, EndpointDefinition & { handler: (ctx: EndpointContext) => Promise<unknown> }>

/** 错误传播形态。 / The error propagation shape. */
export type EndpointError = APIError
