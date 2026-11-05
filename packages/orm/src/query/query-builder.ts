/**
 * 查询构建器抽象基类：持有共享状态包、条件栈、参数通道与执行纪律。
 * 它自己不认识任何一句具体 SQL——具体构建器只实现 `getSql()`。
 *
 * The abstract query builder: holds the shared state bag, the condition stack,
 * the parameter channel and the execution discipline. It knows no concrete SQL
 * — each concrete builder implements only `getSql()`.
 *
 * @module @veren/orm/query/query-builder
 */

import { InvalidMetadataError } from '../errors/index.ts'
import type { EntityMetadata } from '../metadata/entity-metadata.ts'
import type { QueryRunner } from '../driver/query-runner.ts'
import type { DataSource } from '../runtime/data-source.ts'
import type { DeleteResult, InsertResult, QueryResult, UpdateResult } from '../types.ts'
import { Brackets } from './brackets.ts'
import { QueryExpressionMap, type Alias, type OrderByClause } from './expression-map.ts'
import { columnRef, resolveDatabaseName } from './sql-utils.ts'

/** 构建器执行结果的并集；各具体构建器收窄为自己的结果类型。 / Union of builder results; each concrete builder narrows it. */
export type QueryBuilderResult = QueryResult | InsertResult | UpdateResult | DeleteResult

