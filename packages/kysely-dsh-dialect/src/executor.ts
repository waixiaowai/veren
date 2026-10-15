/**
 * Executor: maps a compiled instruction onto KvTable operations. Reads scan
 * the in-memory snapshot and filter/sort/slice synchronously; writes go
 * through the domain's single durable write chain. Null-handling and LIKE
 * wildcards follow SQL semantics on plain JSON values.
 * 执行器：把编译后的指令映射到 KvTable 操作。读扫描内存快照并同步过滤/排序/
 * 切片；写经 domain 的单一持久写链。空值处理与 LIKE 通配符对纯 JSON 值遵循 SQL
 * 语义。
 * @module src/executor
 */
import type { QueryResult } from 'kysely'
import { DialectError, type CompareLeaf, type DshDomainLike, type Instruction, type Predicate } from './types.js'

/** Lowercase text form used by insensitive comparisons. 大小写不敏感比较用的文本形式。 */
function asText(value: unknown, lower: boolean): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  return lower ? text.toLowerCase() : text
}

/** Evaluate one comparison leaf against one record. 对一条记录求值一个比较叶子。 */
function matchesLeaf(record: Record<string, unknown>, leaf: CompareLeaf): boolean {
  const actual = record[leaf.field]
  switch (leaf.cmp) {
    case 'is_null': return actual === null || actual === undefined
    case 'is_not_null': return actual !== null && actual !== undefined
    case 'like': return likeMatch(String(actual ?? ''), String(leaf.value ?? ''), false)
    case 'ilike': return likeMatch(String(actual ?? ''), String(leaf.value ?? ''), true)
    case 'in': return (leaf.values ?? []).some(candidate => looseEqual(actual, candidate))
    case 'not_in': return !(leaf.values ?? []).some(candidate => looseEqual(actual, candidate))
    case 'eq': return insensitiveText(actual) === insensitiveText(leaf.value)
    case 'ne': return insensitiveText(actual) !== insensitiveText(leaf.value)
    case 'lt': return compareOrdered(actual, leaf.value) < 0
    case 'lte': return compareOrdered(actual, leaf.value) <= 0
    case 'gt': return compareOrdered(actual, leaf.value) > 0
    case 'gte': return compareOrdered(actual, leaf.value) >= 0
  }
}

/** Null-safe equality for `in`/`not_in` membership. `in`/`not_in` 成员判断的空值安全相等。 */
function looseEqual(actual: unknown, candidate: unknown): boolean {
  if (actual === null || actual === undefined) return candidate === null || candidate === undefined
  return actual === candidate
}

/** Insensitive-comparison normalization: strings lowercase, others verbatim. 不敏感比较的归一化：字符串小写，其余原样。 */
function insensitiveText(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value
}

/** Ordered comparison for lt/lte/gt/gte; numbers compare numerically, others as text. lt/lte/gt/gte 的有序比较；数值按数比，其余按文本比。 */
function compareOrdered(actual: unknown, expected: unknown): number {
  if (typeof actual === 'number' && typeof expected === 'number') return actual - expected
  const left = asText(actual, false)
  const right = asText(expected, false)
  return left < right ? -1 : left > right ? 1 : 0
}

/** SQL LIKE with `%`/`_` wildcards translated to a regex. SQL LIKE 的 `%`/`_` 通配符翻译为正则。 */
function likeMatch(actual: string, pattern: string, insensitive: boolean): boolean {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${source}$`, insensitive ? 'i' : '').test(actual)
}

/** Evaluate a predicate tree: `all` = conjunction, `any` = disjunction. 求值谓词树：`all` 为合取，`any` 为析取。 */
export function matchesPredicate(record: Record<string, unknown>, predicate: Predicate): boolean {
  if ('all' in predicate) return predicate.all.every(child => matchesPredicate(record, child))
  if ('any' in predicate) return predicate.any.some(child => matchesPredicate(record, child))
  return matchesLeaf(record, predicate)
}

/** Filter, sort and slice rows per the instruction's shape. 按指令形状过滤、排序、切片。 */
function selectRows(rows: Record<string, unknown>[], instruction: Instruction): Record<string, unknown>[] {
  let result = rows
  if (instruction.where !== undefined) {
    result = result.filter(row => instruction.where!.every(predicate => matchesPredicate(row, predicate)))
  }
  for (const { field, dir } of [...(instruction.orderBy ?? [])].reverse()) {
    result = [...result].sort((a, b) => {
      const order = asText(a[field], false).localeCompare(asText(b[field], false))
      return dir === 'desc' ? -order : order
    })
  }
  const start = instruction.offset ?? 0
  return instruction.limit === undefined ? result.slice(start) : result.slice(start, start + instruction.limit)
}

/** Project rows onto the requested columns (id always kept). 把行投影到请求列（id 始终保留）。 */
function project(rows: Record<string, unknown>[], instruction: Instruction): Record<string, unknown>[] {
  const columns = instruction.columns
  if (columns === undefined || columns.length === 0) return rows
  return rows.map(row => {
    const picked: Record<string, unknown> = { id: row['id'] }
    for (const column of columns) picked[column] = row[column]
    return picked
  })
}

/**
 * Execute one instruction against the domain. Returns the Kysely-shaped
 * result: `rows` always present, `numAffectedRows`/`numChangedRows` on
 * mutations so adapter code relying on affected counts stays correct.
 * 对 domain 执行一条指令。返回 Kysely 形状的结果：`rows` 恒存在，变更操作带
 * `numAffectedRows`/`numChangedRows`，依赖受影响行数的适配器逻辑保持正确。
 */
export async function executeInstruction(domain: DshDomainLike, instruction: Instruction): Promise<QueryResult<Record<string, unknown>>> {
  const table = domain.table(instruction.from)
  if (instruction.op === 'select') {
    const rows = [...table.entries()].map(([, record]) => record as Record<string, unknown>)
    return { rows: project(selectRows(rows, instruction), instruction) }
  }
  if (instruction.op === 'insert') {
    const key = recordKey(instruction.values!)
    await table.put(key, { ...instruction.values })
    return { rows: instruction.returning === true ? [{ ...instruction.values }] : [], numAffectedRows: 1n }
  }
  if (instruction.op === 'update') {
    let changed = 0
    const updated: Record<string, unknown>[] = []
    for (const [key, record] of table.entries()) {
      const plain = record as Record<string, unknown>
      if (instruction.where !== undefined && !instruction.where.every(p => matchesPredicate(plain, p))) continue
      const next = { ...plain, ...instruction.values, id: plain['id'] }
      await table.put(key, next)
      changed += 1
      if (instruction.returning === true) updated.push(next)
    }
    return { rows: updated, numAffectedRows: BigInt(changed), numChangedRows: BigInt(changed) }
  }
  let removed = 0
  for (const [key, record] of table.entries()) {
    const plain = record as Record<string, unknown>
    if (instruction.where !== undefined && !instruction.where.every(p => matchesPredicate(plain, p))) continue
    if (await table.delete(key)) removed += 1
  }
  return { rows: [], numAffectedRows: BigInt(removed) }
}

/** Storage key of one record: `<table>:<id>`; inserts must carry an id. 记录的存储键：`<table>:<id>`；insert 必须带 id。 */
function recordKey(values: Record<string, unknown>): string {
  const id = values['id']
  if (typeof id !== 'string' || id.length === 0) {
    throw new DialectError('DIALECT_INVALID_ROW', 'insert requires a string `id` field')
  }
  return id
}
