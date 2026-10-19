/**
 * OpenAPI 3.1 generation from the live route table.
 *
 * The document is derived, never hand-written: a route that is not registered
 * cannot appear in the API docs, and a route's permission and audience are
 * stated in the same place the gateway enforces them.
 *
 * 由实时路由表生成 OpenAPI 3.1。文档是推导产物而非手写：未注册的路由不会出现在
 * API 文档里，路由的权限与受众也只在网关执行它们的同一处声明。
 *
 * @module @veren/admin-api-kernel/openapi
 */

import { ADMIN_CONTRACT_VERSION, type AdminRoute } from '@veren/admin-contract'
import { routePath } from './router.ts'

/** One OpenAPI operation object. 单个 OpenAPI 操作对象。 */
interface Operation {
  readonly operationId: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly security: readonly Record<string, readonly string[]>[]
  readonly responses: Record<string, { readonly description: string }>
  readonly 'x-admin-permission'?: string
  readonly 'x-admin-audience': string
}

/**
 * Build one operation from a route.
 *
 * @param route - the registered route 已注册路由
 * @returns the operation object 操作对象
 */
function operationOf(route: AdminRoute): Operation {
  const operation: Operation = {
    operationId: `${route.audience}_${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    summary: route.summary,
    tags: route.tags ?? [route.audience],
    security: route.audience === 'public' ? [] : [{ [route.audience === 'terminal' ? 'bearer' : 'session']: [] }],
    responses: {
      '200': { description: 'Success' },
      '401': { description: 'AUTH_REQUIRED' },
      '403': { description: 'FORBIDDEN' },
      '422': { description: 'VALIDATION_FAILED' },
    },
    'x-admin-audience': route.audience,
    ...(route.permission === undefined ? {} : { 'x-admin-permission': route.permission }),
  }
  return operation
}

/**
 * Generate the OpenAPI document for a route table.
 *
 * @param routes - every registered route 全部已注册路由
 * @param publicUrl - advertised server URL, when known 已知的对外服务 URL
 * @returns an OpenAPI 3.1 document OpenAPI 3.1 文档
 */
export function buildOpenApi(routes: readonly AdminRoute[], publicUrl?: string): Record<string, unknown> {
  const paths: Record<string, Record<string, Operation>> = {}
  for (const route of routes) {
    const path = routePath(route.audience, route.path)
    const entry = paths[path] ?? {}
    entry[route.method.toLowerCase()] = operationOf(route)
    paths[path] = entry
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'DSH Admin Platform API',
      version: ADMIN_CONTRACT_VERSION,
      description: 'Generated from the live route table. 由实时路由表生成。',
    },
    servers: [{ url: publicUrl ?? '' }],
    paths,
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'admin_session' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
  }
}
