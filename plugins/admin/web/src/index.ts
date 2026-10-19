/**
 * `@veren/admin-web` — the SPA carrier of the admin platform.
 *
 * Serves the same-origin SPA shell, its static assets, and the UI pack files
 * registered with `admin-ui-kernel`, and publishes the bootstrap and manifest
 * routes the SPA reads. It refuses to start when an essential capability is
 * missing, which is the boot gate the design requires.
 *
 * `@veren/admin-web` — 后台平台的 SPA 载体。提供同源 SPA 壳、静态资源，以及注册在
 * `admin-ui-kernel` 的 UI 包文件，并发布 SPA 读取的 bootstrap 与清单位。缺少必需能力时
 * 拒绝启动，这正是设计要求的启动门禁。
 *
 * @module @veren/admin-web
 */

import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only 导入：只为拉起 webServer 的 declaration merge，使 `ctx.webServer`
// 在本文件里可用，运行时并不加载它。
// Type-only import: pulls the webServer declaration merge so `ctx.webServer`
// is typed here; nothing is loaded at runtime.
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { sendEmpty } from '@veren/admin-api-kernel'
import type {} from '@veren/admin-kernel'
import { webRoutes } from './handlers.ts'
import { contentTypeFor, INDEX_SECURITY_HEADERS, resolveWithin, sendFile } from './static.ts'

/** Plugin display name. 插件显示名。 */
export const name = 'admin-web'

/**
 * Services this plugin needs before it may load: the kernel, the gateway, the
 * HTTP carrier, the UI registry and the navigation façade.
 *
 * `adminNavigation` is listed because the bootstrap handler reads
 * `ctx.adminNavigation.tree(principal)` at request time; Cordis rejects every
 * service access a plugin did not declare, with
 * `cannot get property "adminNavigation" without inject`.
 *
 * 本插件加载前需要的服务：内核、网关、HTTP 载体、UI 注册表与导航 façade。
 *
 * 必须声明 `adminNavigation`：bootstrap 处理器在请求时读取
 * `ctx.adminNavigation.tree(principal)`，而 Cordis 会拒绝任何未声明的服务访问，报
 * `cannot get property "adminNavigation" without inject`。
 */
export const inject = ['admin', 'adminApi', 'webServer', 'adminUi', 'adminNavigation'] as const

/** Web carrier configuration. Web 载体配置。 */
export interface Config {
  /** SPA mount path. SPA 挂载路径。 */
  mountPath?: string
}

export const Config: z<Config> = z.object({
  mountPath: z.string().default('/admin'),
})

/** Absolute directory holding the SPA files. 存放 SPA 文件的绝对目录。 */
const CLIENT_ROOT = fileURLToPath(new URL('../client/', import.meta.url))

/**
 * Split a request path into the pack id and the path inside the pack.
 *
 * @param pathname - request pathname 请求路径
 * @param prefix - mounted plugin prefix 挂载的插件前缀
 * @returns the pack id and relative path, or `undefined` 包 id 与相对路径，或 `undefined`
 */
function packTarget(pathname: string, prefix: string): { packId: string; relative: string } | undefined {
  const rest = pathname.slice(prefix.length).replace(/^\/+/, '')
  const separator = rest.indexOf('/')
  if (separator <= 0) return undefined
  return { packId: rest.slice(0, separator), relative: rest.slice(separator) }
}

/**
 * Plugin entry.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export function apply(ctx: Context, config: Config): void {
  // Boot gate: an admin profile without auth/access/nav/audit/data must not serve.
  // 启动门禁：缺少 auth/access/nav/audit/data 的后台 profile 不得对外服务。
  ctx.admin.ready()
  const mountPath = (config.mountPath ?? '/admin').replace(/\/+$/, '')

  for (const route of webRoutes(ctx)) {
    ctx.effect(() => ctx.adminApi.register(route), `admin-web-${route.method}-${route.path}`)
  }

  const serveIndex = async (res: ServerResponse): Promise<void> => {
    const index = resolveWithin(CLIENT_ROOT, '/index.html')
    if (index === undefined) {
      sendEmpty(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' })
      return
    }
    for (const [header, value] of Object.entries(INDEX_SECURITY_HEADERS)) res.setHeader(header, value)
    await sendFile(res, index, 'text/html; charset=utf-8')
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${mountPath}/ui-plugins`,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const target = packTarget(new URL(req.url ?? '/', 'http://admin.local').pathname, `${mountPath}/ui-plugins`)
      const asset = target === undefined ? undefined : ctx.adminUi.asset(target.packId, target.relative)
      if (asset === undefined) {
        sendEmpty(res, 404)
        return
      }
      await sendFile(res, asset.path, asset.contentType)
    },
  }), 'admin-web-ui-plugins')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${mountPath}/assets`,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://admin.local').pathname
      const relative = pathname.slice(`${mountPath}/assets`.length)
      const path = resolveWithin(CLIENT_ROOT, relative)
      const contentType = path === undefined ? undefined : contentTypeFor(path)
      if (path === undefined || contentType === undefined) {
        sendEmpty(res, 404)
        return
      }
      await sendFile(res, path, contentType)
    },
  }), 'admin-web-assets')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: mountPath,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://admin.local').pathname
      const isDocument = pathname === mountPath || pathname === `${mountPath}/` || pathname === `${mountPath}/index.html`
      if (!isDocument && pathname.slice(mountPath.length).includes('.')) {
        sendEmpty(res, 404)
        return
      }
      // History-API deep links all render the shell; the SPA routes client-side.
      // History API 深链一律返回壳；路由在客户端完成。
      await serveIndex(res)
    },
  }), 'admin-web-shell')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/',
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 302
      res.setHeader('Location', `${mountPath}/`)
      res.end()
    },
  }), 'admin-web-root-redirect')
}
