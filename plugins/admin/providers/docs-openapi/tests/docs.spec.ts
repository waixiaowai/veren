/**
 * Docs provider behavior: registration and disposal, route metadata, and the
 * payloads of the catalog, backend-health, OpenAPI and index endpoints.
 *
 * 文档 provider 行为：注册与释放、路由元数据，以及目录、后端健康、OpenAPI 与索引端点的载荷。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AdminApi } from '@veren/admin-api-kernel'
import { AdminKernel, type AdminHealthSnapshot } from '@veren/admin-kernel'
import {
  ADMIN_PERMISSIONS,
  AdminError,
  type AdminDatabase,
  type AdminEntity,
  type AdminRoute,
  type AdminRouteContext,
  type AdminTable,
  type CapabilityCatalog,
} from '@veren/admin-contract'
import { apply, DOCS_INDEX, OPENAPI_PATH } from '../src/index.ts'

/** An empty collection; the docs provider only asks the data façade for health. 空集合；文档 provider 只通过 data façade 询问健康。 */
function emptyTable<T extends AdminEntity>(): AdminTable<T> {
  return {
    find: () => undefined,
    list: () => [],
    save: async () => {},
    remove: async () => false,
    size: 0,
  }
}

/**
 * Register an in-memory `data` provider so backend health has one component.
 * 注册内存 `data` provider，使后端健康有一个组件。
 */
function installData(ctx: Context): void {
  const table = <T extends AdminEntity>(_name: string): AdminTable<T> => emptyTable<T>()
  const database: AdminDatabase = {
    features: { transactions: false, secondaryIndexes: false, fullText: false },
    table,
    transaction: async (work) => work({ table }),
    health: async () => ({ status: 'ok' }),
  }
  ctx.admin.register(
    { id: 'memory-data', capability: 'data', contract: '^1.0', priority: 0, label: 'In-memory data' },
    database,
  )
}

/** One wired test deployment. 一套已接线的测试部署。 */
interface Harness {
  /** Kernel context carrying every service. 携带全部服务的内核上下文。 */
  readonly ctx: Context
  /** Disposer returned by the plugin entry. 插件入口返回的 disposer。 */
  readonly dispose: () => void
}

/** Build a kernel, gateway, data provider and the docs plugin. 构造内核、网关、data provider 与文档插件。 */
function setup(): Harness {
  const ctx = new Context()
  new AdminKernel(ctx, { essential: [] })
  new AdminApi(ctx, {})
  installData(ctx)
  const dispose = apply(ctx)
  return { ctx, dispose }
}

/** Find one registered route by its audience-relative path. 按受众相对路径查找已注册路由。 */
function routeOf(ctx: Context, path: string): AdminRoute {
  const route = ctx.adminApi.routes().find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} is not registered`)
  return route
}

/** A minimal route context; the docs handlers only read the request for symmetry. 最小路由上下文；文档 handler 读取请求只为保持对称。 */
function routeContext(audience: AdminRoute['audience'] = 'admin'): AdminRouteContext {
  return {
    request: {
      requestId: 'req-1',
      method: 'GET',
      path: '/',
      params: {},
      query: new URLSearchParams(),
      headers: {},
      body: undefined,
      principal: undefined,
      audience,
      ip: '127.0.0.1',
      cookie: () => undefined,
      header: () => undefined,
    },
    response: { setCookie: () => {}, clearCookie: () => {}, setHeader: () => {} },
  }
}

describe('docs registration', () => {
  it('registers the capability and four routes, then removes them on dispose', () => {
    const { ctx, dispose } = setup()

    expect(ctx.admin.has('docs')).toBe(true)
    expect(ctx.adminApi.routes().map((route) => `${route.audience} ${route.path}`)).toEqual([
      'admin /capabilities',
      'admin /health/backends',
      'public /openapi.json',
      'admin /docs',
    ])

    dispose()

    expect(ctx.admin.has('docs')).toBe(false)
    expect(ctx.adminApi.routes()).toHaveLength(0)
    expect(() => ctx.adminDocs.catalog()).toThrow(AdminError)
  })

  it('declares permissions, audiences and tags on every route', () => {
    const { ctx } = setup()

    expect(routeOf(ctx, '/capabilities')).toMatchObject({
      audience: 'admin',
      method: 'GET',
      permission: ADMIN_PERMISSIONS.capabilitiesRead,
      tags: ['capabilities'],
    })
    expect(routeOf(ctx, '/health/backends')).toMatchObject({
      permission: ADMIN_PERMISSIONS.capabilitiesRead,
      tags: ['health'],
    })
    expect(routeOf(ctx, '/openapi.json')).toMatchObject({ audience: 'public', tags: ['docs'] })
    expect(routeOf(ctx, '/openapi.json').permission).toBeUndefined()
    expect(routeOf(ctx, '/docs')).toMatchObject({
      permission: ADMIN_PERMISSIONS.capabilitiesRead,
      tags: ['docs'],
    })
  })
})

describe('docs payloads', () => {
  it('serves a refreshed capability catalog', async () => {
    const { ctx } = setup()
    const catalog = (await routeOf(ctx, '/capabilities').handler(routeContext())) as CapabilityCatalog
    const docs = catalog.capabilities.find((entry) => entry.capability === 'docs')

    expect(catalog.contractVersion).toBe('1.0.0')
    expect(catalog.capabilities.map((entry) => entry.capability)).toEqual([
      'data',
      'auth',
      'access',
      'navigation',
      'audit',
      'settings',
      'docs',
    ])
    expect(docs?.active?.id).toBe('docs-openapi')
    expect(docs?.health.status).toBe('ok')
    expect(catalog.features.docs).toBe(true)
    expect(catalog.features.auth).toBe(false)
  })

  it('serves backend health as a backends envelope', async () => {
    const { ctx } = setup()
    const payload = (await routeOf(ctx, '/health/backends').handler(routeContext())) as Pick<
      AdminHealthSnapshot,
      'backends'
    >

    expect(payload.backends).toEqual([{ name: 'data', health: { status: 'ok' } }])
  })

  it('serves the OpenAPI document generated from the live route table', async () => {
    const { ctx } = setup()
    const document = (await routeOf(ctx, '/openapi.json').handler(routeContext('public'))) as Record<string, unknown>
    const paths = Object.keys(document.paths as Record<string, unknown>)

    expect(document.openapi).toBe('3.1.0')
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/admin/v1/capabilities',
        '/api/admin/v1/health/backends',
        '/api/admin/v1/docs',
        OPENAPI_PATH,
      ]),
    )

    ctx.adminApi.register({ audience: 'admin', method: 'GET', path: '/extra', summary: 'Extra', handler: () => ({}) })
    const refreshed = (await ctx.adminDocs.openapi()) as Record<string, unknown>
    expect(Object.keys(refreshed.paths as Record<string, unknown>)).toContain('/api/admin/v1/extra')
  })

  it('serves the documentation index with absolute paths', async () => {
    const { ctx } = setup()
    const payload = await routeOf(ctx, '/docs').handler(routeContext())

    expect(payload).toEqual({
      openapi: '/api/public/v1/openapi.json',
      capabilities: '/api/admin/v1/capabilities',
      uiManifest: '/api/admin/v1/ui-manifest',
    })
    expect(payload).toEqual(DOCS_INDEX)
  })
})
