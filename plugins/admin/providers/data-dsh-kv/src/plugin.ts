/**
 * `@veren/admin-data-dsh-kv` — the `data` capability provider of the DSH admin
 * platform, backed by one self-declared storage domain.
 *
 * The plugin validates that every storage backend named in its config is
 * registered, opens the `admin_data` domain, registers the capability inside
 * `ctx.effect`, and closes the domain on dispose. The medium stays the storage
 * group's decision; a typo in `storage.backend` or `storage.routes` fails the
 * load loudly instead of silently writing to another backend.
 *
 * `@veren/admin-data-dsh-kv` —— DSH 后台平台的 `data` 能力 provider，由单个自声明
 * 存储域支撑。插件先校验配置中出现的每个存储后端都已注册，然后打开 `admin_data`
 * domain，在 `ctx.effect` 内注册能力，并在卸载时关闭 domain。介质仍由 storage group
 * 决定；`storage.backend` 或 `storage.routes` 的拼写错误会让加载显式失败，而不是
 * 静默写入另一个后端。
 *
 * @module @veren/admin-data-dsh-kv/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import type { AdminDatabase, ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import { createKvDatabase } from './adapter.ts'
import { ADMIN_DATA_DOMAIN_NAME, adminDataDomain } from './domain.ts'
import type { AdminDataDomain } from './domain.ts'

/** Plugin name, doubling as the loader row name. 插件名，同时作为 loader 行名。 */
export const name = 'admin-data-dsh-kv'

/** Services the provider needs: the registry, the backend table and the domain facility. 该 provider 需要的服务：注册表、后端表与 domain 设施。 */
export const inject = ['admin', 'storage', 'storageDomain'] as const

/** Storage routing intent for the `admin_data` domain. `admin_data` domain 的存储路由意向。 */
export interface StorageIntent {
  /** Backend name serving the domain by default. 默认服务该 domain 的后端名。 */
  readonly backend: string
  /** Per-domain overrides: domain name → backend name. 逐 domain 覆盖：domain 名 → 后端名。 */
  readonly routes?: Record<string, string>
}

/** Plugin config. 插件配置。 */
export interface Config {
  /**
   * Storage routing intent in the storage group's `backend`/`routes` shape. The
   * routes themselves stay owned by the `storage-domain` row; this plugin only
   * asserts that every name here is a registered backend.
   *
   * 遵循 storage group `backend`/`routes` 形态的存储路由意向。路由本身仍由
   * `storage-domain` 行拥有；本插件只断言这里的每个名字都是已注册后端。
   */
  storage?: StorageIntent
}

/**
 * Schemastery schema of {@link Config}: an absent section defaults to the
 * `json` backend with no routes, so a bare profile row is a working row.
 *
 * {@link Config} 的 schemastery schema：缺省段落默认使用 `json` 后端且无路由，
 * 因此一行最小配置即可工作。
 */
export const Config: z<Config> = z.object({
  storage: z.object({
    backend: z.string().required(),
    routes: z.dict(z.string()).default({}),
  }).default({ backend: 'json', routes: {} }),
})

/**
 * What this package declares to the kernel: the `data` capability behind the
 * `admin_data` domain. Priority 0 keeps room for a higher-priority provider
 * (for example a SQL engine) to take over without touching this package.
 *
 * 本包向内核声明的内容：`admin_data` domain 背后的 `data` 能力。优先级 0 为更高
 * 优先级的 provider（例如 SQL 引擎）留出接管空间，无需改动本包。
 */
export const MANIFEST: ProviderManifest = {
  id: 'dsh-kv',
  capability: 'data',
  contract: '^1.0',
  priority: 0,
  dataDomain: ADMIN_DATA_DOMAIN_NAME,
  label: 'DSH storage KV',
}

/**
 * Register the `data` capability for the lifetime of the calling fiber.
 *
 * @param ctx - plugin context owning the registration 拥有该注册项的插件上下文
 * @param database - the database façade to serve 要提供服务的数据库 façade
 * @returns the disposer that removes the registration 移除该注册项的 disposer
 */
export function registerDataProvider(ctx: Context, database: AdminDatabase): () => void {
  const dispose = ctx.admin.register(MANIFEST, database)
  ctx.effect(() => dispose, 'admin-data-dsh-kv: register data provider')
  return dispose
}

/**
 * Plugin entry: validate the storage intent, open the domain, serve `data`.
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 * @throws Error naming the unregistered backend, or the failed domain open 命名未注册后端或 domain 打开失败的错误
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const intent = resolveStorageIntent(config)
  assertBackendsRegistered(ctx, intent)
  const domain = await openDomain(ctx)
  registerDataProvider(ctx, createKvDatabase({ domain }))
}

/**
 * Read the effective storage intent; the schema default answers for an absent
 * section so a hand-built config object behaves like a loader-validated one.
 *
 * @param config - plugin config 插件配置
 * @returns the normalized intent 归一化意向
 */
function resolveStorageIntent(config: Config): StorageIntent {
  return config.storage ?? { backend: 'json', routes: {} }
}

/**
 * Verify that every backend name in the intent is a registered backend; the
 * route decision itself stays with the `storage-domain` row.
 *
 * @param ctx - plugin context carrying the storage hub 携带存储枢纽的插件上下文
 * @param intent - the normalized storage intent 归一化的存储意向
 * @throws Error naming the unregistered backend and the registered names 命名未注册后端与已注册名单的错误
 */
function assertBackendsRegistered(ctx: Context, intent: StorageIntent): void {
  const names = new Set([intent.backend, ...Object.values(intent.routes ?? {})])
  for (const backend of names) {
    try {
      ctx.storage.backend.get(backend)
    } catch {
      throw new Error(
        `admin-data-dsh-kv: storage backend '${backend}' routed for domain '${ADMIN_DATA_DOMAIN_NAME}' is not registered`
        + ` (registered: ${ctx.storage.backend.names().join(', ') || 'none'})`
        + " — align plugin config storage.backend/storage.routes with the storage group's backend/routes",
      )
    }
  }
}

/**
 * Open the `admin_data` domain and register its `close()` disposal on the
 * calling fiber, so an unloaded plugin releases the medium.
 *
 * @param ctx - plugin context carrying the domain facility 携带 domain 设施的插件上下文
 * @returns the opened domain handle 已打开的 domain 句柄
 * @throws Error carrying the domain name and the `DomainError` code 携带 domain 名与 `DomainError` 错误码的错误
 */
async function openDomain(ctx: Context): Promise<AdminDataDomain> {
  const domain = await openDeclaredDomain(ctx)
  ctx.effect(() => async () => { await domain.close() }, 'admin-data-dsh-kv: domain close')
  return domain
}

/**
 * Open the declared domain, translating a structured failure into one message
 * that names the domain and its cause.
 *
 * @param ctx - plugin context carrying the domain facility 携带 domain 设施的插件上下文
 * @returns the opened domain handle 已打开的 domain 句柄
 * @throws Error naming the domain and the cause 命名 domain 与原因的错误
 */
async function openDeclaredDomain(ctx: Context): Promise<AdminDataDomain> {
  try {
    return await ctx.storageDomain.open(adminDataDomain)
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'unknown'
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`admin-data-dsh-kv: opening domain '${ADMIN_DATA_DOMAIN_NAME}' failed (${code}): ${detail}`)
  }
}
