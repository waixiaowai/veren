/**
 * 核心表模型与插件表合并（设计文档 modules/08-storage.md §8.4 与 data.md）。
 * 合并顺序确定：插件按声明顺序归并、同名字段后者覆盖、索引按定义去重；
 * 核心表随后装配；`session`/`verification` 在二级存储承载时不生成，
 * `rateLimit` 仅在限流存储选 database 时生成。
 *
 * Core table models and plugin-table merging (design modules/08-storage.md
 * §8.4 and data.md). The merge order is deterministic: plugin tables merge in
 * declaration order (later fields win, indexes dedupe by definition), core
 * tables assemble afterwards; `session`/`verification` vanish under secondary
 * storage, `rateLimit` appears only when rate-limit storage is `database`.
 *
 * @module @veren/auth-core/storage/tables
 */

import type { DBFieldAttribute, DBSchema, DBTableIndex, DBTableModel } from './adapter.ts'

/** 装配输入：只取影响表集的选项切片。 / Assembly input: the option slice that shapes the table set. */
export interface TableOptions {
  /** 二级存储在位时会话与校验凭据默认不再落库。 / With secondary storage, session and verification tables vanish by default. */
  secondaryStorage?: unknown
  /** 强制会话落库。 / Force session rows into the database. */
  storeSessionInDatabase?: boolean
  /** 强制校验凭据落库。 / Force verification rows into the database. */
  storeVerificationInDatabase?: boolean
  /** 限流存储策略。 / The rate-limit storage strategy. */
  rateLimitStorage?: 'memory' | 'database' | 'secondary-storage'
}

/** date 列。 / A date column. */
const date = (extra: Partial<DBFieldAttribute> = {}): DBFieldAttribute => ({ type: 'date', ...extra })
/** string 列。 / A string column. */
const str = (extra: Partial<DBFieldAttribute> = {}): DBFieldAttribute => ({ type: 'string', ...extra })
/** number 列。 / A number column. */
const num = (extra: Partial<DBFieldAttribute> = {}): DBFieldAttribute => ({ type: 'number', ...extra })
/** boolean 列。 / A boolean column. */
const bool = (extra: Partial<DBFieldAttribute> = {}): DBFieldAttribute => ({ type: 'boolean', ...extra })
/** createdAt 列。 / A createdAt column. */
const createdAt = (): DBFieldAttribute => ({ type: 'date', defaultValue: () => new Date() })
/** updatedAt 列。 / An updatedAt column. */
const updatedAt = (): DBFieldAttribute => ({ type: 'date', defaultValue: () => new Date(), onUpdate: () => new Date() })
/** 主键列。 / The primary-key column. */
const idColumn = (): DBFieldAttribute => str({ required: false })

/** 会话引用主体的外键列。 / The session→user foreign-key column. */
const userRef = (): DBFieldAttribute => ({ type: 'string', references: { model: 'user', field: 'id', onDelete: 'cascade' } })

/** 核心表装配器。 / The core-table assembler. */
function coreTables(options: TableOptions): DBSchema {
  const stateful = options.secondaryStorage === undefined
  return {
    user: {
      modelName: 'user',
      order: 1,
      fields: {
        id: idColumn(),
        name: str(),
        email: str({ unique: true, sortable: true }),
        emailVerified: bool({ defaultValue: false, input: false }),
        image: str({ required: false, defaultValue: null }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
      },
    },
    ...(stateful || options.storeSessionInDatabase ? { session: sessionTable() } : {}),
    account: {
      modelName: 'account',
      order: 3,
      fields: {
        id: idColumn(),
        userId: userRef(),
        providerId: str(),
        accountId: str(),
        accessToken: str({ required: false, returned: false }),
        refreshToken: str({ required: false, returned: false }),
        idToken: str({ required: false, returned: false }),
        accessTokenExpiresAt: date({ required: false, returned: false }),
        refreshTokenExpiresAt: date({ required: false, returned: false }),
        scope: str({ required: false }),
        password: str({ required: false, returned: false }),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
      },
      indexes: [{ fields: ['providerId', 'accountId'], name: 'account_provider_account', unique: true }],
    },
    ...(stateful || options.storeVerificationInDatabase ? { verification: verificationTable() } : {}),
    ...(options.rateLimitStorage === 'database' ? { rateLimit: rateLimitTable() } : {}),
  }
}

/** session 表。 / The session table. */
function sessionTable(): DBTableModel {
  return {
    modelName: 'session',
    order: 2,
    fields: {
      id: idColumn(),
      token: str({ unique: true }),
      userId: { ...userRef(), index: true },
      expiresAt: date(),
      ipAddress: str({ required: false }),
      userAgent: str({ required: false }),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      impersonatedBy: str({ required: false, input: false }),
    },
  }
}

/** verification 表。 / The verification table. */
function verificationTable(): DBTableModel {
  return {
    modelName: 'verification',
    order: 4,
    fields: {
      id: idColumn(),
      identifier: str({ unique: true }),
      value: str(),
      expiresAt: date(),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
  }
}

/** rateLimit 表。 / The rateLimit table. */
function rateLimitTable(): DBTableModel {
  return {
    modelName: 'rate_limit',
    order: 5,
    fields: {
      id: idColumn(),
      key: str({ unique: true }),
      count: num({ defaultValue: 0 }),
      lastRequest: num({ defaultValue: () => Date.now() }),
    },
  }
}

/** 按定义去重合并索引：`[name, fields, unique]` 相同即同一条。 / Dedupe indexes by their definition tuple. */
function mergeIndexes(left: readonly DBTableIndex[] | undefined, right: readonly DBTableIndex[] | undefined): DBTableIndex[] {
  const seen = new Set<string>()
  const merged: DBTableIndex[] = []
  for (const index of [...(left ?? []), ...(right ?? [])]) {
    const key = `${index.name ?? ''}|${index.fields.join(',')}|${index.unique === true}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(index)
  }
  return merged
}

/**
 * 装配表模型全集：先按声明顺序归并插件表（同名字段后者覆盖），再装配核心表。
 * 同一配置在任意机器上解析出同一张表结构（决策 4）。
 * / Assemble the full table map: plugin tables fold in declaration order
 * first (later fields win), core tables assemble afterwards. One config
 * yields one table structure anywhere (decision 4).
 */
export function getAuthTables(options: TableOptions, pluginSchemas: readonly DBSchema[] = []): DBSchema {
  const pluginTables: Record<string, DBTableModel> = {}
  for (const schema of pluginSchemas) {
    for (const [key, table] of Object.entries(schema)) {
      const existing = pluginTables[key]
      pluginTables[key] = {
        modelName: table.modelName ?? existing?.modelName ?? key,
        fields: { ...existing?.fields, ...table.fields },
        indexes: mergeIndexes(existing?.indexes, table.indexes),
        disableMigrations: table.disableMigrations ?? existing?.disableMigrations,
        order: table.order ?? existing?.order,
      }
    }
  }
  return { ...coreTables(options), ...pluginTables }
}
