/**
 * HTTP 路由处理：api.md 端点到控制服务的映射（design/api.md §1）。
 * HTTP route handlers: mapping the api.md endpoints onto the control
 * services (design/api.md §1).
 *
 * 错误映射规则（§2 Mapping Rules）：参数类 400、越界 403、缺失 404、
 * 其余 500；响应体统一 JSON，错误携带稳定 code。
 * Error mapping (§2): args 400, escape 403, missing 404, others 500;
 * bodies are JSON with a stable code on errors.
 *
 * @module @veren/crawler/control/http-routes
 */
import type { CrawlerManager } from './manager.ts'
import type { CrawlerRunRequest } from './runner.ts'
import type { CrawlerStore } from '../store/domain.ts'
import { CRAWLER_TYPES, LOGIN_TYPES, PLATFORMS, } from '../constants.ts'
import { CrawlerError } from '../errors.ts'

/** 路由依赖面 / the route dependencies */
export interface RouteDeps {
  manager: CrawlerManager

  /** 已打开存储域（`dsh` 介质数据面）/ the opened storage domain (the `dsh` medium data face) */
  domain?: () => CrawlerStore | undefined
}

/** 统一响应 / the uniform response envelope */
export interface RouteResult {
  status: number
  body: unknown
  /** 下载等场景的原样字节 / raw bytes for downloads */
  bytes?: Buffer
  contentType?: string
}

/** JSON 响应 / a json response */
function json(status: number, body: unknown): RouteResult {
  return { status, body }
}

/** CrawlerError → HTTP 状态 / CrawlerError → http status */
export function statusOfError(error: CrawlerError): number {
  if (error.code === 'DATA_PATH_OUT_OF_ROOT') return 403
  if (error.code === 'DATA_FILE_NOT_FOUND') return 404
  if (error.code.startsWith('INVALID_')) return 400
  return 500
}

/** 把启动请求体映射为运行请求（字段名按 api.md §2）/ map the start body onto the run request (field names per api.md §2) */
export function parseStartBody(raw: Record<string, unknown>): CrawlerRunRequest {
  const request = raw as unknown as CrawlerRunRequest
  for (const field of ['platform', 'loginType', 'crawlerType'] as const) {
    if (typeof request[field] !== 'string') throw new CrawlerError('INVALID_ARGUMENT', `参数 ${field} 取值非法`, { field })
  }
  for (const field of ['enableComments', 'enableSubComments', 'enableMedia', 'headless'] as const) {
    if (typeof request[field] !== 'boolean') throw new CrawlerError('INVALID_ARGUMENT', `参数 ${field} 取值非法`, { field })
  }
  return request
}

/** 处理 /api/crawler/* 路由 / handle the /api/crawler/* routes */
export async function handleCrawlerRoutes(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  deps: RouteDeps,
): Promise<RouteResult | null> {
  if (pathname === '/api/crawler/start' && method === 'POST') {
    if (body === null) throw new CrawlerError('INVALID_ARGUMENT', '请求体不能为空', { field: 'body' })
    return json(200, await deps.manager.start(parseStartBody(body)))
  }
  if (pathname === '/api/crawler/stop' && method === 'POST') return json(200, await deps.manager.stop())
  if (pathname === '/api/crawler/status' && method === 'GET') return json(200, deps.manager.status())
  if (pathname === '/api/crawler/logs' && method === 'GET') {
    const limit = Number(query.get('limit') ?? '100')
    return json(200, { logs: deps.manager.logs.recent(Number.isFinite(limit) ? limit : 100) })
  }
  return null
}

/** 处理 /api/config/* 与 /api/health / handle the /api/config/* and /api/health routes */
export function handleConfigRoutes(method: string, pathname: string): RouteResult | null {
  if (pathname === '/api/health' && method === 'GET') return json(200, { status: 'ok' })
  if (pathname === '/api/config/platforms' && method === 'GET') {
    return json(200, { platforms: PLATFORMS.map((value) => ({ value, label: value })) })
  }
  if (pathname === '/api/config/options' && method === 'GET') {
    return json(200, {
      login_types: LOGIN_TYPES,
      crawler_types: CRAWLER_TYPES,
    })
  }
  return null
}

/** 处理 /api/data/* 路由（存储域只读面；文件介质已移除）/ handle the /api/data/* routes (the storage-domain read face; file media removed) */
export async function handleDataRoutes(
  method: string,
  pathname: string,
  query: URLSearchParams,
  deps: RouteDeps,
): Promise<RouteResult | null> {
  if (pathname === '/api/data/domain' && method === 'GET') {
    return json(200, domainSummary(deps, query.get('platform')))
  }
  return null
}


/**
 * 存储域数据面：按平台统计 contents/comments 行数与首屏预览（`dsh` 介质
 * 的只读浏览面；域未开时明确返回 open:false；`platform` 查询参数过滤）。
 * The storage-domain data face: per-platform contents/comments counts plus
 * a first-screen preview (read-only; open:false when the domain is not
 * open; the `platform` query filters).
 */
function domainSummary(deps: RouteDeps, platformFilter: string | null): { open: boolean; contents: number; comments: number; by_platform: Record<string, number>; preview: unknown[] } {
  const domain = deps.domain?.()
  if (domain === undefined) return { open: false, contents: 0, comments: 0, by_platform: {}, preview: [] }
  const matches = (key: string): boolean => platformFilter === null || key.startsWith(platformFilter + '::')
  const contents = [...domain.table('contents').entries()].filter(([key]) => matches(key))
  const comments = [...domain.table('comments').entries()].filter(([key]) => matches(key))
  const byPlatform: Record<string, number> = {}
  for (const [key] of contents) {
    const platform = key.split('::')[0] ?? '?'
    byPlatform[platform] = (byPlatform[platform] ?? 0) + 1
  }
  const preview = contents.slice(0, 5).map(([, row]) => row)
  return { open: true, contents: contents.length, comments: comments.length, by_platform: byPlatform, preview }
}
