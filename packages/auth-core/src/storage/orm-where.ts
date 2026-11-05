/**
 * Where[] → @veren/orm 条件翻译：操作符全集与 AND/OR 连接的唯一下沉点。
 * AND 子句进同一条件对象；OR 子句按「AND 部分公共 + 单 OR 分支」展开为
 * 条件数组（ORM 数组即 OR 组）。空条件返回 undefined，由调用方决定语义。
 *
 * Where[] → @veren/orm criteria translation: the single sink for the
 * operator set and AND/OR joining. AND clauses share one criteria object;
 * OR clauses expand into a criteria array of "shared AND part + one OR
 * branch" (ORM arrays are OR groups). Empty input yields undefined; the
 * caller decides the semantics.
 *
 * @module @veren/auth-core/storage/orm-where
 */

import {
  Equal,
  ILike,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
} from '@veren/orm'
import type { CleanedWhere, Where } from './adapter.ts'

/** 规范化条件子句：补全操作符、连接符与比较模式的默认值。 / Normalize a clause: fill operator, connector and mode defaults. */
export function normalizeWhere(where: readonly Where[] | undefined): CleanedWhere[] {
  return (where ?? []).map((clause) => ({
    operator: clause.operator ?? 'eq',
    value: clause.value,
    field: clause.field,
    connector: clause.connector ?? 'AND',
    mode: clause.mode ?? 'sensitive',
  }))
}

/** 操作数文本的 LIKE/ILIKE 通配转义。 / Escape LIKE/ILIKE wildcards in the operand text. */
function likeOperand(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1')
}

/** 单条件子句 → ORM 条件值。 / One clause → an ORM criteria value. */
function clauseValue(clause: CleanedWhere): unknown {
  const value = clause.value
  switch (clause.operator) {
    case 'eq': return value === null ? IsNull() : value
    case 'ne': return value === null ? Not(IsNull()) : Not(value)
    case 'lt': return LessThan(value)
    case 'lte': return LessThanOrEqual(value)
    case 'gt': return MoreThan(value)
    case 'gte': return MoreThanOrEqual(value)
    case 'in': return In(value as readonly (string | number)[])
    case 'not_in': return Not(In(value as readonly (string | number)[]))
    case 'contains': return likePattern(likeOperand(String(value)), '%', '%', clause.mode)
    case 'starts_with': return likePattern(likeOperand(String(value)), '', '%', clause.mode)
    case 'ends_with': return likePattern(likeOperand(String(value)), '%', '', clause.mode)
  }
}

/** 按比较模式挑选 LIKE 或 ILIKE。 / Pick LIKE or ILIKE per the comparison mode. */
function likePattern(operand: string, head: string, tail: string, mode: CleanedWhere['mode']): unknown {
  const pattern = `${head}${operand}${tail}`
  return mode === 'insensitive' ? ILike(pattern) : Like(pattern)
}

/** 条件子句集合 → ORM 条件（对象或 OR 数组）。 / Clauses → ORM criteria (object, or an OR array). */
export function toCriteria(where: readonly Where[] | undefined): object | readonly object[] | undefined {
  const cleaned = normalizeWhere(where)
  const andPart: Record<string, unknown> = {}
  for (const clause of cleaned) {
    if (clause.connector === 'AND') andPart[clause.field] = clauseValue(clause)
  }
  const orClauses = cleaned.filter((clause) => clause.connector === 'OR')
  if (orClauses.length === 0) return andPart
  return orClauses.map((clause) => ({ ...andPart, [clause.field]: clauseValue(clause) }))
}

/** 条件子句集合是否含 OR 连接。 / Whether the clause set contains an OR join. */
export function hasOrClause(where: readonly CleanedWhere[]): boolean {
  return where.some((clause) => clause.connector === 'OR')
}
