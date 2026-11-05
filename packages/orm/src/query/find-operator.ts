/**
 * 查找操作符：把比较语义包装成值对象，同一实例可复用。
 * 操作符支持嵌套（如 `Not(In([1, 2]))`），翻译器据此递归生成 SQL。
 *
 * Find operators: compare semantics wrapped as value objects that can be
 * reused. Operators nest (`Not(In([1, 2]))`), and the translator recurses.
 *
 * @module @veren/orm/query/find-operator
 */

/** 操作符种类。 / Operator kinds. */
export type FindOperatorType =
  | 'equal'
  | 'not'
  | 'in'
  | 'isNull'
  | 'like'
  | 'ilike'
  | 'between'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'moreThan'
  | 'moreThanOrEqual'
  | 'raw'

/** 一个查找操作符。 / One find operator. */
export class FindOperator<T = unknown> {
  constructor(
    readonly type: FindOperatorType,
    readonly value?: T,
    readonly getSql?: () => string,
    readonly objectLiteralParameters?: Readonly<Record<string, unknown>>,
  ) {}
}

/** 相等。 / Equality. */
export function Equal<T>(value: T): FindOperator<T> {
  return new FindOperator('equal', value)
}

/** 不等；可包裹另一个操作符。 / Not-equal; may wrap another operator. */
export function Not<T>(value: T | FindOperator<T>): FindOperator<T> {
  return new FindOperator('not', value) as FindOperator<T>
}

/** 集合包含。 / Membership in a set. */
export function In<T>(values: readonly T[]): FindOperator<T> {
  return new FindOperator('in', values as T)
}

/** 为空。 / IS NULL. */
export function IsNull(): FindOperator<null> {
  return new FindOperator('isNull')
}

/** LIKE。 / LIKE. */
export function Like(value: string): FindOperator<string> {
  return new FindOperator('like', value)
}

/** 大小写不敏感 LIKE。 / Case-insensitive LIKE. */
export function ILike(value: string): FindOperator<string> {
  return new FindOperator('ilike', value)
}

/** 区间。 / BETWEEN. */
export function Between<T>(from: T, to: T): FindOperator<readonly [T, T]> {
  return new FindOperator('between', [from, to])
}

/** 小于。 / Less than. */
export function LessThan<T>(value: T): FindOperator<T> {
  return new FindOperator('lessThan', value)
}

/** 小于等于。 / Less than or equal. */
export function LessThanOrEqual<T>(value: T): FindOperator<T> {
  return new FindOperator('lessThanOrEqual', value)
}

/** 大于。 / Greater than. */
export function MoreThan<T>(value: T): FindOperator<T> {
  return new FindOperator('moreThan', value)
}

/** 大于等于。 / Greater than or equal. */
export function MoreThanOrEqual<T>(value: T): FindOperator<T> {
  return new FindOperator('moreThanOrEqual', value)
}

/** 原生 SQL 片段；值必须走 objectLiteralParameters，绝不内联。 / Raw SQL fragment; values must travel in objectLiteralParameters. */
export function Raw<T>(getSql: () => string, parameters: Readonly<Record<string, unknown>> = {}): FindOperator<T> {
  return new FindOperator('raw', undefined, getSql, parameters) as FindOperator<T>
}

/** 是否为查找操作符。 / Whether a value is a find operator. */
export function isFindOperator(value: unknown): value is FindOperator<unknown> {
  return value instanceof FindOperator
}
