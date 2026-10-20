/**
 * Startup ordering: the SPA carrier loads before the provider rows and still
 * activates only after every essential capability is registered.
 *
 * This is the regression the profile-level sequencing shim used to work around:
 * the kernel publishes its façades immediately, while the loader mounts rows
 * concurrently, so injection could not order the web row after the providers.
 *
 * 启动排序：SPA 载体先于 provider 行加载，但只在全部必需能力注册后才激活。这正是过去
 * 需要 profile 级排序垫片规避的回归：内核构造时立刻发布 façade，而 loader 并发挂载各
 * 行，因此注入无法把 Web 行排到 provider 之后。
 */

import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import type { ProviderManifest } from '@veren/admin-contract'
import { AdminApi } from '@veren/admin-api-kernel'
import { AdminKernel } from '@veren/admin-kernel'
import { apply as applyAccess } from '@veren/admin-access-rbac'
import { apply as applyAuth } from '@veren/admin-auth-local'
import { apply as applyAudit } from '@veren/admin-audit-default'
import { apply as applyDocs } from '@veren/admin-docs-openapi'
import { apply as applyNav } from '@veren/admin-navigation-default'
import * as adminWeb from '@veren/admin-web'
import { dataManifest, memoryDatabase } from './memory-data.ts'

/** The entry-level shape the loader would hand to `ctx.plugin`. 加载器交给 `ctx.plugin` 的行级形状。 */
const webRow = {
  name: adminWeb.name,
  inject: [...adminWeb.inject],
  Config: adminWeb.Config,
  apply: adminWeb.apply,
}

/** A fake HTTP carrier that records the routes the web row registers. 记录 Web 行注册路由的伪 HTTP 载体。 */
function recordingWebServer(): { routes: WebRoute[]; service: { register(route: WebRoute): () => void } } {
  const routes: WebRoute[] = []
  return {
    routes,
    service: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
  }
}

/** Register one provider through the kernel without starting a plugin fiber. 不经插件 fiber，直接向内核注册一个 provider。 */
function register(kernel: AdminKernel, capability: ProviderManifest['capability']): void {
  kernel.register({ id: `test-${capability}`, capability, contract: '^1.0', priority: 0, label: capability }, {})
}

describe('admin startup ordering', () => {
  it('keeps the web row pending until the essential providers have registered', async () => {
    const ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    const api = new AdminApi(ctx, { rateLimit: { window: 60, max: 10_000 } })
    const webServer = recordingWebServer()
    ctx.provide('webServer' as string, webServer.service)
    ctx.provide('adminUi' as string, {
      manifest: () => ({ uiContract: '1.0.0', packs: [] }),
      asset: () => undefined,
    })

    // Deliberately mount the web row first: readiness must serialize it.
    // 故意先挂载 Web 行：就绪服务必须完成串行化。
    const web = ctx.plugin(webRow, { mountPath: '/admin' })
    await web
    expect(webServer.routes).toHaveLength(0)

    kernel.register(dataManifest(), memoryDatabase())
    applyAccess(ctx, {})
    await web
    expect(webServer.routes).toHaveLength(0)

    applyAuth(ctx, { passwordMinLength: 8, sessionDays: 7 })
    applyNav(ctx)
    await web
    expect(webServer.routes).toHaveLength(0)

    // `audit` completes the essential set, so the kernel publishes readiness
    // and the pending web row activates.
    // `audit` 补全必需集合，内核因此发布就绪服务，等待中的 Web 行随之激活。
    applyAudit(ctx, { maxEntries: 1000, retentionDays: 30 })
    applyDocs(ctx)
    await web
    expect(webServer.routes.length).toBeGreaterThan(0)
    expect(() => kernel.ready()).not.toThrow()
    expect(ctx.adminReadiness.essentials).toEqual(['data', 'auth', 'access', 'navigation', 'audit'])

    const routePaths = api.routes().map((route) => route.path)
    expect(routePaths).toContain('/bootstrap')
    expect(webServer.routes.map((route) => `${route.kind}:${route.path}`)).toEqual(expect.arrayContaining([
      'prefix:/admin',
      'prefix:/admin/assets',
      'prefix:/admin/ui-plugins',
      'exact:/',
    ]))

    await web.dispose()
  })

  it('keeps the web row pending when an essential provider is missing', async () => {
    const ctx = new Context()
    const kernel = new AdminKernel(ctx, { essential: [] })
    const webServer = recordingWebServer()
    ctx.provide('webServer' as string, webServer.service)
    ctx.provide('adminUi' as string, { manifest: () => ({ uiContract: '1.0.0', packs: [] }), asset: () => undefined })
    const web = ctx.plugin(webRow, {})

    // Four of five essentials: the web row never applies, so no route appears.
    // 五个必需能力中只注册四个：Web 行永不执行，因此没有路由出现。
    for (const capability of ['data', 'auth', 'access', 'navigation'] as const) register(kernel, capability)
    await web
    expect(ctx.get('adminReadiness')).toBeUndefined()
    expect(webServer.routes).toHaveLength(0)

    await web.dispose()
  })
})
