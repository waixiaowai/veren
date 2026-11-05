/**
 * @veren/web-login-gate — the auth-framework login gate for the dsh Web GUI.
 * Only a browser that signed in with email + password reaches the SPA entry
 * or any `/api` request. Built only on official composition points: named
 * webServer routes on the free `/`, `/index.html`, `/login` and `/auth`
 * seats, `ctx.connection.authorizeIndex()` / `authenticatedUrl()`, the
 * `connection/request` waterfall, the `ctx.credentials` service, a
 * `@veren/orm` sqlite database, and the `@veren/auth-core` framework
 * (per plugins/auth/design). No official package code is modified.
 * @veren/web-login-gate — dsh Web GUI 的认证框架登录门禁。只有以邮箱+密码
 * 登录成功的浏览器才能到达 SPA 入口或任何 `/api` 请求。仅使用官方组合点：
 * webServer 空闲位上的命名路由（`/`、`/index.html`、`/login`、`/auth`）、
 * `ctx.connection.authorizeIndex()` / `authenticatedUrl()`、
 * `connection/request` waterfall、`ctx.credentials` 服务、`@veren/orm`
 * sqlite 数据库，以及 `@veren/auth-core` 框架（依 plugins/auth/design）。
 * 不修改任何官方包代码。
 * @module @veren/web-login-gate
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Auth } from '@veren/auth-core'
import { buildAuthKit, bootstrapAdmin } from './auth-kit.js'
import type { AdminSeed } from './auth-kit.js'
import { openAuthDatabase, resolveDatabaseFile } from './database.js'
import { installGate, resolveListenerFacts } from './gate.js'
import type { GateWebServer } from './gate.js'
import { loadAuthSecret } from './secret.js'

/** Service token, doubling as the plugin display name. 服务令牌，兼作插件显示名。 */
export const name = 'web-login-gate'

/**
 * Dependencies: the web carrier, Connection (token exchange + data gate
 * event), and the credential service (signing secret).
 * 依赖：Web 载体、Connection（token 兑换与数据闸门事件），以及凭据服务
 * （签名秘密）。
 */
export const inject = ['webServer', 'connection', 'credentials'] as const

/** Normalized plugin config. 归一化的插件配置。 */
export interface Config {
  /**
   * Absolute path of index.html inside the frontend dist root. Omit it to let
   * the plugin locate the running runtime's `@deepseek-ai/dsh-web-frontend`
   * package; set it when the deployment replaces that frontend.
   * 前端 dist 根内 index.html 的绝对路径。省略时插件会定位运行中 runtime 的
   * `@deepseek-ai/dsh-web-frontend` 包；部署替换该前端时再显式设置。
   */
  distIndex?: string
  /**
   * Explicit listener origin override for host builds without
   * `webServer.getOrigin()`/`protocol` (e.g. 0.2.0-rc.2). When absent on such
   * a build, a plain-HTTP origin is derived from the port/host getters.
   * 针对 lacks `webServer.getOrigin()`/`protocol` 的宿主构建（如 0.2.0-rc.2）
   * 的显式 origin 覆盖。此类构建上缺省时，将从 port/host getter 推导纯 HTTP
   * origin。
   */
  publicOrigin?: string
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
   * scrypt hash the framework wrote, so later restarts never read this value.
   * 首次运行管理员种子。只消费一次：落库的是框架写入的 scrypt 哈希，之后的
   * 重启不再读取该配置。
   */
  admin?: AdminSeed
  /**
   * Absolute path of the sqlite database file. Empty/omitted resolves to
   * `<DSH_HOME>/storages/web_login_gate/auth.db`.
   * sqlite 数据库文件的绝对路径。空/省略时解析为
   * `<DSH_HOME>/storages/web_login_gate/auth.db`。
   */
  database?: { file?: string }
}

export const Config: z<Config> = z.object({
  distIndex: z.string().default(defaultDistIndex()),
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
  database: z.object({
    file: z.string().default(''),
  }).default({ file: '' }),
})

