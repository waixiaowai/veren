/**
 * Instruction intermediate representation: the JSON "sql" our compiler emits
 * and our executor consumes. Keeping the whole query in one document makes
 * execution atomic and avoids positional-parameter re-binding bugs.
 * 指令中间表示：编译器产出的 JSON "sql"，执行器消费它。整条查询放在一个文档里
 * 保证执行原子性，也避免位置参数重绑定一类的 bug。
 * @module src/types
 */
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * Minimal structural view of an open DSH storage domain. Deliberately wider
 * than `Domain<S>`: any object able to hand out table handles works, and the
 * dialect never opens or closes the domain itself — the consumer owns it.
 * 已打开 DSH storage domain 的最小结构视图。刻意比 `Domain<S>` 宽：任何能给出台
 * 表句柄的对象都可以；dialect 绝不自行打开或关闭 domain——生命周期归消费方。
 */
export interface DshDomainLike {
  /**
   * Resolve a declared table handle; unknown names must fail loud.
   * 解析已声明表句柄；未知名称必须显式失败。
   */
  table(name: string): KvTable<string, unknown>
}

/** Supported comparison operations. 支持的比较操作。 */
export type CompareOp =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not_in'
  | 'like'
  | 'ilike'
  | 'is_null'
  | 'is_not_null'

/** One field comparison leaf. 单字段比较叶子。 */
export interface CompareLeaf {
  readonly field: string
  readonly cmp: CompareOp
  readonly value?: unknown
  readonly values?: readonly unknown[]
}

/** Boolean predicate tree over leaves: `all` = conjunction, `any` = disjunction. 叶子上的布尔谓词树：`all` 为合取，`any` 为析取。 */
export type Predicate = { readonly all: readonly Predicate[] } | { readonly any: readonly Predicate[] } | CompareLeaf

/** Sort order item. 排序项。 */
export interface OrderItem {
  readonly field: string
  readonly dir: 'asc' | 'desc'
}

/** One compiled instruction, transported inside `CompiledQuery.sql`. 一条编译后的指令，放在 `CompiledQuery.sql` 里传输。 */
export interface Instruction {
  /** Instruction format version, for forward compatibility. 指令格式版本，向前兼容用。 */
  readonly v: 1
  readonly op: 'select' | 'insert' | 'update' | 'delete'
  /** Physical table name == declared KvTable name. 物理表名 == 已声明的 KvTable 名。 */
  readonly from: string
  /** Projection column list; absent/empty means select all. 投影列；缺省或空表示全选。 */
  readonly columns?: readonly string[]
  /** Conjunction of predicates; missing means unconditional. 谓词合取；缺省表示无条件。 */
  readonly where?: readonly Predicate[]
  /** Insert payload or update merge patch. insert 载荷或 update 合并补丁。 */
  readonly values?: Readonly<Record<string, unknown>>
  readonly orderBy?: readonly OrderItem[]
  readonly limit?: number
  readonly offset?: number
  /** Whether the caller asked for the affected rows back. 调用方是否要求返回受影响的行。 */
  readonly returning?: boolean
}

/** Structured error thrown for unsupported or malformed queries. 不受支持或非法查询抛出的结构化错误。 */
export class DialectError extends Error {
  /** Stable machine-readable code, e.g. `DIALECT_NODE_UNSUPPORTED`. 稳定的机器可读错误码，如 `DIALECT_NODE_UNSUPPORTED`。 */
  readonly code: string
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'DialectError'
    this.code = code
  }
}
