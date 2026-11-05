/**
 * 控制服务 API：挂载在 DSH 宿主 web 服务器上的路由族
 * （不启动独立端口；宿主注入 `webServer`，register 返回 disposer）。
 * The control-service api: route families mounted on the DSH host web
 * server (no standalone port; the host injects `webServer`, register
 * returns a disposer).
 *
 * 单机本地使用、不设账号体系（设计边界记录于 review.md）；WebSocket 实时
 * 推送（ws-logs/ws-status）属后续迭代，当前以轮询端点提供同等能力。
 * Local single-machine use, no account system (a design boundary recorded
 * in review.md); the websocket push channels land in a later iteration —
 * polling endpoints provide the same capability today.
 *
 * @module @veren/crawler/control/http-server
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  handleConfigRoutes,
  handleCrawlerRoutes,
  handleDataRoutes,
  statusOfError,
  type RouteDeps,
  type RouteResult,
} from './http-routes.ts'
import { WsSession, writeHandshake } from './ws.ts'
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

/** 控制服务注册的路由族前缀 / the route-family prefixes this api claims */
const API_PREFIXES = ['/api/crawler', '/api/data', '/api/config', '/api/health'] as const

/** WS 推送状态帧间隔毫秒（design/api.md §6：每秒推送）/ the ws-status frame interval in ms (design api.md §6: once a second) */
const WS_STATUS_INTERVAL_MS = 1_000

/**
 * 控制服务 API：把路由族注册进宿主 web 服务器，卸载逆序清理。
 * The control api: registers the route families into the host web server,
 * disposing in reverse order on unload.
 */
export class ControlApi {
  constructor(private readonly deps: RouteDeps) {}

  /**
   * 注册到宿主 webServer；返回统一 disposer（HTTP 路由族 + WS 推送通道）。
   * Registers into the host webServer; returns one unified disposer (the
   * http route families plus the ws push channels).
   */
  register(ctx: Context): () => void {
    const disposers = API_PREFIXES.map((prefix) =>
      ctx.webServer.register({
        kind: 'prefix',
        path: prefix,
        handler: (req, res) => {
          void this.serve(req, res)
        },
      }),
    )
    disposers.push(...this.registerPushChannels(ctx))
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  /**
   * WS 推送通道注册：宿主不支持 upgrade 注册时返回空（轮询端点提供同等能力）。
   * The WS push channels: empty when the host lacks upgrade registration (the
   * polling endpoints provide the same capability).
   */
  private registerPushChannels(ctx: Context): Array<() => void> {
    if (typeof ctx.webServer.registerUpgrade !== 'function') return []
    // ws-logs：连接即补发历史日志再进入实时推送（design/api.md §6）。
    // ws-logs: replays buffered logs on connect, then pushes live (§6).
    const logs = ctx.webServer.registerUpgrade({
      path: '/api/ws/logs',
      handler: (req, socket, head) => {
        this.serveLogsSocket(req, socket as import('node:stream').Duplex, head)
      },
    })
    // ws-status：每秒推送状态对象（design/api.md §6）。
    // ws-status: pushes the status object once a second (§6).
    const status = ctx.webServer.registerUpgrade({
      path: '/api/ws/status',
      handler: (req, socket, head) => {
        this.serveStatusSocket(req, socket as import('node:stream').Duplex, head)
      },
    })
    return [logs, status]
  }

  /** ws-logs 通道：握手 → 补发历史 → 订阅实时 / the ws-logs channel: handshake → replay → live subscription */
  private serveLogsSocket(req: { headers: Record<string, string | string[] | undefined> }, socket: import('node:stream').Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    writeHandshake(socket, key)
    if (head.length > 0) socket.write(head)
    const session = new WsSession(socket, () => undefined)
    for (const entry of this.deps.manager.logs.recent(500)) {
      session.sendText(JSON.stringify(entry))
    }
    const unsubscribe = this.deps.manager.logs.subscribe((entry) => {
      session.sendText(JSON.stringify(entry))
    })
    socket.on('data', (chunk: Buffer) => session.feed(chunk))
    socket.on('close', unsubscribe)
  }

  /** ws-status 通道：握手 → 每秒推送状态 / the ws-status channel: handshake → status once a second */
  private serveStatusSocket(req: { headers: Record<string, string | string[] | undefined> }, socket: import('node:stream').Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    writeHandshake(socket, key)
    if (head.length > 0) socket.write(head)
    const session = new WsSession(socket, () => undefined)
    const timer = setInterval(() => {
      session.sendText(JSON.stringify(this.deps.manager.status()))
    }, WS_STATUS_INTERVAL_MS)
    timer.unref?.()
    socket.on('data', (chunk: Buffer) => session.feed(chunk))
    socket.on('close', () => {
      clearInterval(timer)
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
}
