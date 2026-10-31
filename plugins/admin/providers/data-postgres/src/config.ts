/**
 * Config face of `@veren/admin-data-postgres`: profile defaults, the
 * schemastery schema and the resolver that applies defaults and validates the
 * bounds schemastery cannot express.
 *
 * `@veren/admin-data-postgres` 的配置面：profile 默认值、schemastery schema，以及
 * 应用默认值并校验 schemastery 无法表达的边界的解析器。
 *
 * @module @veren/admin-data-postgres/config
 */

import z from '@deepseek-ai/schemastery'
import { assertSchemaName } from './store.ts'

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
