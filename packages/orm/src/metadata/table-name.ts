/**
 * 表名前缀应用：唯一实现，避免构建器与关系/索引构建器各写一遍。
 * Table-name prefixing in one place so the builder, relation builder and index
 * builder cannot drift.
 *
 * @module @veren/orm/metadata/table-name
 */

/** 应用表名前缀；空前缀原样返回。 / Apply the table prefix; empty prefixes pass through. */
export function applyPrefix(tableName: string, prefix: string | undefined): string {
  return prefix === undefined || prefix === '' ? tableName : `${prefix}${tableName}`
}
