/**
 * @veren/web-login-gate — the Better Auth login gate for the dsh Web GUI.
 * Only a browser that signed in with email + password reaches the SPA entry
 * or any `/api` request. Built only on official composition points: named
 * webServer routes on the free `/`, `/index.html`, `/login` and `/auth`
 * seats, `ctx.connection.authorizeIndex()` / `authenticatedUrl()`, the
 * `connection/request` waterfall, the `ctx.credentials` service, and a
 * self-declared storage domain. No official package code is modified.
 * @veren/web-login-gate — dsh Web GUI 的 Better Auth 登录门禁。只有以邮箱+密码
 * 登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求。仅使用官方组合点：
 * webServer 空闲位上的命名路由（`/`、`/index.html`、`/login`、`/auth`）、
 * `ctx.connection.authorizeIndex()` / `authenticatedUrl()`、
 * `connection/request` waterfall、`ctx.credentials` 服务，以及自声明的存储
 * domain。不修改任何官方包代码。
 * @module @veren/web-login-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import { bootstrapAdmin, buildBetterAuth, loadAuthSecret } from './auth.js'
import type { AdminSeed } from './auth.js'
import { LOGIN_GATE_DOMAIN_NAME, loginGateDomain } from './domain.js'
import type { LoginGateDomain } from './domain.js'
import { installGate } from './gate.js'
import type { GateWebServer } from './gate.js'

/** Service token, doubling as the plugin display name. 服务令牌，兼作插件显示名。 */
export const name = 'web-login-gate'

/**
 * Dependencies: the web carrier, Connection (token exchange + data gate
 * event), the storage domain facility, the credential service, and the
 * storage hub (backend route validation).
 * 依赖：Web 载体、Connection（token 兑换与数据闸门事件）、存储 domain 设施、
 * 凭据服务，以及存储枢纽（用于校验后端路由）。
 */
export const inject = ['webServer', 'connection', 'storageDomain', 'credentials', 'storage'] as const

/** Normalized plugin config. 归一化的插件配置。 */
export interface Config {
  /**
   * Absolute path of index.html inside the frontend dist root — the same
   * anchor `frontend-static` receives, typically supplied via a `!!js`
   * expression in the profile patch.
   * 前端 dist 根内 index.html 的绝对路径——与 `frontend-static` 接收的锚点
   * 相同，通常由 profile patch 的 `!!js` 表达式提供。
   */
  distIndex: string
  /** Browser session lifetime in days. @default 7 浏览器会话时长（天）。 */
  sessionDays?: number
  /**
   * Sign-in rate limit (brute-force protection): `max` failures per `window`
   * seconds. @default 60s / 10 登录限流（暴力尝试防护）：每 `window` 秒最多
   * `max` 次。
   */
  rateLimit?: { window: number, max: number }
  /**
   * First-run administrator seed. Consumed once: the stored account is the
   * password hash Better Auth wrote, so later restarts never read this value.
   * 首次运行管理员种子。只消费一次：落库的是 Better Auth 写入的密码哈希，
   * 之后的重启不再读取该配置。
   */
  admin?: AdminSeed
  /**
   * Storage routing intent for the login-gate domain, in the storage group's
   * `backend`/`routes` shape. The routes themselves stay owned by the
   * `storage-domain` row; this plugin validates that every name here is a
   * registered backend and fails loud otherwise.
   * 登录门禁 domain 的存储路由意向，遵循 storage group 的 `backend`/`routes`
   * 形态。路由本身仍由 `storage-domain` 行拥有；本插件只校验这里出现的每个
   * 名字都是已注册后端，否则显式失败。
   */
  storage?: { backend: string, routes?: Record<string, string> }
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
  sessionDays: z.natural().min(1).max(365).default(7),
  rateLimit: z.object({
    window: z.natural().min(1).default(60),
    max: z.natural().min(1).default(10),
  }).default(undefined as never),
  admin: z.object({
    email: z.string().required(),
    password: z.string().min(8).required(),
    name: z.string().required(),
  }).default(undefined as never),
  storage: z.object({
    backend: z.string().required(),
    routes: z.dict(z.string()).default({}),
  }).default({ backend: 'json', routes: {} }),
})

