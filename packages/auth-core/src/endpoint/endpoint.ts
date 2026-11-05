/**
 * 端点注册与路由表（设计文档 modules/02-endpoint.md §2.2）。
 * `createAuthEndpoint` 携带路径、方法、模式与中间件；`.serverOnly` 变体带
 * SERVER_ONLY 元数据，不进 HTTP 路由。路由表按端点键合并，后声明覆盖先
 * 声明；`ok` 与 `error` 永远最后追加、不可覆盖；路径冲突只告警不抛错。
 *
 * Endpoint registration and the route table (design modules/02-endpoint.md
 * §2.2). `createAuthEndpoint` carries path, method, schemas and middlewares;
 * the `.serverOnly` variant carries SERVER_ONLY metadata and stays off the
 * HTTP router. Tables merge by endpoint key, later declarations win; `ok`
 * and `error` always append last and cannot be overridden; path conflicts
 * warn without throwing.
 *
 * @module @veren/auth-core/endpoint/endpoint.ts
 */

import type { AuthContext } from '../context/auth-context.ts'
import type { EndpointContext, EndpointDefinition, EndpointTable } from './endpoint-types.ts'

/** 端点处理器类型。 / The endpoint handler type. */
export type EndpointHandler = (ctx: EndpointContext) => Promise<unknown>

/** 完整端点：定义 + 处理器。 / A full endpoint: definition plus handler. */
export type AuthEndpoint = EndpointDefinition & { handler: EndpointHandler }

/** 创建端点。 / Create an endpoint. */
export function createAuthEndpoint(
  path: string,
  options: Omit<EndpointDefinition, 'path'>,
  handler: EndpointHandler,
): AuthEndpoint {
  return { path, ...options, handler }
}

/** 创建服务端专用端点（不进 HTTP 路由）。 / Create a server-only endpoint (off the HTTP router). */
createAuthEndpoint.serverOnly = (
  path: string,
  options: Omit<EndpointDefinition, 'path'>,
  handler: EndpointHandler,
): AuthEndpoint => createAuthEndpoint(path, { ...options, metadata: { ...options.metadata, SERVER_ONLY: true } }, handler)

/** 路由匹配产物。 / The route match product. */
export interface RouteMatch {
  endpoint: AuthEndpoint
  params: Record<string, string>
}

/** 单条路径匹配：":name" 段绑定参数。 / Single-path match: ":name" segments bind params. */
function matchPath(pattern: string, segments: readonly string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter((part) => part !== '')
  if (parts.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index] ?? ''
    if (part.startsWith(':')) {
      params[part.slice(1)] = segments[index] ?? ''
      continue
    }
    if (part !== segments[index]) return null
  }
  return params
}

/** 在路由表中查找：方法必须一致，路径按声明顺序。 / Look up the table: the method must match, paths in declaration order. */
export function matchRoute(table: EndpointTable, method: string, path: string): RouteMatch | null {
  const segments = path.split('/').filter((part) => part !== '')
  for (const endpoint of Object.values(table)) {
    if (endpoint.method !== method) continue
    const params = matchPath(endpoint.path, segments)
    if (params !== null) return { endpoint, params }
  }
  return null
}

/**
 * 构建路由表：插件端点按键合并（后者覆盖，冲突告警）→ 核心端点（同路径
 * 命中即告警并保留在位者）→ 终末端点（ok/error，强制覆盖不可让渡）。
 * / Build the route table: plugin endpoints merge by key (later wins,
 * conflicts warn) → core endpoints (a duplicate path warns and keeps the
 * incumbent) → final endpoints (ok/error, force-overriding).
 */
export function buildRouteTable(context: AuthContext, coreEndpoints: readonly AuthEndpoint[], finalEndpoints: readonly AuthEndpoint[] = []): EndpointTable {
  const table: EndpointTable = {}
  for (const plugin of context.plugins) {
    for (const [key, endpoint] of Object.entries(plugin.endpoints ?? {})) {
      if (table[key] !== undefined && table[key]?.path !== endpoint.path) {
        context.logger.error(`endpoint path conflict on key "${key}": ${table[key]?.path} overridden by ${endpoint.path}`)
      }
      table[key] = endpoint
    }
  }
  for (const endpoint of coreEndpoints) {
    const existing = Object.values(table).find((candidate) => candidate.path === endpoint.path && candidate.method === endpoint.method)
    if (existing !== undefined) {
      context.logger.error(`endpoint path conflict: ${endpoint.method} ${endpoint.path} already registered`)
      continue
    }
    table[`${endpoint.method} ${endpoint.path}`] = endpoint
  }
  for (const endpoint of finalEndpoints) {
    table[`${endpoint.method} ${endpoint.path}`] = endpoint
  }
  return table
}
