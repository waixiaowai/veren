/**
 * HTTP 服务器：node:http 实现的单端口控制面板后端（design/modules/api.md）。
 * The http server: the single-port control-panel backend on node:http
 * (design/modules/api.md).
 *
 * 单机本地使用、不设账号体系（设计边界记录于 review.md）；WebSocket 实时
 * 推送（ws-logs/ws-status）属后续迭代，当前以轮询端点提供同等能力。
 * Local single-machine use, no account system (a design boundary recorded
 * in review.md); the websocket push channels (ws-logs/ws-status) land in a
 * later iteration — polling endpoints provide the same capability today.
 *
 * @module @veren/crawler/control/http-server
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  handleConfigRoutes,
  handleCrawlerRoutes,
  handleDataRoutes,
  statusOfError,
  type RouteDeps,
  type RouteResult,
} from './http-routes.ts'
import { CrawlerError } from '../errors.ts'

/** 读请求体（限 1MB）/ read the request body (capped at 1MB) */
async function readBody(req: { on: (event: string, listener: (...args: unknown[]) => void) => void }): Promise<Record<string, unknown> | null> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (...args: unknown[]) => {
      const chunk = args[0] as Buffer
      size += chunk.length
      if (size > 1_000_000) {
        reject(new CrawlerError('INVALID_ARGUMENT', '请求体过大', { field: 'body' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>)
      } catch {
        reject(new CrawlerError('INVALID_ARGUMENT', '请求体不是合法 JSON', { field: 'body' }))
      }
    })
    req.on('error', (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

/** 写 JSON 或字节响应 / write a json or bytes response */
function writeResponse(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (data?: string | Buffer) => void }, result: RouteResult): void {
  if (result.bytes !== undefined) {
    res.writeHead(result.status, { 'Content-Type': result.contentType ?? 'application/octet-stream' })
    res.end(result.bytes)
    return
  }
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(result.body))
}

/** 写错误响应 / write an error response */
function writeError(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (data?: string | Buffer) => void }, error: unknown): void {
  if (error instanceof CrawlerError) {
    writeResponse(res, { status: statusOfError(error), body: { code: error.code, message: error.message, fields: error.fields } })
    return
  }
  writeResponse(res, { status: 500, body: { code: 'INTERNAL', message: String(error) } })
}

/** 分发一个请求到各路由族 / dispatch one request across the route families */
async function dispatch(method: string, pathname: string, query: URLSearchParams, body: Record<string, unknown> | null, deps: RouteDeps): Promise<RouteResult | null> {
  const configRoute = handleConfigRoutes(method, pathname)
  if (configRoute !== null) return configRoute
  const crawlerRoute = await handleCrawlerRoutes(method, pathname, query, body, deps)
  if (crawlerRoute !== null) return crawlerRoute
  return await handleDataRoutes(method, pathname, query, deps)
}

/** 控制服务器 / the control server */
export class ControlServer {
  private server: Server | null = null

  constructor(private readonly deps: RouteDeps) {}

  /** 监听随机可用端口，返回实际端口 / listen on a free port and return the actual port */
  async start(preferredPort: number = 0): Promise<number> {
    const server = createServer((req, res) => {
      void this.serve(req, res)
    })
    this.server = server
    return await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(preferredPort, '127.0.0.1', () => {
        resolve((server.address() as AddressInfo).port)
      })
    })
  }

  /** 处理单请求 / serve one request */
  private async serve(req: { method?: string; url?: string; on: (event: string, listener: (...args: unknown[]) => void) => void }, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (data?: string | Buffer) => void }): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    try {
      const body = req.method === 'POST' ? await readBody(req) : null
      const result = await dispatch(req.method ?? 'GET', url.pathname, url.searchParams, body, this.deps)
      if (result === null) {
        writeResponse(res, { status: 404, body: { code: 'NOT_FOUND', message: `未知端点: ${url.pathname}` } })
        return
      }
      writeResponse(res, result)
    } catch (error) {
      writeError(res, error)
    }
  }

  /** 停止监听 / stop listening */
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (server === null) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
}
