/**
 * Physical PostgreSQL schema of the admin platform's `data` capability.
 *
 * Logical collections map to `veren_`-prefixed tables: id primary key, a JSONB
 * `data` column round-tripping the record unchanged, and nullable projected
 * columns for indexable fields. Unknown collections share `veren_records`.
 *
 * 后台平台 `data` 能力的 PostgreSQL 物理 schema。逻辑集合映射为 `veren_` 前缀表：id 主键、
 * 原样往返记录的 JSONB `data` 列，以及承载可索引字段的可空投影列。未知集合共享
 * `veren_records`。
 *
 * @module @veren/admin-data-postgres/schema
 */

import type { AdminEntity } from '@veren/admin-contract'

/** Column types the projection knows how to bind. 投影能够绑定取值的列类型。 */
export type ColumnType = 'text' | 'boolean' | 'timestamptz' | 'text[]' | 'jsonb'

/** One record field projected into an indexable column. 投影为可索引列的记录字段。 */
export interface ProjectedColumn {
  readonly column: string
  readonly field: string
  readonly type: ColumnType
}

/** One index over a platform table. 平台表上的一个索引。 */
export interface TableIndex {
  /** Physical index name. 物理索引名。 */
  readonly name: string
  /** Indexed expression with parentheses, such as `(lower(email))`. 含括号的索引表达式。 */
  readonly expression: string
  /** Whether the index is unique. 是否为唯一索引。 */
  readonly unique?: boolean
}

/** One logical collection and its physical table. 一个逻辑集合及其物理表。 */
export interface CollectionTable {
  readonly collection: string
  readonly table: string
  readonly columns: readonly ProjectedColumn[]
  readonly indexes: readonly TableIndex[]
}

/** Table shared by every collection without a dedicated table. 无专用表的集合共享的表。 */
export const FALLBACK_TABLE = 'veren_records'

function col(column: string, field: string, type: ColumnType): ProjectedColumn {
  return { column, field, type }
}

function index(name: string, expression: string): TableIndex {
  return { name, expression }
}

/** Platform-owned collections and their tables. 平台拥有的集合及表。 */
export const PLATFORM_TABLES: readonly CollectionTable[] = [
  {
    collection: 'admin_users',
    table: 'veren_users',
    columns: [
      col('email', 'email', 'text'),
      col('name', 'name', 'text'),
      col('active', 'active', 'boolean'),
      col('password_hash', 'passwordHash', 'text'),
      col('created_at', 'createdAt', 'timestamptz'),
      col('last_login_at', 'lastLoginAt', 'timestamptz'),
    ],
    indexes: [
      { name: 'veren_users_email_key', expression: '(lower(email))', unique: true },
      index('veren_users_active_idx', '(active)'), index('veren_users_created_at_idx', '(created_at DESC)'),
    ],
  },
  {
    collection: 'admin_sessions',
    table: 'veren_sessions',
    columns: [
      col('user_id', 'userId', 'text'),
      col('token_hash', 'tokenHash', 'text'),
      col('created_at', 'createdAt', 'timestamptz'),
      col('expires_at', 'expiresAt', 'timestamptz'),
      col('last_seen_at', 'lastSeenAt', 'timestamptz'),
    ],
    indexes: [
      { name: 'veren_sessions_token_hash_key', expression: '(token_hash)', unique: true },
      index('veren_sessions_user_id_idx', '(user_id)'), index('veren_sessions_expires_at_idx', '(expires_at)'),
    ],
  },
  {
    collection: 'admin_tokens',
    table: 'veren_tokens',
    columns: [
      col('user_id', 'userId', 'text'),
      col('name', 'name', 'text'),
      col('prefix', 'prefix', 'text'),
      col('secret_hash', 'secretHash', 'text'),
      col('scopes', 'scopes', 'text[]'),
      col('created_at', 'createdAt', 'timestamptz'),
      col('last_used_at', 'lastUsedAt', 'timestamptz'),
      col('revoked_at', 'revokedAt', 'timestamptz'),
    ],
    indexes: [
      { name: 'veren_tokens_secret_hash_key', expression: '(secret_hash)', unique: true },
      index('veren_tokens_user_id_idx', '(user_id)'), index('veren_tokens_prefix_idx', '(prefix)'),
    ],
  },
  {
    collection: 'admin_roles',
    table: 'veren_roles',
    columns: [
      col('label', 'label', 'text'),
      col('permissions', 'permissions', 'text[]'),
      col('created_at', 'createdAt', 'timestamptz'),
    ],
    indexes: [index('veren_roles_created_at_idx', '(created_at DESC)')],
  },
  {
    collection: 'admin_bindings',
    table: 'veren_bindings',
    columns: [
      col('user_id', 'userId', 'text'),
      col('role_id', 'roleId', 'text'),
      col('created_at', 'createdAt', 'timestamptz'),
    ],
    indexes: [{ name: 'veren_bindings_user_role_key', expression: '(user_id, role_id)', unique: true }, index('veren_bindings_role_id_idx', '(role_id)')],
  },
  {
    collection: 'admin_audit',
    table: 'veren_audit',
    columns: [
      col('at', 'at', 'timestamptz'),
      col('actor_id', 'actorId', 'text'),
      col('actor_label', 'actorLabel', 'text'),
      col('action', 'action', 'text'),
      col('result', 'result', 'text'),
      col('target', 'target', 'text'),
      col('request_id', 'requestId', 'text'),
      col('ip', 'ip', 'text'),
      col('detail', 'detail', 'jsonb'),
    ],
    indexes: [
      index('veren_audit_at_idx', '(at DESC)'), index('veren_audit_actor_idx', '(actor_id, at DESC)'),
      index('veren_audit_action_idx', '(action)'), index('veren_audit_result_idx', '(result)'),
    ],
  },
]

