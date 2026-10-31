/**
 * `@veren/admin-data-postgres` — the recommended production `data` provider.
 *
 * The plugin owns the `pg` pool, bootstraps the schema idempotently, loads the
 * write-through mirror, registers the capability inside `ctx.effect`, and
 * closes the pool on dispose. Connection values are ordinary plugin config, so
 * a profile injects them per deployment; the module contains no credentials.
 *
 * `@veren/admin-data-postgres` —— 推荐的生产 `data` provider。插件拥有 `pg` 连接池、
 * 幂等引导 schema、装载写穿镜像、在 `ctx.effect` 内注册能力，并在卸载时关闭连接池。
 * 连接值是普通插件配置，由 profile 按部署注入；模块内不含任何凭据。
 *
 * @module @veren/admin-data-postgres/plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import type { AdminDatabase, ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import { createPostgresDatabase } from './adapter.ts'
// 配置面单独成文（默认值/schema/解析器）；这里原样再导出，保持包的导出面不变。
// The config face lives in its own file (defaults/schema/resolver); re-exported
// verbatim here so the package's export face stays unchanged.
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig } from './config.ts'
import { createSqlRecordStore, ensureSchema } from './store.ts'
import type { SqlConnection, SqlPool, SqlResult } from './store.ts'

export { Config, DEFAULT_POSTGRES_CONFIG, resolveConfig } from './config.ts'
export type { ResolvedConfig } from './config.ts'

/** Plugin name, doubling as the loader row name. 插件名，同时作为 loader 行名。 */
export const name = 'admin-data-postgres'

/** The provider needs only the capability registry; the database is its own. 该 provider 只需要能力注册表；数据库由它自己拥有。 */
export const inject = ['admin'] as const

/**
 * What this package declares to the kernel. Priority 10 makes PostgreSQL the
 * default when the embedded KV row is present too.
 * 向内核声明的内容。优先级 10 使 PostgreSQL 在嵌入 KV 行同时存在时成为默认。
 */
export const MANIFEST: ProviderManifest = {
  id: 'postgres',
  capability: 'data',
  contract: '^1.0',
  priority: 10,
  dataDomain: 'veren_admin',
  label: 'PostgreSQL',
}

/**
 * Open the `pg` pool behind the store's transport contract.
 * 打开 store 传输契约背后的 `pg` 连接池。
 * @param config - resolved connection settings 解析后的连接设置
 * @returns the pool 连接池
 */
export function openPostgres(config: ResolvedConfig): SqlPool {
  const pool = new Pool(postgresPoolOptions(config))
  let closed = false
  return {
    query: (sql: string, params?: readonly unknown[]) => runQuery(
      (text, values) => (values === undefined ? pool.query(text) : pool.query(text, values)),
      sql,
      params,
    ),
    connect: () => connectClient(pool),
    close: async (): Promise<void> => {
      if (closed) return
      closed = true
      await pool.end()
    },
  }
}

/** pg 连接池构造参数：连接值 + 固定 search_path。The pg Pool construction options: connection values plus a pinned search_path. */
function postgresPoolOptions(config: ResolvedConfig): PoolConfig {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: config.maxConnections,
    application_name: 'veren-admin',
    connectionTimeoutMillis: config.connectTimeoutMs,
    ...(config.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
    // Pin the search path instead of inheriting the server default: the server
    // default starts with `"$user"`, so a schema named after the login role
    // would silently receive the `veren_` tables instead of the configured one.
    // 固定 search_path 而不继承服务器默认值：默认值以 `"$user"` 开头，因此与登录角色同名
    // 的 schema 会静默接收 `veren_` 表，而不是配置指定的那个。
    options: `-c search_path=${config.schema}`,
  }
}

/** 从池里取一个客户端并包成 store 的 SqlConnection 传输面。Check a client out of the pool and wrap it into the store's SqlConnection transport face. */
async function connectClient(pool: Pool): Promise<SqlConnection> {
  const client = await pool.connect()
  return {
    query: (sql: string, params?: readonly unknown[]) => runQuery(
      (text, values) => (values === undefined ? client.query(text) : client.query(text, values)),
      sql,
      params,
    ),
    release: () => { client.release() },
  }
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
  ctx.effect(() => dispose, 'admin-data-postgres: register data provider')
  return dispose
}

/**
 * Plugin entry: open the pool, bootstrap the schema, serve `data`.
 *
 * A bootstrap or load failure closes the pool and rethrows, so a misconfigured
 * deployment fails the load loudly instead of serving an empty mirror.
 *
 * 插件入口：打开连接池、引导 schema、提供 `data`。引导或装载失败会关闭连接池并重新抛出，
 * 因此配置错误的部署会在加载时显式失败，而不是提供空镜像。
 *
 * @param ctx - plugin context 插件上下文
 * @param config - validated config 已校验配置
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const settings = resolveConfig(config)
  const pool = openPostgres(settings)
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await pool.close()
  }
  ctx.effect(() => close, 'admin-data-postgres: close pool')
  try {
    await serveData(ctx, pool, settings)
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * Bootstrap an already-open pool and register the capability on `ctx.admin`.
 *
 * Kept separate from {@link apply} so lifecycle tests can drive the same
 * registration path with a recording pool instead of a live server.
 *
 * 引导已打开的连接池并在 `ctx.admin` 上注册能力。与 {@link apply} 分开，是为了让生命周期
 * 测试用记录型连接池驱动同一条注册路径，而不是依赖真实服务器。
 *
 * @param ctx - plugin context 插件上下文
 * @param pool - the connected pool 已连接的连接池
 * @param settings - schema and bootstrap choice schema 与引导选择
 */
export async function serveData(
  ctx: Context,
  pool: SqlPool,
  settings: Pick<ResolvedConfig, 'schema' | 'migrateOnBoot'>,
): Promise<void> {
  if (settings.migrateOnBoot) await ensureSchema(pool, settings.schema)
  const store = createSqlRecordStore(pool)
  registerDataProvider(ctx, await createPostgresDatabase({ store }))
}

/**
 * Run one query through a bound `pg` call, normalizing the result.
 *
 * @param query - the bound `pg` query function 已绑定的 `pg` 查询函数
 * @param sql - statement text 语句文本
 * @param params - positional parameters 位置参数
 * @returns the normalized result 归一化结果
 */
async function runQuery(
  query: (sql: string, params?: unknown[]) => Promise<{ readonly rows: readonly unknown[], readonly rowCount: number | null }>,
  sql: string,
  params?: readonly unknown[],
): Promise<SqlResult> {
  const result = params === undefined ? await query(sql) : await query(sql, [...params])
  return { rows: result.rows as readonly Record<string, unknown>[], rowCount: result.rowCount }
}
