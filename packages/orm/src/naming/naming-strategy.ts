/**
 * 命名策略：表、列、约束与索引名的唯一决策点。
 * 默认策略把 camelCase 转成 snake_case，且保证同一输入恒同输出——这是模式
 * 同步幂等的根基。
 *
 * Naming strategy: the single decision point for table, column, constraint and
 * index names. The default converts camelCase to snake_case and guarantees the
 * same output for the same input — the foundation of idempotent schema sync.
 *
 * @module @veren/orm/naming
 */

/** 命名决策面；实现必须确定（同输入恒同输出）。 / Naming decisions; implementations must be deterministic. */
export interface NamingStrategyInterface {
  /** 表名 / table name */
  tableName(className: string, customName?: string): string
  /** 列名，`embeddedPrefixes` 为嵌入对象前缀链 / column name with embedded prefixes */
  columnName(propertyName: string, customName?: string, embeddedPrefixes?: readonly string[]): string
  /** 关系属性名 → 中间表列前缀 / relation property name used as a junction prefix */
  relationName(propertyName: string): string
  /** 主键约束名 / primary key constraint name */
  primaryKeyName(tableName: string, columns: readonly string[]): string
  /** 唯一约束名 / unique constraint name */
  uniqueConstraintName(tableName: string, columns: readonly string[]): string
  /** 外键约束名 / foreign key constraint name */
  foreignKeyName(
    tableName: string,
    columns: readonly string[],
    referencedTableName?: string,
    referencedColumns?: readonly string[],
  ): string
  /** 索引名 / index name */
  indexName(tableName: string, columns: readonly string[], where?: string): string
  /** 检查约束名 / check constraint name */
  checkConstraintName(tableName: string, expression: string): string
  /** 关系连接列名（多对一/一对一） / join column name */
  joinColumnName(propertyName: string, referencedColumnName: string): string
  /** 多对多中间表名 / many-to-many junction table name */
  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string): string
  /** 中间表列名 / junction table column name */
  joinTableColumnName(tableName: string, propertyName: string): string
  /** 反向中间表列名 / inverse junction table column name */
  joinTableInverseColumnName(tableName: string, propertyName: string): string
  /** 前缀表名 / prefixed table name */
  prefixTableName(prefix: string, tableName: string): string
  /** 嵌套集左列名 / nested-set left column */
  readonly nestedSetColumnNames: { readonly left: string; readonly right: string }
  /** 物化路径列名 / materialized path column */
  readonly materializedPathColumnName: string
}

/**
 * camelCase / PascalCase / 缩写串 → snake_case。
 * 例：`createdAt` → `created_at`，`HTTPServer` → `http_server`。
 *
 * camelCase / PascalCase / acronym runs → snake_case.
 */
export function snakeCase(value: string): string {
  const withBoundaries = value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  return withBoundaries.replace(/[-\s]+/g, '_').toLowerCase()
}

/**
 * 确定性短哈希（FNV-1a 32 位），用于超长标识符截断后缀。
 * 纯函数、零依赖，浏览器与 Workers 同样可用。
 *
 * Deterministic short hash (FNV-1a 32-bit) used to suffix truncated
 * identifiers. Pure, dependency-free, identical on browsers and Workers.
 */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 默认命名策略；所有名字都由属性或表名确定性派生。
 * The default strategy: every name derives deterministically from a property
 * or table name.
 */
export class DefaultNamingStrategy implements NamingStrategyInterface {
  readonly nestedSetColumnNames = { left: 'nsleft', right: 'nsright' } as const
  readonly materializedPathColumnName = 'mpath'

  tableName(className: string, customName?: string): string {
    return customName ?? snakeCase(className)
  }

  columnName(propertyName: string, customName?: string, embeddedPrefixes: readonly string[] = []): string {
    const base = customName ?? snakeCase(propertyName)
    return embeddedPrefixes.length === 0 ? base : `${embeddedPrefixes.map(snakeCase).join('_')}_${base}`
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName)
  }

  primaryKeyName(tableName: string, columns: readonly string[]): string {
    return truncate(`${tableName}_${columns.join('_')}_pk`)
  }

  uniqueConstraintName(tableName: string, columns: readonly string[]): string {
    return truncate(`${tableName}_${columns.join('_')}_uq`)
  }

  foreignKeyName(
    tableName: string,
    columns: readonly string[],
    referencedTableName?: string,
    referencedColumns: readonly string[] = [],
  ): string {
    const target = referencedTableName === undefined ? '' : `_${referencedTableName}`
    const targetColumns = referencedColumns.length === 0 ? '' : `_${referencedColumns.join('_')}`
    return truncate(`${tableName}_${columns.join('_')}${target}${targetColumns}_fk`)
  }

  indexName(tableName: string, columns: readonly string[], where?: string): string {
    const suffix = where === undefined ? '' : `_${shortHash(where)}`
    return truncate(`${tableName}_${columns.join('_')}_idx${suffix}`)
  }

  checkConstraintName(tableName: string, expression: string): string {
    return truncate(`${tableName}_${shortHash(expression)}_chk`)
  }

  joinColumnName(propertyName: string, referencedColumnName: string): string {
    return truncate(`${snakeCase(propertyName)}_${snakeCase(referencedColumnName)}`)
  }

  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string): string {
    return truncate(`${firstTableName}_${secondTableName}_${snakeCase(firstPropertyName)}`)
  }

  joinTableColumnName(tableName: string, propertyName: string): string {
    return truncate(`${tableName}_${snakeCase(propertyName)}`)
  }

  joinTableInverseColumnName(tableName: string, propertyName: string): string {
    return truncate(`${tableName}_${snakeCase(propertyName)}`)
  }

  prefixTableName(prefix: string, tableName: string): string {
    return `${prefix}${tableName}`
  }
}

/** 数据库标识符常见上限 63；超出时截断并附确定性哈希。 / Identifier cap (63), truncated with a deterministic hash. */
function truncate(name: string, maxLength = 63): string {
  if (name.length <= maxLength) return name
  const hash = shortHash(name)
  return `${name.slice(0, maxLength - hash.length - 1)}_${hash}`
}
