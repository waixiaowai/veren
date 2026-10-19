/**
 * The four documentation routes.
 *
 * Paths are registered relative to their audience prefix: `/capabilities`
 * becomes `/api/admin/v1/capabilities` and `/openapi.json` becomes
 * `/api/public/v1/openapi.json`. The design document names `/api/openapi.json`
 * for the schema; audience-prefixed routing cannot express that path, so the
 * public variant is published instead and the deviation is documented in the
 * README.
 *
 * 四条文档路由。路径相对其受众前缀注册：`/capabilities` 变成
 * `/api/admin/v1/capabilities`，`/openapi.json` 变成 `/api/public/v1/openapi.json`。
 * 设计文档把 schema 路径写作 `/api/openapi.json`；受众前缀路由无法表达该路径，因此改为发布
 * 公开变体，差异记录在 README 中。
 *
 * @module @veren/admin-docs-openapi/routes
 */

import { ADMIN_PERMISSIONS, type AdminRoute } from '@veren/admin-contract'
import type { OpenApiDocs } from './provider.ts'

/** Absolute path of the generated OpenAPI document. 生成的 OpenAPI 文档绝对路径。 */
export const OPENAPI_PATH = '/api/public/v1/openapi.json'

/** Absolute path of the full UI manifest, owned by the UI kernel. 完整 UI manifest 的绝对路径，由 UI 内核拥有。 */
export const UI_MANIFEST_PATH = '/api/admin/v1/ui-manifest'

/** The documentation index payload. 文档索引载荷。 */
export interface DocsIndex {
  /** Where the generated OpenAPI document is served. 生成的 OpenAPI 文档位置。 */
  readonly openapi: string
  /** Where the capability catalog is served. 能力目录位置。 */
  readonly capabilities: string
  /** Where the post-login UI manifest is served. 登录后 UI manifest 位置。 */
  readonly uiManifest: string
}

/** The index this provider serves; paths are absolute so a client can fetch them directly. 本 provider 提供的索引；路径为绝对路径，客户端可直接取用。 */
export const DOCS_INDEX: DocsIndex = {
  openapi: OPENAPI_PATH,
  capabilities: '/api/admin/v1/capabilities',
  uiManifest: UI_MANIFEST_PATH,
}

/**
 * Build every documentation route.
 *
 * Registration order matters only for the OpenAPI path map, which sorts paths
 * itself, so the order is chosen for reading.
 *
 * 构造全部文档路由。注册顺序只影响 OpenAPI 的路径映射，而后者自行排序，因此这里按可读性
 * 排列。
 *
 * @param docs - the docs capability the handlers delegate to handler 委托的文档能力
 * @returns the route contracts 路由契约
 */
export function createDocsRoutes(docs: OpenApiDocs): readonly AdminRoute[] {
  return [capabilitiesRoute(docs), backendsRoute(docs), openapiRoute(docs), indexRoute()]
}

/**
 * `GET /api/admin/v1/capabilities` — the live capability catalog.
 *
 * @param docs - docs capability 文档能力
 * @returns the route contract 路由契约
 */
function capabilitiesRoute(docs: OpenApiDocs): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/capabilities',
    permission: ADMIN_PERMISSIONS.capabilitiesRead,
    summary: 'Read the live capability catalog and health',
    tags: ['capabilities'],
    handler: async () => docs.catalog(),
  }
}

/**
 * `GET /api/admin/v1/health/backends` — backend component health.
 *
 * @param docs - docs capability 文档能力
 * @returns the route contract 路由契约
 */
function backendsRoute(docs: OpenApiDocs): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/health/backends',
    permission: ADMIN_PERMISSIONS.capabilitiesRead,
    summary: 'Probe backend component health',
    tags: ['health'],
    handler: async () => ({ backends: (await docs.refresh()).backends }),
  }
}

/**
 * `GET /api/public/v1/openapi.json` — the generated OpenAPI document.
 *
 * The route is public on purpose: schema generation happens before login and
 * the document contains no deployment secrets beyond the declared paths.
 *
 * 公开的 OpenAPI 文档路由。刻意公开：schema 生成发生在登录之前，且除声明路径外文档不含
 * 部署机密。
 *
 * @param docs - docs capability 文档能力
 * @returns the route contract 路由契约
 */
function openapiRoute(docs: OpenApiDocs): AdminRoute {
  return {
    audience: 'public',
    method: 'GET',
    path: '/openapi.json',
    summary: 'Read the generated OpenAPI 3.1 document',
    tags: ['docs'],
    handler: async () => docs.openapi(),
  }
}

/**
 * `GET /api/admin/v1/docs` — the documentation index.
 *
 * @returns the route contract 路由契约
 */
function indexRoute(): AdminRoute {
  return {
    audience: 'admin',
    method: 'GET',
    path: '/docs',
    permission: ADMIN_PERMISSIONS.capabilitiesRead,
    summary: 'Read the documentation index',
    tags: ['docs'],
    handler: () => DOCS_INDEX,
  }
}