/**
 * Locate the Web frontend's index through the runtime that composes it.
 *
 * The profile plugin and the frontend live in different package trees, so a
 * fixed relative path cannot work across a packaged desktop (app.asar), a
 * source checkout, and a test node. DSH resolves `@deepseek-ai/*` from the
 * running runtime, which makes the frontend package locatable from here; a
 * deployment that replaces the frontend still overrides `config.distIndex`.
 *
 * 通过组合它的运行时定位 Web 前端入口。
 *
 * profile 插件与前端位于不同的包树，固定相对路径无法同时适用于打包桌面端
 * （app.asar）、源码检出和测试节点。DSH 从运行中的 runtime 解析
 * `@deepseek-ai/*`，因此这里可以定位前端包；替换前端的部署仍可用
 * `config.distIndex` 覆盖。
 *
 * @returns the absolute index path, or `''` when the frontend is absent.
 */
function defaultDistIndex(): string {
  try {
    return join(
      dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/package.json')),
      'dist',
      'index.html',
    )
  } catch {
    return ''
  }
}

/**
 * Assemble the gate: open the database, build the auth framework, resolve
 * the SPA entry, then install the routes and the data gate. Any failure
 * fails the plugin load loudly — the web server never degrades to an
 * ungated state.
 * 装配门禁：打开数据库、构建认证框架、解析 SPA 入口，然后安装路由与数据
 * 闸门。任何失败都让插件加载显式失败——Web 服务器绝不会降级为无门禁状态。
 * @param ctx - Plugin context.
 * @param config - Validated plugin config.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  // The running host's WebServer carries getOrigin()/protocol (source-level
  // surface); the last published rc.2 type bundle does not declare them yet,
  // so this one downcast names the facts the service really exposes.
  // 运行中宿主的 WebServer 具备 getOrigin()/protocol（源码级面）；已发布的
  // rc.2 类型包尚未声明，因此用这一次向下转型指称服务真正暴露的事实。
  const webServer = ctx.webServer as GateWebServer
  const { origin, secure } = resolveListenerFacts(webServer, config.publicOrigin, message => {
    ctx.logger.warn(new Error(message))
  })
  const secret = await loadAuthSecret(ctx.credentials)
  const databaseFile = resolveDatabaseFile(config.database?.file)
  const dataSource = await openAuthDatabase(databaseFile)
  ctx.effect(() => async () => { await dataSource.destroy() }, 'web-login-gate: auth database close')
  const auth: Auth = await buildAuthKit({
    dataSource,
    secret,
    origin,
    secure,
    expiresInDays: config.sessionDays ?? 7,
    rateLimit: config.rateLimit ?? undefined,
  })
  if (config.admin !== undefined && config.admin !== null) {
    await bootstrapAdmin(auth, config.admin)
  }
  const distIndex = resolveDistIndex(config.distIndex)
  installGate(ctx, {
    webServer,
    connection: ctx.connection,
    auth,
    distIndex,
  }, origin)
}

/**
 * Resolve the SPA entry: use the configured path when given, otherwise
 * locate the running runtime's frontend package. An unresolvable entry fails
 * the load loudly — the gate must never serve a broken index.
 * 解析 SPA 入口：优先使用配置路径，否则定位运行中 runtime 的前端包。解析
 * 失败会让加载显式失败——门禁绝不能服务一个坏掉的 index。
 * @param configured - The `distIndex` config value. `distIndex` 配置值。
 * @returns the absolute index path. index.html 的绝对路径。
 */
function resolveDistIndex(configured: string | undefined): string {
  const distIndex = configured === undefined || configured === ''
    ? defaultDistIndex()
    : configured
  if (distIndex === '') {
    throw new Error(
      'web-login-gate: cannot locate @deepseek-ai/dsh-web-frontend/dist/index.html; '
      + 'set config.distIndex to the Web frontend entry of this deployment',
    )
  }
  return distIndex
}
