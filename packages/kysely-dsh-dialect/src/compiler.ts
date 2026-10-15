/**
 * QueryCompiler: walks the Kysely operation-node tree and serializes it into a
 * structured JSON instruction placed in `CompiledQuery.sql`. Only the node
 * kinds Kysely actually produces for single-table CRUD are supported; anything
 * else fails loud with a stable code.
 * QueryCompiler：遍历 Kysely operation-node 树，序列化为结构化 JSON 指令放入
 * `CompiledQuery.sql`。只支持单表 CRUD 实际会产生节点种类；其余一律带稳定错误码
 * 显式失败。
 * @module src/compiler
 */
import type {
  ColumnNode,
  CompiledQuery,
  DeleteQueryNode,
  InsertQueryNode,
  OperationNode,
  QueryCompiler,
  QueryId,
  RootOperationNode,
  SelectQueryNode,
  UpdateQueryNode,
  ValuesNode,
} from 'kysely'
import { DialectError, type CompareOp, type Instruction, type OrderItem, type Predicate } from './types.js'

/** Unwrap one boolean tree node into a Predicate. 把一个布尔树节点展开为 Predicate。 */
function compilePredicate(node: OperationNode): Predicate {
  if (node.kind === 'ParensNode') return compilePredicate((node as unknown as { node: OperationNode }).node)
  if (node.kind === 'AndNode') {
    const { left, right } = node as unknown as { left: OperationNode, right: OperationNode }
    return { all: [compilePredicate(left), compilePredicate(right)] }
  }
  if (node.kind === 'OrNode') {
    const { left, right } = node as unknown as { left: OperationNode, right: OperationNode }
    return { any: [compilePredicate(left), compilePredicate(right)] }
  }
  if (node.kind === 'BinaryOperationNode') {
    return compileComparison(node as unknown as { leftOperand: OperationNode, operator: OperationNode, rightOperand: OperationNode })
  }
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported where node kind: ${node.kind}`)
}

/** Field reference on the left side, including the `lower()` insensitive wrapper. 左侧字段引用，含 `lower()` 大小写不敏感包装。 */
function compileFieldRef(node: OperationNode): { field: string, insensitive: boolean } {
  if (node.kind === 'ReferenceNode') {
    const column = (node as unknown as { column: OperationNode }).column
    if (column.kind !== 'ColumnNode') throw new DialectError('DIALECT_NODE_UNSUPPORTED', 'field must be a column')
    return { field: (column as unknown as { column: { name: string } }).column.name, insensitive: false }
  }
  if (node.kind === 'FunctionNode') {
    const fn = node as unknown as { func: string, arguments: readonly OperationNode[] }
    if (fn.func.toLowerCase() !== 'lower' || fn.arguments.length !== 1) {
      throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported function in where: ${fn.func}`)
    }
    return { ...compileFieldRef(fn.arguments[0]!), insensitive: true }
  }
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported comparison operand: ${node.kind}`)
}

/** Extract the literal value(s) on the right side. 提取右侧字面量。 */
function compileValue(node: OperationNode): { value?: unknown, values?: readonly unknown[] } {
  if (node.kind === 'ValueNode') return { value: (node as unknown as { value: unknown }).value }
  if (node.kind === 'PrimitiveValueListNode') return { values: (node as unknown as { values: readonly unknown[] }).values }
  if (node.kind === 'ValueListNode') {
    return {
      values: (node as unknown as { values: readonly OperationNode[] }).values.map(item => {
        if (item.kind !== 'ValueNode') throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported in-list item: ${item.kind}`)
        return (item as unknown as { value: unknown }).value
      }),
    }
  }
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported comparison value: ${node.kind}`)
}

/** Map one binary comparison to a CompareOp leaf. 把一个二元比较映射为 CompareOp 叶子。 */
function compileComparison(node: { leftOperand: OperationNode, operator: OperationNode, rightOperand: OperationNode }): Predicate {
  const { field, insensitive } = compileFieldRef(node.leftOperand)
  if (node.operator.kind !== 'OperatorNode') {
    throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported operator node: ${node.operator.kind}`)
  }
  const op = (node.operator as unknown as { operator: string }).operator.toLowerCase()
  const right = compileValue(node.rightOperand)
  const table: Record<string, CompareOp> = {
    '=': 'eq', '!=': 'ne', '<>': 'ne', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
    in: 'in', 'not in': 'not_in', is: 'is_null', 'is not': 'is_not_null',
  }
  let cmp = table[op]
  if (cmp === undefined && op === 'like') cmp = insensitive ? 'ilike' : 'like'
  if (cmp === undefined) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported operator: ${op}`)
  if (cmp === 'is_null' && right.value !== null && right.value !== undefined) cmp = 'ne'
  const leaf: Predicate = cmp === 'in' || cmp === 'not_in'
    ? { field, cmp, values: right.values ?? [right.value] }
    : { field, cmp, value: right.value }
  return insensitive && (cmp === 'eq' || cmp === 'ne') ? { ...leaf, cmp } : leaf
}

/** Read the raw SQL text of a RawNode fragment (order directions, scalars). 读取 RawNode 片段原始文本（排序方向、标量）。 */
function rawText(node: OperationNode): string {
  if (node.kind === 'RawNode') return (node as unknown as { sqlFragments: readonly string[] }).sqlFragments.join('')
  if (node.kind === 'ValueNode') return String((node as unknown as { value: unknown }).value)
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported literal fragment: ${node.kind}`)
}