/** 抽象构建器：全部共享状态与通用条件方法。 / The abstract builder with shared state and generic condition methods. */
export abstract class QueryBuilder<Entity extends object = object> {
  protected readonly expressionMap: QueryExpressionMap

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly entityMetadata: EntityMetadata,
    protected readonly queryRunner?: QueryRunner,
    alias?: string,
  ) {
    this.expressionMap = new QueryExpressionMap()
    this.expressionMap.mainAlias = { name: alias ?? defaultAlias(entityMetadata), metadata: entityMetadata }
  }

  /** 主实体元数据。 / The main entity metadata. */
  get metadata(): EntityMetadata {
    return this.entityMetadata
  }

  /** 主别名。 / The main alias. */
  get alias(): string {
    return this.expressionMap.mainAlias?.name ?? ''
  }

  /** 登记一个显式参数。 / Register an explicit parameter. */
  setParameter(name: string, value: unknown): this {
    this.expressionMap.setParameter(name, value)
    return this
  }

  /** 自动命名一个值参数并返回名字（供声明式条件翻译使用）。 / Auto-name a value parameter and return its name (used by find-options translation). */
  addParameter(value: unknown, prefix = 'p'): string {
    return this.expressionMap.addParameter(value, prefix)
  }

  /** 按列类型归一一个条件值（布尔、日期、JSON 等）；嵌套子查询可显式给元数据。 / Normalize a criteria value through the column type; nested subqueries may pass metadata explicitly. */
  prepareParameter(nameOrPath: string, value: unknown, metadata?: EntityMetadata): unknown {
    const { aliasName, property } = splitPath(nameOrPath, this.alias)
    const target = metadata ?? (aliasName === '' ? this.metadata : this.aliasMetadata(aliasName))
    const column = target.findColumn(property) ?? target.findRelation(property)?.joinColumns[0]
    return column === undefined ? value : this.dataSource.driver.preparePersistentValue(column, value)
  }

  /** 合并一组已命名参数（供嵌套子查询使用）。 / Merge named parameters (used by nested subqueries). */
  mergeParameters(parameters: ReadonlyMap<string, unknown>): this {
    for (const [name, value] of parameters) this.expressionMap.setParameter(name, value)
    return this
  }

  /** 重置条件栈。 / Reset the condition stack. */
  where(sql: string, parameters?: Readonly<Record<string, unknown>>): this {
    this.expressionMap.wheres = []
    return this.andWhere(sql, parameters)
  }

  /** 追加 AND 条件（支持括号组）。 / Append an AND condition (bracket groups supported). */
  andWhere(where: string | Brackets, parameters?: Readonly<Record<string, unknown>>): this {
    this.pushWhere('AND', where, parameters)
    return this
  }

  /** 追加 OR 条件（支持括号组）。 / Append an OR condition (bracket groups supported). */
  orWhere(where: string | Brackets, parameters?: Readonly<Record<string, unknown>>): this {
    this.pushWhere('OR', where, parameters)
    return this
  }

  /** 追加 JOIN 条件。 / Append a HAVING condition. */
  having(sql: string, parameters?: Readonly<Record<string, unknown>>): this {
    this.pushHaving(sql, parameters)
    return this
  }

  /** 排序；属性支持 `alias.property` 与裸属性。 / Order by a property (`alias.property` or bare). */
  orderBy(expression: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.expressionMap.orderBys = [{ expression, direction }]
    return this
  }

  /** 追加排序。 / Append an order-by item. */
  addOrderBy(expression: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.expressionMap.orderBys.push({ expression, direction })
    return this
  }

  /** 分组。 / Group by columns. */
  groupBy(...expressions: string[]): this {
    this.expressionMap.groupBys = expressions
    return this
  }

  /** 限制行数。 / Limit rows. */
  limit(limit: number): this {
    this.expressionMap.limit = limit
    return this
  }

  /** 跳过行数。 / Skip rows. */
  offset(offset: number): this {
    this.expressionMap.offset = offset
    return this
  }

  /** take 是 limit 的声明式别名。 / `take` is the declarative alias of `limit`. */
  take(take: number): this {
    return this.limit(take)
  }

  /** skip 是 offset 的声明式别名。 / `skip` is the declarative alias of `offset`. */
  skip(skip: number): this {
    return this.offset(skip)
  }

  /** 让本次执行自开事务。 / Wrap this execution in its own transaction. */
  useTransaction(enabled = true): this {
    this.expressionMap.useTransaction = enabled
    return this
  }

  /** 转义标识符。 / Escape an identifier. */
  escape(name: string): string {
    return this.dataSource.driver.escape(name)
  }

  /** 属性 → 带别名的列引用。 / Property → aliased column reference. */
  protected column(nameOrPath: string, alias = this.alias): string {
    const { aliasName, property } = splitPath(nameOrPath, alias)
    const target = this.aliasMetadata(aliasName)
    return columnRef(this.escape.bind(this), aliasName, resolveDatabaseName(target, property))
  }

  /** 取得别名对应元数据。 / Resolve alias metadata. */
  protected aliasMetadata(aliasName: string): EntityMetadata {
    if (this.expressionMap.mainAlias?.name === aliasName) return this.expressionMap.mainAlias.metadata
    const join = this.expressionMap.joins.find((candidate) => candidate.alias === aliasName)
    if (join === undefined) throw new InvalidMetadataError(`Unknown query alias "${aliasName}". Use the main alias or one of the joined aliases.`)
    return join.metadata
  }

  /** 渲染条件栈。 / Render the condition stack. */
  protected renderWheres(): string {
    return this.expressionMap.wheres
      .map((clause, index) => (index === 0 ? clause.sql : `${clause.connector} ${clause.sql}`))
      .join(' ')
  }

  /** 渲染 HAVING 栈。 / Render the HAVING stack. */
  protected renderHavings(): string {
    return this.expressionMap.havings
      .map((clause, index) => (index === 0 ? clause.sql : `${clause.connector} ${clause.sql}`))
      .join(' ')
  }

  /** 渲染排序。 / Render order-by. */
  protected renderOrderBys(): string {
    return this.expressionMap.orderBys
      .map((clause) => `${this.renderOrderExpression(clause)} ${clause.direction}`)
      .join(', ')
  }

  /** 排序表达式：属性转列名，含括号的片段视为原始 SQL。 / Order expression: properties become columns; fragments with parentheses stay raw. */
  private renderOrderExpression(clause: OrderByClause): string {
    return /[()\s]/.test(clause.expression) ? clause.expression : this.column(clause.expression)
  }

  /** 抽象 SQL 生成。 / Abstract SQL generation. */
  abstract getSql(): string

  /** SQL 与有序参数数组的唯一汇聚点。 / The single convergence point for SQL and ordered parameters. */
  getQueryAndParameters(): [string, unknown[]] {
    return this.dataSource.driver.escapeQueryWithParameters(this.getSql(), this.expressionMap.getParameters())
  }

  /** 执行并返回原始结果；自建执行器必定释放。 / Execute and return raw results; a self-created runner is always released. */
  async execute(): Promise<QueryBuilderResult> {
    const [sql, parameters] = this.getQueryAndParameters()
    return this.executeSql(sql, parameters)
  }

  /** 执行一段已转义的 SQL；事务与释放纪律集中在这里。 / Run escaped SQL; transaction and release discipline live here. */
  protected async executeSql(sql: string, parameters: readonly unknown[]): Promise<QueryResult> {
    const runner = this.queryRunner ?? this.dataSource.createQueryRunner()
    const ownRunner = this.queryRunner === undefined
    try {
      if (this.expressionMap.useTransaction && ownRunner) await runner.startTransaction()
      const result = await runner.query(sql, parameters)
      if (this.expressionMap.useTransaction && ownRunner) await runner.commitTransaction()
      return result
    } catch (error) {
      if (this.expressionMap.useTransaction && ownRunner && runner.isTransactionActive) {
        await runner.rollbackTransaction()
      }
      throw error
    } finally {
      if (ownRunner) await runner.release()
    }
  }

  /** 克隆状态包，产出可独立执行的新构建器。 / Clone the state bag into an independently executable builder. */
  clone(): this {
    const copy = Object.create(Object.getPrototypeOf(this)) as this
    Object.assign(copy, this)
    Object.defineProperty(copy, 'expressionMap', { value: this.expressionMap.clone(), enumerable: true })
    return copy
  }

  /** 追加条件片段。 / Append one condition fragment. */
  protected pushWhere(
    connector: 'AND' | 'OR',
    where: string | Brackets,
    parameters?: Readonly<Record<string, unknown>>,
  ): void {
    if (where instanceof Brackets) {
      for (const [name, value] of where.getParameters()) this.expressionMap.setParameter(name, value)
      this.expressionMap.wheres.push({ connector, sql: where.render() })
      return
    }
    for (const [name, value] of Object.entries(parameters ?? {})) this.expressionMap.setParameter(name, value)
    this.expressionMap.wheres.push({ connector, sql: where })
  }

  /** 追加 HAVING 片段。 / Append one HAVING fragment. */
  private pushHaving(sql: string, parameters?: Readonly<Record<string, unknown>>): void {
    for (const [name, value] of Object.entries(parameters ?? {})) this.expressionMap.setParameter(name, value)
    this.expressionMap.havings.push({ connector: 'AND', sql })
  }
}

/** 默认别名：取表名首字母。 / Default alias: the table name's first letter. */
function defaultAlias(metadata: EntityMetadata): string {
  return metadata.tableName.slice(0, 1).toLowerCase() || 't'
}

/** 拆分 `alias.property` 与裸属性。 / Split `alias.property` from a bare property. */
function splitPath(path: string, fallbackAlias: string): { aliasName: string; property: string } {
  const dot = path.lastIndexOf('.')
  return dot === -1
    ? { aliasName: fallbackAlias, property: path }
    : { aliasName: path.slice(0, dot), property: path.slice(dot + 1) }
}
