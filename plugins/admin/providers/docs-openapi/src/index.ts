/**
 * `@veren/admin-docs-openapi` — the default `docs` capability provider.
 *
 * Documentation is derived, never hand-written: the capability answers from the
 * kernel catalog and the gateway's live route table, and the four routes are
 * the only transport this provider adds. Both registrations live in
 * `ctx.effect`, so unloading removes the capability and every route together.
 *
 * `@veren/admin-docs-openapi` — 默认的 `docs` 能力 provider。文档是推导产物而非手写：
 * 能力以内核目录与网关实时路由表作答，四条路由是本 provider 唯一新增的传输面。两个注册都放在
 * `ctx.effect` 中，因此卸载会一并移除能力与全部路由。
 *
 * @module @veren/admin-docs-openapi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import type {} from '@veren/admin-api-kernel'
import { OpenApiDocs } from './provider.ts'
import { createDocsRoutes } from './routes.ts'

/** Plugin name used by the loader and diagnostics. 加载器与诊断使用的插件名。 */
export const name = 'admin-docs-openapi'

/** Services this plugin needs before it may load. 本插件加载前需要的服务。 */
export const inject = ['admin', 'adminApi'] as const

/**
 * Plugin configuration.
 *
 * The docs surface has no tunables: paths are part of the published contract,
 * so making them configurable would make generated clients depend on a profile
 * row. The empty shape keeps loader validation honest.
 *
 * 插件配置。文档面没有可调项：路径属于公开契约，可配置会让生成的客户端依赖 profile 行。
 * 空形状保持加载器校验的诚实。
 *
 * The type is stated explicitly instead of inferred: an inferred one would name
 * a schemastery module path that exists at only one install location, and an
 * index-signature `Record<string, never>` does not match an empty schema under
 * `exactOptionalPropertyTypes`.
 * 类型显式写出而非推断：推断出的类型会带上某个安装路径下的 schemastery 模块名；
 * 索引签名 `Record<string, never>` 在 exactOptionalPropertyTypes 下也匹配不上空
 * schema。
 */
/** Schemastery schema the loader validates before {@link apply}. 加载器在 {@link apply} 之前校验的 schemastery schema。 */
export const Config: z<Config> = z.object({})

/** The plugin config type: no fields, and the loader still validates the row.
 *  插件配置类型：无字段，加载器仍校验该行。
 */
export type Config = Record<never, never>

/** What this provider declares to the kernel. 本 provider 向内核声明的内容。 */
export const MANIFEST: ProviderManifest = {
  id: 'docs-openapi',
  capability: 'docs',
  contract: '^1.0',
  priority: 0,
  label: 'OpenAPI and capability docs',
}

/**
 * Plugin entry: register the docs capability and its routes.
 *
 * @param ctx - plugin context 插件上下文
 * @returns a disposer that removes both registrations 移除两个注册项的 disposer
 */
export function apply(ctx: Context): () => void {
  const docs = new OpenApiDocs(ctx)
  const disposeRegistration = ctx.effect(() => ctx.admin.register(MANIFEST, docs), 'admin-docs-registration')
  const disposeRoutes = ctx.effect(
    () => createDocsRoutes(docs).map((route) => ctx.adminApi.register(route)),
    'admin-docs-routes',
  )
  return () => {
    void disposeRoutes()
    void disposeRegistration()
  }
}

export { OpenApiDocs } from './provider.ts'
export { DOCS_INDEX, OPENAPI_PATH, UI_MANIFEST_PATH, createDocsRoutes, type DocsIndex } from './routes.ts'
