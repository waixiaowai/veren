/**
 * 查询表达式状态包：一个查询的全部构建状态。
 * 六个构建器共享这一个包；切换 queryType 只是换投影函数，clone 才产生独立状态。
 *
 * The query expression state bag: every piece of state for one query. All
 * builders share it; switching `queryType` only swaps the projection function,
 * and only `clone()` produces independent state.
 *
 * @module @veren/orm/query/expression-map
 */

import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { EntityValues } from '../types.ts'

/** 查询类型。 / Query type. */
export type QueryType = 'select' | 'insert' | 'update' | 'delete'

/** 条件连接词。 / Condition connector. */
export type WhereConnector = 'AND' | 'OR'

/** 一个条件片段；参数已在全局参数表里。 / One condition fragment; parameters already live in the global table. */
export interface WhereClause {
  connector: WhereConnector
  sql: string
}

/** 排序项。 / One order-by item. */
export interface OrderByClause {
  expression: string
  direction: 'ASC' | 'DESC'
}

/** 主实体或连接别名。 / The main or joined alias. */
export interface Alias {
  name: string
  metadata: EntityMetadata
}

/** 一个连接描述。 / One join description. */
export interface JoinAttribute {
  type: 'inner' | 'left'
  alias: string
  metadata: EntityMetadata
  condition: string
  relation?: string
}

/** 更新赋值。 / One update assignment. */
export interface UpdateAssignment {
  column: string
  parameter?: string
  raw?: string
}

/** 查询状态包。 / The query state bag. */
export class QueryExpressionMap {
  queryType: QueryType = 'select'
  mainAlias: Alias | undefined
  distinct = false
  selects: string[] = []
  joins: JoinAttribute[] = []
  wheres: WhereClause[] = []
  havings: WhereClause[] = []
  groupBys: string[] = []
  orderBys: OrderByClause[] = []
  parameters = new Map<string, unknown>()
  limit: number | undefined
  offset: number | undefined
  values: EntityValues[] = []
  updateSet: UpdateAssignment[] = []
  returning: string[] = []
  useTransaction = false
  private parameterCounter = 0

  /** 登记一个值参数并返回其名字；名字保证不覆盖已有参数。 / Register a value parameter and return a collision-free name. */
  addParameter(value: unknown, prefix = 'p'): string {
    let name = `${prefix}${this.parameterCounter}`
    while (this.parameters.has(name)) {
      this.parameterCounter += 1
      name = `${prefix}${this.parameterCounter}`
    }
    this.parameterCounter += 1
    this.parameters.set(name, value)
    return name
  }

  /** 显式命名参数；同名覆盖。 / Explicitly named parameter; same name overwrites. */
  setParameter(name: string, value: unknown): void {
    this.parameters.set(name, value)
  }

  /** 参数快照；每次转义都基于同一份快照。 / Parameter snapshot; escaping always uses one snapshot. */
  getParameters(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.parameters)
  }

  /** 深拷贝状态包（数组与 Map 都复制）。 / Deep-copy the state bag (arrays and maps included). */
  clone(): QueryExpressionMap {
    const copy = new QueryExpressionMap()
    copy.queryType = this.queryType
    copy.mainAlias = this.mainAlias
    copy.distinct = this.distinct
    copy.selects = [...this.selects]
    copy.joins = [...this.joins]
    copy.wheres = [...this.wheres]
    copy.havings = [...this.havings]
    copy.groupBys = [...this.groupBys]
    copy.orderBys = [...this.orderBys]
    copy.parameters = new Map(this.parameters)
    copy.limit = this.limit
    copy.offset = this.offset
    copy.values = this.values.map((value) => ({ ...value }))
    copy.updateSet = [...this.updateSet]
    copy.returning = [...this.returning]
    copy.useTransaction = this.useTransaction
    copy.parameterCounter = this.parameterCounter
    return copy
  }
}
