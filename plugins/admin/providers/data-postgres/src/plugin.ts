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
import z from '@deepseek-ai/schemastery'
import { Pool } from 'pg'
import type { AdminDatabase, ProviderManifest } from '@veren/admin-contract'
import type {} from '@veren/admin-kernel'
import { createPostgresDatabase } from './adapter.ts'
import { assertSchemaName, createSqlRecordStore, ensureSchema } from './store.ts'
import type { SqlConnection, SqlPool, SqlResult } from './store.ts'

/** Plugin name, doubling as the loader row name. 插件名，同时作为 loader 行名。 */
export const name = 'admin-data-postgres'

/** The provider needs only the capability registry; the database is its own. 该 provider 只需要能力注册表；数据库由它自己拥有。 */
export const inject = ['admin'] as const

/** Defaults of the connection fields; every one is overridable from profile config. 连接字段默认值，全部可被 profile 覆盖。 */
export const DEFAULT_POSTGRES_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  user: 'veren',
  password: '',
  database: 'veren_admin',
  schema: 'public',
  ssl: false,
  maxConnections: 10,
  connectTimeoutMs: 10_000,
  migrateOnBoot: true,
} as const

/** Plugin config as written in a profile row. profile 行中书写的插件配置。 */
export interface Config {
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  schema?: string
  ssl?: boolean
  maxConnections?: number
  connectTimeoutMs?: number
  migrateOnBoot?: boolean
}

/** Schemastery schema the loader validates before {@link resolveConfig}. 加载器在 {@link resolveConfig} 之前校验的 schemastery schema。 */
export const Config: z<Config> = z.object({
  host: z.string().default(DEFAULT_POSTGRES_CONFIG.host),
  port: z.natural().min(1).max(65535).default(DEFAULT_POSTGRES_CONFIG.port),
  user: z.string().default(DEFAULT_POSTGRES_CONFIG.user),
  password: z.string().role('secret').default(DEFAULT_POSTGRES_CONFIG.password),
  database: z.string().default(DEFAULT_POSTGRES_CONFIG.database),
  schema: z.string().default(DEFAULT_POSTGRES_CONFIG.schema),
  ssl: z.boolean().default(DEFAULT_POSTGRES_CONFIG.ssl),
  maxConnections: z.natural().min(1).max(100).default(DEFAULT_POSTGRES_CONFIG.maxConnections),
  connectTimeoutMs: z.natural().min(1_000).max(120_000).default(DEFAULT_POSTGRES_CONFIG.connectTimeoutMs),
  migrateOnBoot: z.boolean().default(DEFAULT_POSTGRES_CONFIG.migrateOnBoot),
})

/** Connection settings with every default applied. 已应用全部默认值的连接设置。 */
export interface ResolvedConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
  readonly schema: string
  readonly ssl: boolean
  readonly maxConnections: number
  readonly connectTimeoutMs: number
  readonly migrateOnBoot: boolean
}

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
 * Apply defaults and validate every bound that schemastery cannot express.
 *
 * @param config - validated plugin config 已校验插件配置
 * @returns the resolved settings 解析后的设置
 * @throws Error naming an empty or out-of-range field 命名空值或越界字段的错误
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    host: requireText('host', config.host ?? DEFAULT_POSTGRES_CONFIG.host),
    port: requirePort(config.port ?? DEFAULT_POSTGRES_CONFIG.port),
    user: requireText('user', config.user ?? DEFAULT_POSTGRES_CONFIG.user),
    password: config.password ?? DEFAULT_POSTGRES_CONFIG.password,
    database: requireText('database', config.database ?? DEFAULT_POSTGRES_CONFIG.database),
    schema: config.schema ?? DEFAULT_POSTGRES_CONFIG.schema,
    ssl: config.ssl ?? DEFAULT_POSTGRES_CONFIG.ssl,
    maxConnections: requireInteger('maxConnections', config.maxConnections ?? DEFAULT_POSTGRES_CONFIG.maxConnections, 1, 100),
    connectTimeoutMs: requireInteger(
      'connectTimeoutMs',
      config.connectTimeoutMs ?? DEFAULT_POSTGRES_CONFIG.connectTimeoutMs,
      1_000,
      120_000,
    ),
    migrateOnBoot: config.migrateOnBoot ?? DEFAULT_POSTGRES_CONFIG.migrateOnBoot,
  }
  assertSchemaName(resolved.schema)
  return resolved
}

/**
 * Open the `pg` pool behind the store's transport contract.
 * 打开 store 传输契约背后的 `pg` 连接池。
 * @param config - resolved connection settings 解析后的连接设置
 * @returns the pool 连接池
 */
export function openPostgres(config: ResolvedConfig): SqlPool {
  const pool = new Pool({
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
  })
  let closed = false
  return {
    query: (sql: string, params?: readonly unknown[]) => runQuery(
      (text, values) => (values === undefined ? pool.query(text) : pool.query(text, values)),
      sql,
      params,
    ),
    connect: async (): Promise<SqlConnection> => {
      const client = await pool.connect()
      return {
        query: (sql: string, params?: readonly unknown[]) => runQuery(
          (text, values) => (values === undefined ? client.query(text) : client.query(text, values)),
          sql,
          params,
        ),
        release: () => { client.release() },
      }
    },
    close: async (): Promise<void> => {
      if (closed) return
      closed = true
      await pool.end()
    },
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

/**
 * Require a non-empty text setting.
 *
 * @param field - config field name 配置字段名
 * @param value - candidate value 候选值
 * @returns the trimmed value 去空白后的值
 * @throws Error naming the empty field 命名空字段的错误
 */
function requireText(field: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`admin-data-postgres: config.${field} must not be empty`)
  return trimmed
}

/**
 * Require a usable TCP port. 要求可用的 TCP 端口。
 * @param value - candidate port 候选端口
 * @returns the port 端口
 * @throws Error when the port is not an integer in range 端口越界时抛出
 */
function requirePort(value: number): number {
  if (Number.isInteger(value) && value >= 1 && value <= 65535) return value
  throw new Error(`admin-data-postgres: config.port '${value}' must be an integer between 1 and 65535`)
}

/**
 * Require an integer inside an inclusive range. 要求整数落在闭区间内。
 * @param field - config field name 配置字段名
 * @param value - candidate value 候选值
 * @param min - inclusive lower bound 闭下界
 * @param max - inclusive upper bound 闭上界
 * @returns the value 值
 * @throws Error outside the range 越界时抛出
 */
function requireInteger(field: string, value: number, min: number, max: number): number {
  if (Number.isInteger(value) && value >= min && value <= max) return value
  throw new Error(`admin-data-postgres: config.${field} '${value}' must be an integer between ${min} and ${max}`)
}
