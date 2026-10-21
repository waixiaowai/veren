/**
 * QueryCompiler: walks the Kysely operation-node tree and serializes it into a
 * structured JSON instruction placed in `CompiledQuery.sql`. Only the node
 * kinds Kysely actually produces for single-table CRUD are supported; anything
 * else fails loud with a stable code.
 * QueryCompiler：遍历 Kysely operation-node 树，序列化为结构化 JSON 指令放入
 * `CompiledQuery.sql`。只支持单表 CRUD 实际会产生节点种类；其余一律带稳定错误码
 * 显式失败。
 *
 * 收窄纪律：`OperationNode` 是**单一 interface**（`kind` 是宽联合），`node.kind === 'X'`
 * 不产生类型收窄。这里的收窄一律走 Kysely 自带的 `XxxNode.is()` 类型守卫——不再用
 * `node as unknown as { … }` 手写结构断言（那种断言绕过检查，字段改名时静默失效）。
 * Narrowing discipline: `OperationNode` is a single interface whose `kind` is a
 * wide union, so `node.kind === 'X'` does not narrow. Every narrowing here goes
 * through Kysely's own `XxxNode.is()` guards instead of hand-written
 * `as unknown as { … }` structural assertions, which bypass checking entirely.
 * @module src/compiler
 */
import {
  AliasNode,
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  DeleteQueryNode,
  FunctionNode,
  InsertQueryNode,
  OperatorNode,
  OrNode,
  ParensNode,
  PrimitiveValueListNode,
  RawNode,
  ReferenceNode,
  SelectAllNode,
  SelectQueryNode,
  SelectionNode,
  TableNode,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
} from 'kysely'
import type {
  CompiledQuery,
  OperationNode,
  OrderByNode,
  QueryCompiler,
  QueryId,
  RootOperationNode,
} from 'kysely'
import { DialectError, type CompareOp, type Instruction, type OrderItem, type Predicate } from './types.js'

/** Unwrap one boolean tree node into a Predicate. 把一个布尔树节点展开为 Predicate。 */
function compilePredicate(node: OperationNode): Predicate {
  if (ParensNode.is(node)) return compilePredicate(node.node)
  if (AndNode.is(node)) return { all: [compilePredicate(node.left), compilePredicate(node.right)] }
  if (OrNode.is(node)) return { any: [compilePredicate(node.left), compilePredicate(node.right)] }
  if (BinaryOperationNode.is(node)) return compileComparison(node)
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported where node kind: ${node.kind}`)
}

/** Field reference on the left side, including the `lower()` insensitive wrapper. 左侧字段引用，含 `lower()` 大小写不敏感包装。 */
function compileFieldRef(node: OperationNode): { field: string, insensitive: boolean } {
  if (ReferenceNode.is(node)) {
    const { column } = node
    if (!ColumnNode.is(column)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', 'field must be a column')
    return { field: column.column.name, insensitive: false }
  }
  if (FunctionNode.is(node)) {
    if (node.func.toLowerCase() !== 'lower' || node.arguments.length !== 1) {
      throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported function in where: ${node.func}`)
    }
    return { ...compileFieldRef(node.arguments[0]!), insensitive: true }
  }
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported comparison operand: ${node.kind}`)
}

/** Extract the literal value(s) on the right side. 提取右侧字面量。 */
function compileValue(node: OperationNode): { value?: unknown, values?: readonly unknown[] } {
  if (ValueNode.is(node)) return { value: node.value }
  if (ValueListNode.is(node)) {
    return {
      values: node.values.map((item) => {
        if (!ValueNode.is(item)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported in-list item: ${item.kind}`)
        return item.value
      }),
    }
  }
  // PrimitiveValueListNode carries raw primitives rather than child nodes.
  // PrimitiveValueListNode 携带原始值而非子节点。
  if (PrimitiveValueListNode.is(node)) return { values: node.values }
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported comparison value: ${node.kind}`)
}

/** Map one binary comparison to a CompareOp leaf. 把一个二元比较映射为 CompareOp 叶子。 */
function compileComparison(node: BinaryOperationNode): Predicate {
  const { field, insensitive } = compileFieldRef(node.leftOperand)
  if (!OperatorNode.is(node.operator)) {
    throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported operator node: ${node.operator.kind}`)
  }
  const op = node.operator.operator.toLowerCase()
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
  if (RawNode.is(node)) return node.sqlFragments.join('')
  if (ValueNode.is(node)) return String(node.value)
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported literal fragment: ${node.kind}`)
}

/** Extract the single numeric scalar of a limit/offset wrapper. 提取 limit/offset 包装内的单个数值。 */
function compileScalar(node: OperationNode): number {
  if (ValueNode.is(node) && typeof node.value === 'number') return node.value
  if (RawNode.is(node)) return compileScalar(node.parameters[0]!)
  throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported limit/offset: ${node.kind}`)
}