/**
 * Resolve the physical table of one collection; `undefined` means fallback.
 * 解析集合的物理表；`undefined` 表示回退表。
 * @param collection - logical collection name 逻辑集合名
 * @returns the table mapping, or `undefined` 表映射或 `undefined`
 */
export function tableFor(collection: string): CollectionTable | undefined {
  return PLATFORM_TABLES.find((table) => table.collection === collection)
}

function sqlType(type: ColumnType): string {
  switch (type) {
    case 'text': return 'text'
    case 'boolean': return 'boolean'
    case 'timestamptz': return 'timestamptz'
    case 'text[]': return 'text[]'
    case 'jsonb': return 'jsonb'
    default: return assertNever(type)
  }
}

/**
 * Build every idempotent DDL statement, in dependency order. Bootstrap is
 * additive only; renames and destructive changes stay operator tasks.
 * 按依赖顺序生成全部幂等 DDL。引导只做增量；改名与破坏性变更由运维处理。
 *
 * @returns the statements to run inside one transaction 单事务内执行的语句
 */
export function schemaStatements(): readonly string[] {
  const statements: string[] = []
  for (const table of PLATFORM_TABLES) {
    const definitions = [
      '"id" text PRIMARY KEY',
      '"data" jsonb NOT NULL CHECK (jsonb_typeof("data") = \'object\')',
      ...table.columns.map((column) => `"${column.column}" ${sqlType(column.type)}`),
    ]
    statements.push(`CREATE TABLE IF NOT EXISTS "${table.table}" (${definitions.join(', ')})`)
    for (const column of table.columns) {
      statements.push(
        `ALTER TABLE "${table.table}" ADD COLUMN IF NOT EXISTS "${column.column}" ${sqlType(column.type)}`,
      )
    }
    for (const entry of table.indexes) {
      const unique = entry.unique === true ? 'UNIQUE ' : ''
      statements.push(`CREATE ${unique}INDEX IF NOT EXISTS "${entry.name}" ON "${table.table}" ${entry.expression}`)
    }
  }
  statements.push(
    `CREATE TABLE IF NOT EXISTS "${FALLBACK_TABLE}" (`
    + '"collection" text NOT NULL, "id" text NOT NULL, '
    + '"data" jsonb NOT NULL CHECK (jsonb_typeof("data") = \'object\'), '
    + 'PRIMARY KEY ("collection", "id"))',
    `CREATE INDEX IF NOT EXISTS "veren_records_collection_idx" ON "${FALLBACK_TABLE}" ("collection")`,
  )
  return statements
}

