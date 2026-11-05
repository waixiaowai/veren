/**
 * 条件括号组：where 的嵌套分组原语。
 * 关系嵌套条件的数组语义（OR 组）由它表达；括号内的连接词独立于外层。
 *
 * The condition bracket group: the nesting primitive for where clauses. It
 * expresses the array semantics (OR groups) of nested relation conditions;
 * connectors inside are independent of the outer level.
 *
 * @module @veren/orm/query/brackets
 */

import type { WhereClause, WhereConnector } from './expression-map.ts'

/** 括号内可用的条件面。 / The condition face available inside a bracket. */
export interface WhereExpression {
  andWhere(where: string | Brackets, parameters?: Readonly<Record<string, unknown>>): WhereExpression
  orWhere(where: string | Brackets, parameters?: Readonly<Record<string, unknown>>): WhereExpression
}

/** 一组括号条件。 / One parenthesized condition group. */
export class Brackets {
  private readonly clauses: WhereClause[] = []
  private readonly parameters = new Map<string, unknown>()

  constructor(build: (where: WhereExpression) => void) {
    const api: WhereExpression = {
      andWhere: (where, parameters) => this.push('AND', where, parameters),
      orWhere: (where, parameters) => this.push('OR', where, parameters),
    }
    build(api)
  }

  /** 渲染为 `(a AND b OR c)`；首个连接词丢弃。 / Render as `(a AND b OR c)`; the first connector is dropped. */
  render(): string {
    if (this.clauses.length === 0) return '()'
    const body = this.clauses
      .map((clause, index) => (index === 0 ? clause.sql : `${clause.connector} ${clause.sql}`))
      .join(' ')
    return `(${body})`
  }

  /** 括号内登记的命名参数。 / Named parameters registered inside the bracket. */
  getParameters(): ReadonlyMap<string, unknown> {
    return this.parameters
  }

  /** 追加一条条件并返回可继续链式调用的面。 / Append a condition and return a chainable face. */
  private push(connector: WhereConnector, where: string | Brackets, parameters?: Readonly<Record<string, unknown>>): WhereExpression {
    if (where instanceof Brackets) {
      for (const [name, value] of where.getParameters()) this.parameters.set(name, value)
      this.clauses.push({ connector, sql: where.render() })
    } else {
      for (const [name, value] of Object.entries(parameters ?? {})) this.parameters.set(name, value)
      this.clauses.push({ connector, sql: where })
    }
    return {
      andWhere: (nextWhere, nextParameters) => this.push('AND', nextWhere, nextParameters),
      orWhere: (nextWhere, nextParameters) => this.push('OR', nextWhere, nextParameters),
    }
  }
}
