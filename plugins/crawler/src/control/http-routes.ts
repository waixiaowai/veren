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
import { listDataFiles, previewDataFile, readDataFile, type DataFileInfo } from './data.ts'
import type { CrawlerManager } from './manager.ts'
import type { CrawlerRunRequest } from './runner.ts'
import { CRAWLER_TYPES, LOGIN_TYPES, PLATFORMS, SAVE_DATA_OPTIONS } from '../constants.ts'
import { CrawlerError } from '../errors.ts'

/** 路由依赖面 / the route dependencies */
export interface RouteDeps {
  manager: CrawlerManager
  dataRoot: string
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
  for (const field of ['platform', 'loginType', 'crawlerType', 'saveOption'] as const) {
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
      save_options: SAVE_DATA_OPTIONS,
    })
  }
  return null
}

/** 处理 /api/data/* 路由 / handle the /api/data/* routes */
export async function handleDataRoutes(
  method: string,
  pathname: string,
  query: URLSearchParams,
  deps: RouteDeps,
): Promise<RouteResult | null> {
  if (pathname === '/api/data/files' && method === 'GET') {
    const files = await listDataFiles(deps.dataRoot)
    const platform = query.get('platform')
    const fileType = query.get('file_type')
    return json(200, { files: filterFiles(files, platform, fileType) })
  }
  if (pathname.startsWith('/api/data/stats') && method === 'GET') {
    return json(200, await dataStats(deps.dataRoot))
  }
  if (pathname.startsWith('/api/data/download/') && method === 'GET') {
    return await download(deps.dataRoot, decodeURIComponent(pathname.slice('/api/data/download/'.length)))
  }
  if (pathname.startsWith('/api/data/files/') && method === 'GET') {
    return await preview(deps.dataRoot, pathname, query)
  }
  return null
}

/** 平台/类型过滤 / platform and type filtering */
function filterFiles(files: DataFileInfo[], platform: string | null, fileType: string | null): DataFileInfo[] {
  return files.filter(
    (file) =>
      (platform === null || file.path.startsWith(platform + '/')) &&
      (fileType === null || file.fileType === fileType),
  )
}

/** 预览路由 / the preview route */
async function preview(dataRoot: string, pathname: string, query: URLSearchParams): Promise<RouteResult> {
  const relativePath = decodeURIComponent(pathname.slice('/api/data/files/'.length))
  if (query.get('preview') === 'true') {
    const limit = Number(query.get('limit') ?? '100')
    return json(200, await previewDataFile(dataRoot, relativePath, Number.isFinite(limit) ? limit : 100))
  }
  return await download(dataRoot, relativePath)
}

/** 下载路由：原样字节返回 / the download route: raw bytes back */
async function download(dataRoot: string, relativePath: string): Promise<RouteResult> {
  const bytes = await readDataFile(dataRoot, relativePath)
  return { status: 200, body: null, bytes, contentType: 'application/octet-stream' }
}

/** 数据统计 / the data stats */
async function dataStats(dataRoot: string): Promise<{ total_files: number; total_size: number; by_platform: Record<string, number> }> {
  const files = await listDataFiles(dataRoot)
  const byPlatform: Record<string, number> = {}
  let totalSize = 0
  for (const file of files) {
    totalSize += file.size
    const platform = file.path.includes('/') ? file.path.split('/')[0] : '(root)'
    byPlatform[platform] = (byPlatform[platform] ?? 0) + 1
  }
  return { total_files: files.length, total_size: totalSize, by_platform: byPlatform }
}
