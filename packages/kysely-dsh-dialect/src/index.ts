/**
 * Public surface of the Kysely-over-DSH-domain dialect package.
 * "Kysely 跑在 DSH domain 上" dialect 包的公开面。
 * @module @veren/kysely-dsh-dialect
 */
import { createDomainKysely } from './dialect.js'
import type { DshDomainLike } from './types.js'

export { createDomainDialect, createDomainKysely, DialectError } from './dialect.js'
export { createDomainQueryCompiler } from './compiler.js'
export { executeInstruction, matchesPredicate } from './executor.js'
export type {
  CompareOp,
  CompareLeaf,
  DshDomainLike,
  Instruction,
  OrderItem,
  Predicate,
} from './types.js'

/**
 * Open a Kysely instance bound to one domain plus its declared tables. The
 * returned instance plugs straight into Better Auth's `kyselyAdapter(db, {
 * type: 'sqlite', transaction: false })` or any direct query building; the
 * caller keeps ownership of `domain.close()`.
 * 打开绑定一个 domain 及其已声明表的 Kysely 实例。返回实例可直接接入 Better
 * Auth 的 `kyselyAdapter(db, { type: 'sqlite', transaction: false })` 或任意直接
 * 查询；`domain.close()` 的所有权仍在调用方。
 */
export function openDomainKysely(domain: DshDomainLike, tables: readonly string[]): ReturnType<typeof createDomainKysely> {
  return createDomainKysely(domain, tables)
}
