/**
 * The gate itself: route handlers and the data-gate waterfall. Unauthenticated
 * browsers only ever reach `/login`, `/auth/**` (Better Auth) and public
 * static assets; a valid Better Auth session re-triggers the official launch
 * token exchange and then serves the SPA index; every authenticated `/api`
 * request is re-checked against the Better Auth session before the bridge.
 * 门禁本体：路由处理器与数据闸门 waterfall。未登录浏览器只能到达 `/login`、
 * `/auth/**`（Better Auth）与公开静态资源；持有效 Better Auth 会话后由插件
 * 代为触发官方 launch token 兑换再提供 SPA 入口；每条已认证的 `/api` 请求在
 * 进入桥接前都要再过一次 Better Auth 会话校验。
 * @module src/gate
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { LoginGateAuth } from './auth.js'
import { renderLoginPage } from './login-page.js'

/** HTML index response content type. HTML 入口响应的 content type。 */
const HTML_TYPE = 'text/html; charset=utf-8'

/** Login page path. 登录页路径。 */
export const LOGIN_PATH = '/login'

/** Minimal cache policy shared by every gate response. 门禁响应共用的最简缓存策略。 */
const NO_STORE = { 'cache-control': 'no-store' }

/**
 * The WebServer service plus the origin/protocol facts the running host's
 * source-level surface carries (the last published rc.2 type bundle does not
 * declare them yet). A structural intersection keeps this a local type — no
 * module augmentation, no runtime difference.
 * WebServer 服务加上运行中宿主源码级面携带的 origin/protocol 事实（已发布的
 * rc.2 类型包尚未声明）。结构化交叉类型保持局部性——不做模块增强，运行时无差异。
 */
export type GateWebServer = WebServer & {
  /** Root URL of the bound listener, e.g. `http://127.0.0.1:3080`. 监听器根 URL。 */
  getOrigin(): string
  /** The protocol the listener speaks, from TLS config only. 监听器协议，仅由 TLS 配置决定。 */
  readonly protocol: 'http:' | 'https:'
}

/** Services the gate closes over. 门禁闭包持有的服务。 */
export interface GateServices {
  readonly webServer: GateWebServer
  readonly connection: HostConnectionHandle
  readonly auth: LoginGateAuth
  /** Absolute path of index.html inside the dist root. dist 根内 index.html 的绝对路径。 */
  readonly distIndex: string
}

/** Convert node request headers to a fetch Headers object. node 请求头转 fetch Headers。 */
function headersOf(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(entry => headers.append(name, entry))
    else if (value !== undefined) headers.set(name, value)
  }
  return headers
}

/** Read the whole request body (auth payloads are tiny JSON). 读取整个请求体（认证载荷都是小 JSON）。 */
async function bodyOf(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Translate one node request into the fetch Request Better Auth expects. 将 node 请求翻译为 Better Auth 期望的 fetch Request。 */
async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  return new Request(origin + (req.url ?? '/'), {
    method: req.method,
    headers: headersOf(req),
    body: await bodyOf(req),
    // undici requires the duplex hint whenever a streaming body is present.
    // 只要存在流式 body，undici 就要求 duplex 提示。
    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { duplex: 'half' }),
  } as RequestInit)
}

/** Write one fetch Response onto the node response, Set-Cookie list included. 将 fetch Response 写回 node 响应，含 Set-Cookie 列表。 */
async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name === 'set-cookie') return
    headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
}

/** 303 redirect with the gate's no-store policy. 带门禁 no-store 策略的 303 重定向。 */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { ...NO_STORE, location, 'referrer-policy': 'no-referrer' })
  res.end()
}

/** 401 that never distinguishes missing session from expired session. 不区分“无会话/会话过期”的 401。 */
function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' })
  res.end('login required\n')
}

/** Resolve the Better Auth session of one request, if any. 解析请求的 Better Auth 会话（若有）。 */
export async function sessionOf(services: GateServices, req: IncomingMessage): Promise<unknown> {
  const session = await services.auth.api.getSession({ headers: headersOf(req) })
  return session?.session ?? null
}

/** Serve the Better Auth handler for one `/auth/**` request. 将 `/auth/**` 请求交给 Better Auth 处理。 */
export async function handleAuth(services: GateServices, req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
  await writeResponse(res, await services.auth.handler(await toWebRequest(req, origin)))
}

/** Serve the public login page. 提供公开登录页。 */
export function handleLoginPage(res: ServerResponse, origin: string): void {
  res.writeHead(200, { ...NO_STORE, 'content-type': HTML_TYPE })
  res.end(renderLoginPage(origin))
}

