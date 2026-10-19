/**
 * The route table: audience-prefixed paths, `:param` segments and method
 * matching.
 *
 * A provider registers a path relative to its audience (`/users`), and the
 * table derives the public path (`/api/admin/v1/users`). Matching is exact on
 * segment count, so `/users/all` never shadows `/users/:id`.
 *
 * 路由表：受众前缀路径、`:param` 段与方法匹配。provider 注册相对其受众的路径
 * （`/users`），表据此推导公开路径（`/api/admin/v1/users`）。匹配按段数精确对齐，
 * 因此 `/users/all` 永远不会遮蔽 `/users/:id`。
 *
 * @module @veren/admin-api-kernel/router
 */

import { AdminError, type AdminRoute, type ApiAudience } from '@veren/admin-contract'

/**
 * The public path of one route.
 *
 * @param audience - caller audience 调用方受众
 * @param path - audience-relative path 相对受众的路径
 * @returns the absolute API path 绝对 API 路径
 */
export function routePath(audience: ApiAudience, path: string): string {
  const suffix = path === '/' || path === '' ? '' : path.startsWith('/') ? path : `/${path}`
  return `/api/${audience}/v1${suffix}`
}

/** One compiled route. 一条编译后的路由。 */
interface CompiledRoute {
  /** The public contract of the route. 路由的公开契约。 */
  readonly route: AdminRoute
  /** Absolute path. 绝对路径。 */
  readonly path: string
  /** Path segments split on `/`. 按 `/` 拆分的路径段。 */
  readonly segments: readonly string[]
}

/** Result of a successful match. 成功匹配的结果。 */
export interface RouteMatch {
  /** The matched route. 匹配到的路由。 */
  readonly route: AdminRoute
  /** Captured path parameters. 捕获的路径参数。 */
  readonly params: Readonly<Record<string, string>>
  /** The route's absolute path. 路由的绝对路径。 */
  readonly path: string
}

/**
 * Split a pathname into segments, ignoring the leading and trailing slashes.
 *
 * @param pathname - absolute pathname 绝对路径
 * @returns the non-empty segments 非空路径段
 */
export function pathSegments(pathname: string): readonly string[] {
  return pathname.split('/').filter((segment) => segment.length > 0)
}

/** The route registry. 路由注册表。 */
export class RouteTable {
  /** Registered routes in registration order. 按注册顺序的路由。 */
  private readonly routes: CompiledRoute[] = []

  /**
   * Register one route.
   *
   * @param route - the route contract 路由契约
   * @returns the disposer removing it 移除它的 disposer
   * @throws AdminError `CONFLICT` when the method and path are already taken 方法与路径已被占用时抛出
   */
  add(route: AdminRoute): () => void {
    const path = routePath(route.audience, route.path)
    if (this.routes.some((entry) => entry.path === path && entry.route.method === route.method)) {
      throw new AdminError('CONFLICT', `route ${route.method} ${path} is already registered`, { path, method: route.method })
    }
    const compiled: CompiledRoute = { route, path, segments: pathSegments(path) }
    this.routes.push(compiled)
    return () => {
      const index = this.routes.indexOf(compiled)
      if (index >= 0) this.routes.splice(index, 1)
    }
  }

  /**
   * Every registered route, in registration order.
   *
   * @returns the route contracts 路由契约
   */
  list(): readonly AdminRoute[] {
    return this.routes.map((entry) => entry.route)
  }

  /**
   * Match one request.
   *
   * @param pathname - absolute pathname 绝对路径
   * @param method - request method 请求方法
   * @returns the match, the marker `method-not-allowed`, or `undefined` 匹配结果、
   *   `method-not-allowed` 标记或 `undefined`
   */
  match(pathname: string, method: string): RouteMatch | 'method-not-allowed' | undefined {
    const segments = pathSegments(pathname)
    let pathMatched = false
    for (const entry of this.routes) {
      const params = matchSegments(entry.segments, segments)
      if (params === undefined) continue
      pathMatched = true
      if (entry.route.method !== method) continue
      return { route: entry.route, params, path: entry.path }
    }
    return pathMatched ? 'method-not-allowed' : undefined
  }
}

/**
 * Match one compiled pattern against request segments.
 *
 * @param pattern - compiled segments 编译后的路径段
 * @param actual - request segments 请求路径段
 * @returns captured parameters, or `undefined` when the pattern does not match 捕获参数；不匹配为 `undefined`
 */
function matchSegments(
  pattern: readonly string[],
  actual: readonly string[],
): Record<string, string> | undefined {
  if (pattern.length !== actual.length) return undefined
  const params: Record<string, string> = {}
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index] as string
    const received = actual[index] as string
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(received)
      continue
    }
    if (expected !== received) return undefined
  }
  return params
}