/**
 * Verify that every backend name this plugin's storage intent names is a
 * registered backend. The route decision itself stays with the
 * `storage-domain` row; this check only turns a typo into a loud load
 * failure instead of a surprising default-medium write.
 * @param ctx - Plugin context carrying the storage hub.
 * @param storage - The validated `storage` config section.
 * @throws naming the unregistered backend and the currently registered names.
 */
function assertStorageRoutes(ctx: Context, storage: Config['storage']): void {
  const routes = storage ?? { backend: 'json', routes: {} }
  const names = new Set([routes.backend, ...Object.values(routes.routes ?? {})])
  for (const backend of names) {
    try {
      ctx.storage.backend.get(backend)
    } catch {
      throw new Error(
        `web-login-gate: storage backend '${backend}' routed for domain '${LOGIN_GATE_DOMAIN_NAME}' is not registered`
        + ` (registered: ${ctx.storage.backend.names().join(', ') || 'none'})`
        + ` — align plugin config storage.backend/storage.routes with the storage group's backend/routes`,
      )
    }
  }
}

/**
 * Open the login-gate domain and register its `close()` disposer. A failing
 * open (already-open, backend-not-found, invalid-record from a corrupt
 * medium, …) is rethrown with the domain name and structured error code so
 * the boot report pinpoints the cause.
 * 打开登录门禁 domain 并注册其 `close()` disposer。打开失败（already-open、
 * backend-not-found、介质损坏导致的 invalid-record 等）会带上 domain 名与
 * 结构化错误码重新抛出，让启动报告能定位原因。
 * @param ctx - Plugin context carrying the domain facility.
 * @returns the opened domain handle.
 */
async function openDomain(ctx: Context): Promise<LoginGateDomain> {
  try {
    const domain = await ctx.storageDomain.open(loginGateDomain)
    ctx.effect(() => async () => { await domain.close() }, 'web-login-gate: domain close')
    return domain
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'unknown'
    throw new Error(`web-login-gate: opening domain '${LOGIN_GATE_DOMAIN_NAME}' failed (${code}): ${String(error instanceof Error ? error.message : error)}`)
  }
}

/**
 * Assemble the gate: validate the storage routes, load the durable secret,
 * open the domain, build Better Auth, seed the admin once, then install the
 * routes and the data gate. Any failure fails the plugin load loudly — the
 * web server never degrades to an ungated state.
 * 装配门禁：校验存储路由、加载持久秘密、打开 domain、构建 Better Auth、
 * 一次性播种管理员，然后安装路由与数据闸门。任何失败都让插件加载显式失败
 * ——Web 服务器绝不会降级为无门禁状态。
 * @param ctx - Plugin context.
 * @param config - Validated plugin config.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  assertStorageRoutes(ctx, config.storage)
  const secret = await loadAuthSecret(ctx.credentials)
  const domain = await openDomain(ctx)
  // The running host's WebServer carries getOrigin()/protocol (source-level
  // surface); the last published rc.2 type bundle does not declare them yet,
  // so this one downcast names the facts the service really exposes.
  // 运行中宿主的 WebServer 具备 getOrigin()/protocol（源码级面）；已发布的
  // rc.2 类型包尚未声明，因此用这一次向下转型指称服务真正暴露的事实。
  const webServer = ctx.webServer as GateWebServer
  const origin = webServer.getOrigin()
  const auth = buildBetterAuth({
    domain,
    secret,
    origin,
    // The listener's own protocol is the only input to the cookie Secure
    // flag — never publicUrl or forwarded headers.
    // 监听器自身的协议是 Cookie Secure 标志的唯一依据——绝不使用 publicUrl
    // 或转发头。
    secure: webServer.protocol === 'https:',
    expiresInDays: config.sessionDays ?? 7,
    rateLimit: config.rateLimit ?? undefined,
  })
  if (config.admin !== undefined && config.admin !== null) {
    await bootstrapAdmin(auth, domain, config.admin)
  }
  installGate(ctx, {
    webServer,
    connection: ctx.connection,
    auth,
    distIndex: config.distIndex,
  }, origin)
}