/** Serve the rendered SPA index after Connection authorized it. 在 Connection 授权后提供渲染好的 SPA 入口。 */
async function serveIndex(services: GateServices, res: ServerResponse): Promise<void> {
  const html = services.webServer.renderIndex(await readFile(services.distIndex, 'utf8'))
  const body = html.replace(/<head(?:\s[^>]*)?>/i, (open: string) => `${open}<base href="./">`)
  res.writeHead(200, { ...NO_STORE, 'content-type': HTML_TYPE })
  res.end(body)
}

/**
 * Gate one SPA entry request (`/` or `/index.html`):
 * 1. no Better Auth session → 303 to the login page (the launch token in the
 *    URL is dropped, so no `dsh-auth-*` cookie can ever be minted here);
 * 2. session but no token in the URL → re-trigger the official exchange by
 *    redirecting to the tokenized URL Connection produces;
 * 3. session + token → `authorizeIndex` mints the `dsh-auth-*` cookie and
 *    redirects to the clean path, or an existing cookie lets us serve index.
 * 门禁处理 SPA 入口请求（`/` 或 `/index.html`）：
 * 1. 无 Better Auth 会话 → 303 到登录页（丢弃 URL 中的 launch token，因此这里
 *    永远不会铸出 `dsh-auth-*` Cookie）；
 * 2. 有会话但 URL 无 token → 重定向到 Connection 生成的带 token URL，
 *    代为重新触发官方兑换；
 * 3. 会话 + token → `authorizeIndex` 铸出 `dsh-auth-*` Cookie 并重定向到干净
 *    路径；已有 Cookie 时直接提供入口页。
 */
export async function handleIndex(services: GateServices, req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
  if (await sessionOf(services, req) === null) {
    redirect(res, LOGIN_PATH)
    return
  }
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  // An already-exchanged browser carries a `dsh-auth-*` cookie (Connection's
  // stable prefix): delegate to Connection, which serves authorization for it.
  // Without token and cookie, re-trigger the official exchange by redirecting
  // to the tokenized URL; with a token, Connection owns the mint response.
  // 已兑换的浏览器携带 `dsh-auth-*` Cookie（Connection 的稳定前缀）：委托
  // Connection 判定。既无 token 也无 Cookie 时重定向到带 token URL 代为触发
  // 兑换；有 token 时铸造响应归 Connection。
  const exchanged = String(req.headers.cookie ?? '').includes('dsh-auth-')
  if (!url.searchParams.has('token') && !exchanged) {
    // The token exchange needs an absolute URL; a relative base is invalid.
    // token 兑换需要绝对 URL；相对地址是非法的。
    redirect(res, services.connection.authenticatedUrl(origin))
    return
  }
  if (!services.connection.authorizeIndex(req, res)) return
  await serveIndex(services, res)
}

/**
 * The data-gate waterfall listener: every admitted `/api` request re-proves
 * the Better Auth session before its body transfers; denial short-circuits
 * the waterfall on purpose (the 401 response is fully owned here).
 * 数据闸门 waterfall 监听器：每条已准入的 `/api` 请求在传输 body 前再次证明
 * Better Auth 会话；拒绝时有意短路 waterfall（401 响应完全由本监听器负责）。
 * @param services - The gate services.
 * @returns the waterfall listener.
 */
export function dataGateListener(services: GateServices): (
  req: IncomingMessage, res: ServerResponse, next: () => Promise<void>,
) => Promise<void> {
  return async (req, res, next) => {
    if (await sessionOf(services, req) === null) {
      unauthorized(res)
      return
    }
    await next()
  }
}

/**
 * Register every gate route and the data-gate waterfall on one context; all
 * registrations are effects so unloading disposes them in reverse order.
 * @param ctx - The plugin context.
 * @param services - The gate services.
 * @param origin - Listener origin for Better Auth requests.
 */
export function installGate(ctx: Context, services: GateServices, origin: string): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/',
    handler: (req, res) => handleIndex(services, req, res, origin),
  }), 'web-login-gate: / route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/index.html',
    handler: (req, res) => handleIndex(services, req, res, origin),
  }), 'web-login-gate: /index.html route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: LOGIN_PATH,
    handler: (_req, res) => handleLoginPage(res, origin),
  }), `web-login-gate: ${LOGIN_PATH} route`)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/auth',
    handler: (req, res) => handleAuth(services, req, res, origin),
  }), 'web-login-gate: /auth prefix route')
  ctx.effect(() => ctx.on('connection/request', dataGateListener(services)), 'web-login-gate: connection/request data gate')
}