/** Compile an order-by clause into order items. 把 order-by 子句编译为排序项。 */
function compileOrderBy(node: OrderByNode): OrderItem[] {
  return node.items.map((item) => {
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
    const inner = SelectionNode.is(selection) ? selection.selection : selection
    const column = ReferenceNode.is(inner)
      ? inner.column
      : AliasNode.is(inner) ? inner.node : inner
    if (SelectAllNode.is(column)) return undefined
    if (ColumnNode.is(column)) columns.push(column.column.name)
  }
  return columns.length > 0 ? columns : undefined
}

/** Physical table name of a from-source; joins and schemas fail loud. from 源的物理表名；join 与 schema 显式失败。 */
function tableName(source: OperationNode | undefined): string {
  if (source === undefined) throw new DialectError('DIALECT_UNSUPPORTED', 'missing from source')
  const node = AliasNode.is(source) ? source.node : source
  if (!TableNode.is(node)) throw new DialectError('DIALECT_UNSUPPORTED', `unsupported from source: ${node.kind} (joins not supported)`)
  return node.table.identifier.name
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
  if (AliasNode.is(source)) {
    // better-auth wraps every select: `select * from (<inner>) as alias`. The
    // inner query carries where/order/limit; the outer only projects.
    // better-auth 会包一层 select：`select * from (<inner>) as alias`。
    // where/排序/分页在内层，外层只做投影。
    const { node: inner } = source
    if (!SelectQueryNode.is(inner)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported subquery: ${inner.kind}`)
    return compileSelect(inner)
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
  const row = node.values[0]!
  const payload: Record<string, unknown> = {}
  // 两个来源分支各自类型精确：ValueListNode 是子节点列表，PrimitiveValueListNode 是原始值列表。
  // The two item shapes keep exact types: ValueListNode holds child nodes,
  // PrimitiveValueListNode holds raw primitives.
  if (ValueListNode.is(row)) {
    columns.forEach((name, i) => {
      const child = row.values[i]
      if (child === undefined) return
      if (child.kind === 'DefaultInsertValueNode') return
      if (!ValueNode.is(child)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported insert value: ${child.kind}`)
      payload[name] = child.value
    })
    return payload
  }
  columns.forEach((name, i) => {
    const value = row.values[i]
    if (value === undefined) return
    payload[name] = value
  })
  return payload
}

/** Compile an update set clause into the merge patch. 把 update 的 set 子句编译为合并补丁。 */
function compileUpdates(node: UpdateQueryNode): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const update of node.updates ?? []) {
    if (!ValueNode.is(update.value)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported update value: ${update.value.kind}`)
    if (!ColumnNode.is(update.column)) throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported update column: ${update.column.kind}`)
    values[update.column.column.name] = update.value.value
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
    compileQuery(root: RootOperationNode, queryId: QueryId): CompiledQuery {
      // `RootOperationNode` 是可判别联合，`.is()` 守卫直接收窄，无需转换。
      // `RootOperationNode` is a discriminated union, so the `.is()` guards
      // narrow directly — no assertion needed anywhere in this dispatch.
      let instruction: Instruction
      if (SelectQueryNode.is(root)) instruction = compileSelect(root)
      else if (InsertQueryNode.is(root)) instruction = compileInsert(root)
      else if (UpdateQueryNode.is(root)) instruction = compileUpdate(root)
      else if (DeleteQueryNode.is(root)) instruction = compileDelete(root)
      else throw new DialectError('DIALECT_NODE_UNSUPPORTED', `unsupported root node: ${root.kind}`)
      return { query: root, queryId, sql: JSON.stringify(instruction), parameters: [] }
    },
  }
}

/** Compile an insert query node. 编译 insert 查询节点。 */
function compileInsert(node: InsertQueryNode): Instruction {
  if (node.onConflict || node.onDuplicateKey) throw new DialectError('DIALECT_UNSUPPORTED', 'upsert not supported')
  if (node.values === undefined || !ValuesNode.is(node.values)) {
    throw new DialectError('DIALECT_NODE_UNSUPPORTED', 'insert without a values list')
  }
  const columns = (node.columns ?? []).map(c => c.column.name)
  return {
    v: 1,
    op: 'insert',
    from: tableName(node.into),
    values: compileInsertValues(node.values, columns),
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