/** Extract the single numeric scalar of a limit/offset wrapper. 提取 limit/offset 包装内的单个数值。 */
function compileScalar(node: OperationNode): number {
  if (node.kind === 'ValueNode') {
    const value = (node as unknown as { value: unknown }).value
    if (typeof value === 'number') return value
  }
  if (node.kind === 'RawNode') return compileScalar((node as unknown as { parameters: readonly OperationNode[] }).parameters[0]!)
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported limit/offset: ${node.kind}`)
}

/** Compile an order-by clause into order items. 把 order-by 子句编译为排序项。 */
function compileOrderBy(node: OperationNode): OrderItem[] {
  const items = (node as unknown as { items: readonly { orderBy: OperationNode, direction?: OperationNode }[] }).items
  return items.map(item => {
    const field = compileFieldRef(item.orderBy).field
    const dir = item.direction === undefined ? 'asc' : rawText(item.direction).toLowerCase()
    return { field, dir: dir === 'desc' ? 'desc' as const : 'asc' as const }
  })
}

/** Projection list; any SelectAll shape means "no projection". 投影列；任何形态的 SelectAll 都表示"不投影"。 */
function compileSelections(selections: readonly OperationNode[] | undefined): string[] | undefined {
  if (selections === undefined || selections.length === 0) return undefined
  const columns: string[] = []
  for (const selection of selections) {
    const inner = selection.kind === 'SelectionNode' ? (selection as unknown as { selection: OperationNode }).selection : selection
    const column = inner.kind === 'ReferenceNode'
      ? (inner as unknown as { column: OperationNode }).column
      : inner.kind === 'AliasNode' ? (inner as unknown as { node: OperationNode }).node : inner
    if (column.kind === 'SelectAllNode') return undefined
    if (column.kind === 'ColumnNode') columns.push((column as unknown as { column: { name: string } }).column.name)
  }
  return columns.length > 0 ? columns : undefined
}

/** Physical table name of a from-source; joins and schemas fail loud. from 源的物理表名；join 与 schema 显式失败。 */
function tableName(source: OperationNode | undefined): string {
  if (source === undefined) throw new DialectError('DIALECT_UNSUPPORTED', 'missing from source')
  const node = source.kind === 'AliasNode' ? (source as unknown as { node: OperationNode }).node : source
  if (node.kind !== 'TableNode') throw new DialectError('DIALECT_UNSUPPORTED', `unsupported from source: ${node.kind} (joins not supported)`)
  return (node as unknown as { table: { identifier: { name: string } } }).table.identifier.name
}

/** Extract the where tree of a query node. 提取查询节点的 where 树。 */
function whereOf(node: { where?: { where: OperationNode } }): readonly Predicate[] | undefined {
  return node.where === undefined ? undefined : [compilePredicate(node.where.where)]
}

/** Compile one select query node (subquery form merged onto the inner select). 编译 select 查询节点（子查询形态合并到内层）。 */
function compileSelect(select: SelectQueryNode): Instruction {
  const froms = select.from?.froms ?? []
  if (froms.length !== 1) throw new DialectError('DIALECT_UNSUPPORTED', 'select needs exactly one from source')
  const source = froms[0]!
  if (source.kind === 'AliasNode') {
    // better-auth wraps every select: `select * from (<inner>) as alias`. The
    // inner query carries where/order/limit; the outer only projects.
    // better-auth 会包一层 select：`select * from (<inner>) as alias`。
    // where/排序/分页在内层，外层只做投影。
    const inner = (source as unknown as { node: OperationNode }).node
    if (inner.kind !== 'SelectQueryNode') throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported subquery: ${inner.kind}`)
    return compileSelect(inner as unknown as SelectQueryNode)
  }
  return {
    v: 1,
    op: 'select',
    from: tableName(source),
    columns: compileSelections(select.selections),
    where: whereOf(select),
    orderBy: select.orderBy === undefined ? undefined : compileOrderBy(select.orderBy),
    limit: select.limit === undefined ? undefined : compileScalar(select.limit.limit),
    offset: select.offset === undefined ? undefined : compileScalar(select.offset.offset),
  }
}