/** One fully bound write, ready for `SqlSession.query`. 已绑定参数、可直接执行的写入。 */
export interface SqlPlan {
  readonly sql: string
  readonly params: readonly unknown[]
}

/**
 * Bind one projected value; a missing or mistyped field becomes `NULL`.
 * 绑定一个投影值；缺失或类型不符的字段变成 `NULL`。
 * @param column - projected column 投影列
 * @param record - the record being written 正在写入的记录
 * @returns the bound value 绑定值
 */export function bindColumn(column: ProjectedColumn, record: AdminEntity): unknown {
  const value: unknown = Reflect.get(record, column.field)
  switch (column.type) {
    case 'text': return typeof value === 'string' ? value : null
    case 'boolean': return typeof value === 'boolean' ? value : null
    case 'timestamptz': return typeof value === 'string' ? value : null
    case 'text[]': return isStringArray(value) ? [...value] : null
    case 'jsonb': return value === undefined ? null : JSON.stringify(value)
    default: return assertNever(column.type)
  }
}

/**
 * Bind an upsert of one record.
 * 绑定一条记录的 upsert。
 * @param collection - logical collection name 逻辑集合名
 * @param record - the complete record 完整记录
 * @returns the bound statement and parameters 绑定后的语句与参数
 */
export function planUpsert(collection: string, record: AdminEntity): SqlPlan {
  const table = tableFor(collection)
  const serialized = JSON.stringify(record)
  if (table === undefined) {
    return {
      sql: `INSERT INTO "${FALLBACK_TABLE}" ("collection", "id", "data") VALUES ($1, $2, $3::jsonb)`
        + ' ON CONFLICT ("collection", "id") DO UPDATE SET "data" = EXCLUDED."data"',
      params: [collection, record.id, serialized],
    }
  }
  const columns = ['id', 'data', ...table.columns.map((column) => column.column)]
  const placeholders = columns.map((column, position) => (column === 'data' ? `$${position + 1}::jsonb` : `$${position + 1}`))
  const updates = columns.slice(1).map((column) => `"${column}" = EXCLUDED."${column}"`).join(', ')
  return {
    sql: `INSERT INTO "${table.table}" (${columns.map(quote).join(', ')})`
      + ` VALUES (${placeholders.join(', ')}) ON CONFLICT ("id") DO UPDATE SET ${updates}`,
    params: [record.id, serialized, ...table.columns.map((column) => bindColumn(column, record))],
  }
}

/**
 * Bind a delete of one record. 绑定一条记录的删除。
 * @param collection - logical collection name 逻辑集合名
 * @param id - record id 记录 id
 * @returns the bound statement and parameters 绑定后的语句与参数
 */
export function planRemove(collection: string, id: string): SqlPlan {
  const table = tableFor(collection)
  if (table === undefined) {
    return {
      sql: `DELETE FROM "${FALLBACK_TABLE}" WHERE "collection" = $1 AND "id" = $2`,
      params: [collection, id],
    }
  }
  return { sql: `DELETE FROM "${table.table}" WHERE "id" = $1`, params: [id] }
}

/**
 * Load one platform table. 加载一张平台表。
 * @param table - the table mapping 表映射
 * @returns the bound statement 绑定后的语句
 */export function planLoad(table: CollectionTable): SqlPlan {
  return { sql: `SELECT "data" FROM "${table.table}"`, params: [] }
}

/**
 * Load every fallback row with its collection name. 加载回退表的全部行及集合名。
 * @returns the bound statement 绑定后的语句
 */export function planLoadFallback(): SqlPlan {
  return { sql: `SELECT "collection", "data" FROM "${FALLBACK_TABLE}"`, params: [] }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function quote(identifier: string): string {
  return `"${identifier}"`
}

function assertNever(value: never): never {
  throw new Error(`admin-data-postgres: unhandled column type '${String(value)}'`)
}
