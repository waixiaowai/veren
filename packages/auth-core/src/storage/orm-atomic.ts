/**
 * 原子原语降级实现（设计文档 modules/08-storage.md 决策 2/3）。
 * `consumeOne`：快照守卫删除，受影响行数必须恰为 0 或 1；
 * `incrementOne`：读—算—条件写 CAS 循环，竞争耗尽抛错而不返回 null。
 *
 * Atomic-primitive fallbacks (design modules/08-storage.md decisions 2/3).
 * `consumeOne`: snapshot-guarded delete, affected rows must be exactly 0 or 1;
 * `incrementOne`: read-compute-conditional-write CAS loop, contention
 * exhaustion throws instead of returning null.
 *
 * @module @veren/auth-core/storage/orm-atomic
 */

import type { Where } from './adapter.ts'
import { hasOrClause, normalizeWhere } from './orm-where.ts'

/** CAS 重试上限。 / The CAS retry ceiling. */
const MAX_ATTEMPTS = 5

/** 原子原语依赖的最小读写面（便于事务内复用）。 / The minimal surface the primitives need (reusable inside transactions). */
export interface AtomicFacade {
  findOne<T>(data: { model: string, where: Where[] }): Promise<T | null>
  updateMany(data: { model: string, where: Where[], update: Record<string, unknown> }): Promise<number>
  deleteMany(data: { model: string, where: Where[] }): Promise<number>
}

/** 行内值是否可作等值守卫（标量或 null）。 / Whether a row value can serve as an equality guard (scalar or null). */
function isGuardable(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** 快照守卫：行主键 + 原条件（无 OR 时）+ 全行等值，作为删除/更新的 AND 条件。 / Snapshot guard: row id + original clauses (when OR-free) + every field equality, joined by AND. */
export function snapshotGuard(row: Record<string, unknown>, where: readonly Where[]): Where[] {
  const cleaned = normalizeWhere(where)
  const id = String(row.id)
  const idClause: Where = { field: 'id', value: id, operator: 'eq', connector: 'AND' }
  const hasOr = hasOrClause(cleaned)
  const guard: Where[] = hasOr ? [idClause] : [...cleaned.map((c) => ({ ...c, connector: 'AND' as const })), idClause]
  for (const [field, value] of Object.entries(row)) {
    if (field === 'id' || !isGuardable(value)) continue
    guard.push({ field, value, operator: 'eq', connector: 'AND' })
  }
  return guard
}

/** 受影响行数必须恰为 0 或 1，否则适配器语义不成立——抛错不静默。 / Affected rows must be exactly 0 or 1; anything else breaks the adapter contract — throw. */
function changedOne(adapterId: string, action: string, count: number): boolean {
  if (count !== 0 && count !== 1) {
    throw new Error(
      `auth-core: adapter "${adapterId}" must return an affected row count of 0 or 1 from ${action}, got ${String(count)}`,
    )
  }
  return count === 1
}

/** 原子消费单行：并发下只有一方拿到行，其余拿到 null（决策 2）。 / Atomically consume one row; concurrency yields exactly one winner (decision 2). */
export async function atomicConsumeOne<T>(facade: AtomicFacade, data: {
  model: string
  where: Where[]
}): Promise<T | null> {
  const row = await facade.findOne<Record<string, unknown>>({ model: data.model, where: data.where })
  if (row === null) return null
  const guard = snapshotGuard(row, data.where)
  const count = await facade.deleteMany({ model: data.model, where: guard })
  return changedOne('orm', 'consumeOne', count) ? row as T : null
}

/** 校验增量面：增量与赋值不可同时为空，增量必须是有限数。 / Validate the mutation face: increment/set non-empty jointly, increments finite. */
function validateMutation(increment: Record<string, number>, set: Record<string, unknown> | undefined): void {
  if (Object.keys(increment).length === 0 && Object.keys(set ?? {}).length === 0) {
    throw new Error('auth-core: incrementOne requires a non-empty `increment` or `set`; both were empty')
  }
  for (const delta of Object.values(increment)) {
    if (!Number.isFinite(delta)) {
      throw new Error('auth-core: incrementOne requires finite increments')
    }
  }
}

/** 由当前行计算下一状态；计数必须是有限数值或 null。 / Compute the next state from the row; counters must be finite numbers or null. */
function computeNext(row: Record<string, unknown>, increment: Record<string, number>, set: Record<string, unknown>): Record<string, unknown> {
  const update: Record<string, unknown> = { ...set }
  for (const [field, delta] of Object.entries(increment)) {
    const previous = row[field]
    const base = previous === null || previous === undefined ? 0 : previous
    if (typeof base !== 'number' || !Number.isFinite(base)) {
      throw new Error(`auth-core: counter field "${field}" must hold a finite number or null, got ${String(previous)}`)
    }
    const next = base + delta
    if (!Number.isFinite(next)) {
      throw new Error(`auth-core: adapter cannot represent the requested increment on "${field}" safely`)
    }
    update[field] = next
  }
  return update
}

/** 原子带守卫增量：守卫未命中返回 null，CAS 竞争耗尽抛错（决策 3）。 / Guarded atomic increment: null on guard miss, throws when CAS contention exhausts (decision 3). */
export async function atomicIncrementOne<T>(facade: AtomicFacade, data: {
  model: string
  where: Where[]
  increment: Record<string, number>
  set?: Record<string, unknown>
}): Promise<T | null> {
  validateMutation(data.increment, data.set)
  const set = data.set ?? {}
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await facade.findOne<Record<string, unknown>>({ model: data.model, where: data.where })
    if (row === null) return null
    const update = computeNext(row, data.increment, set)
    const guard = snapshotGuard(row, data.where)
    const count = await facade.updateMany({ model: data.model, where: guard, update })
    if (changedOne('orm', 'incrementOne', count)) return { ...row, ...update } as T
  }
  throw new Error('auth-core: could not complete an atomic increment due to contention; retry or implement the adapter natively')
}