/** Compile insert values into the payload object. 把 insert 的 values 编译为载荷对象。 */
function compileInsertValues(node: ValuesNode, columns: readonly string[]): Record<string, unknown> {
  if (node.values.length !== 1) throw new DialectError('DIALECT_UNSUPPORTED', 'multi-row insert not supported')
  const row = node.values[0]!.values
  const payload: Record<string, unknown> = {}
  columns.forEach((name, i) => {
    const cell = row[i]
    if (cell === undefined) return
    // A cell is either a ValueNode (kind discriminant) or a raw primitive.
    // 单元格要么是 ValueNode（kind 判别），要么是原始值。
    if (typeof (cell as { kind?: unknown } | null | undefined)?.kind === 'string') {
      const kind = (cell as { kind: string }).kind
      if (kind === 'DefaultInsertValueNode') return
      if (kind !== 'ValueNode') throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported insert value: ${kind}`)
      payload[name] = (cell as unknown as { value: unknown }).value
      return
    }
    payload[name] = cell
  })
  return payload
}

/** Compile an update set clause into the merge patch. 把 update 的 set 子句编译为合并补丁。 */
function compileUpdates(node: UpdateQueryNode): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const update of node.updates ?? []) {
    if (update.value.kind !== 'ValueNode') throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported update value: ${update.value.kind}`)
    const column = update.column as unknown as ColumnNode
    values[column.column.name] = (update.value as unknown as { value: unknown }).value
  }
  return values
}

/**
 * Create the QueryCompiler. `compileQuery` never produces SQL text — the
 * `sql` field carries the JSON instruction and `parameters` stays empty.
 * 创建 QueryCompiler。`compileQuery` 不产生 SQL 文本——`sql` 字段承载 JSON 指令，
 * `parameters` 保持为空。
 */
export function createDomainQueryCompiler(): QueryCompiler {
  return {
    compileQuery(root: OperationNode, queryId: QueryId): CompiledQuery {
      // `OperationNode` is a single interface, so `kind` checks do not narrow;
      // dispatch casts to the concrete node types are the honest boundary.
      // `OperationNode` 是单一接口，kind 判断不收窄；分发处转换为具体节点类型
      // 是如实的边界。
      let instruction: Instruction
      if (root.kind === 'SelectQueryNode') instruction = compileSelect(root as unknown as SelectQueryNode)
      else if (root.kind === 'InsertQueryNode') instruction = compileInsert(root as unknown as InsertQueryNode)
      else if (root.kind === 'UpdateQueryNode') instruction = compileUpdate(root as unknown as UpdateQueryNode)
      else if (root.kind === 'DeleteQueryNode') instruction = compileDelete(root as unknown as DeleteQueryNode)
      else throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported root node: ${root.kind}`)
      return { query: root as unknown as RootOperationNode, queryId, sql: JSON.stringify(instruction), parameters: [] }
    },
  }
}

/** Compile an insert query node. 编译 insert 查询节点。 */
function compileInsert(node: InsertQueryNode): Instruction {
  if (node.onConflict || node.onDuplicateKey) throw new DialectError('DIALECT_UNSUPPORTED', 'upsert not supported')
  const columns = (node.columns ?? []).map(c => c.column.name)
  return {
    v: 1,
    op: 'insert',
    from: tableName(node.into === undefined ? undefined : node.into as unknown as OperationNode),
    values: compileInsertValues(node.values as unknown as ValuesNode, columns),
    returning: node.returning !== undefined,
  }
}

/** Compile an update query node. 编译 update 查询节点。 */
function compileUpdate(node: UpdateQueryNode): Instruction {
  return {
    v: 1,
    op: 'update',
    from: tableName(node.table),
    where: whereOf(node),
    values: compileUpdates(node),
    returning: node.returning !== undefined,
  }
}

/** Compile a delete query node. 编译 delete 查询节点。 */
function compileDelete(node: DeleteQueryNode): Instruction {
  return {
    v: 1,
    op: 'delete',
    from: tableName(node.from.froms[0]),
    where: whereOf(node),
    returning: node.returning !== undefined,
  }
}
