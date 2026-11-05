/**
 * 查询语法策略：排序与分页是各库差异最大的两句 SQL，由方言自己渲染。
 * Query syntax strategy: ordering and paging are the most dialect-specific
 * fragments, so each dialect renders them itself.
 *
 * @module @veren/orm/driver/query-syntax
 */

import type { SortDirection } from '../query/expression-map.ts'

/** 排序/分页渲染。 / Ordering/paging renderer. */
export interface QuerySyntax {
  orderBy(expression: string, direction: SortDirection): string
  limitOffset(limit?: number, offset?: number): string
}

/** 标准 SQL：NULLS LAST + LIMIT/OFFSET。 / Standard SQL: NULLS LAST + LIMIT/OFFSET. */
export class StandardQuerySyntax implements QuerySyntax {
  orderBy(expression: string, direction: SortDirection): string {
    return `${expression} ${direction} NULLS LAST`
  }

  limitOffset(limit?: number, offset?: number): string {
    if (limit !== undefined && offset !== undefined) return `LIMIT ${limit} OFFSET ${offset}`
    if (limit !== undefined) return `LIMIT ${limit}`
    if (offset === undefined) return ''
    return `LIMIT ALL OFFSET ${offset}`
  }
}

/** SQLite：offset-only 需要 `LIMIT -1`。 / SQLite: offset-only needs `LIMIT -1`. */
export class SqliteQuerySyntax extends StandardQuerySyntax {
  override limitOffset(limit?: number, offset?: number): string {
    if (limit === undefined && offset !== undefined) return `LIMIT -1 OFFSET ${offset}`
    return super.limitOffset(limit, offset)
  }
}

/** MySQL：NULLS LAST 用 `IS NULL` 模拟，offset-only 用最大 LIMIT。 / MySQL: emulate NULLS LAST and offset-only. */
export class MysqlQuerySyntax extends StandardQuerySyntax {
  override orderBy(expression: string, direction: SortDirection): string {
    return `(${expression} IS NULL) ASC, ${expression} ${direction}`
  }

  override limitOffset(limit?: number, offset?: number): string {
    if (limit === undefined && offset !== undefined) return `LIMIT 18446744073709551615 OFFSET ${offset}`
    return super.limitOffset(limit, offset)
  }
}
