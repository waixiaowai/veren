/**
 * Durable IM tables: the storage seams the router and the people directory
 * program against, plus the unchanged re-export surface of the row shapes, the
 * `im` domain (`store-rows.ts`), and the `ImStorage` implementation
 * (`store-storage.ts`).
 *
 * The active-pointer invariant is enforced by the router inside one serialized
 * write, because the KV domain has no partial unique index.
 *
 * 持久化的 IM 表：路由与人员目录面向编程的存储接缝，外加行形状、`im` 域（`store-rows.ts`）
 * 与 `ImStorage` 实现（`store-storage.ts`）的原样再导出面。
 *
 * active 指针不变量由路由层在同一个串行写事务里维护，因为 KV 域没有部分唯一索引。
 *
 * @module @veren/im/store
 */

import type { ImBinding } from './contract.ts'
import type {
  ImAccountRow, ImConversationRow, ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow,
} from './store-rows.ts'

// ---- unchanged export surface (rows/domain moved to store-rows.ts) ----
// ---- 导出面不变（行形状与域移至 store-rows.ts）----
export {
  IM_DOMAIN_NAME, conversationKey, imDomain, parseSettings, personAddressKey,
} from './store-rows.ts'
export type {
  ImAccountRow,
  ImBindingRow,
  ImConversationRow,
  ImIntakeStatus,
  ImPersonAddressRow,
  ImPersonIntakeRow,
  ImPersonRow,
  ImStore,
} from './store-rows.ts'
export { ImStorage } from './store-storage.ts'

/**
 * Storage seam for the people directory. Kept separate from
 * {@link ImBindingStore} so binding tests do not implement people persistence.
 * 人员目录的存储缝隙。与 {@link ImBindingStore} 分开，绑定测试无需实现人员持久化。
 */
export interface ImPersonStore {
  getPerson(id: string): ImPersonRow | undefined
  people(): ImPersonRow[]
  putPerson(row: ImPersonRow): Promise<void>
  /** One address, looked up by the provider's own user id. */
  getPersonAddress(provider: string, accountId: string, externalId: string): ImPersonAddressRow | undefined
  personAddresses(): ImPersonAddressRow[]
  putPersonAddress(row: ImPersonAddressRow): Promise<void>
  /** Drop every address of one removed account; person profiles and intakes stay. */
  deletePersonAddressesOf(accountId: string): Promise<void>
  /** One person's automatic-intake record, when they were asked. */
  getIntake(personId: string): ImPersonIntakeRow | undefined
  /** Every automatic-intake record, for the audit view. */
  intakes(): ImPersonIntakeRow[]
  putIntake(row: ImPersonIntakeRow): Promise<void>
}

/** Storage seam the router needs; tests provide an in-memory implementation. */
export interface ImBindingStore {
  getAccount(id: string): ImAccountRow | undefined
  accounts(): ImAccountRow[]
  putAccount(row: ImAccountRow): Promise<void>
  deleteAccount(id: string): Promise<void>
  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined
  conversations(): ImConversationRow[]
  putConversation(row: ImConversationRow): Promise<void>
  deleteConversation(accountId: string, conversationId: string): Promise<void>
  deleteConversationsOf(accountId: string): Promise<void>
  getBinding(id: string): ImBinding | undefined
  bindings(): ImBinding[]
  putBinding(binding: ImBinding): Promise<void>
  deleteBinding(id: string): Promise<void>
  deleteBindingsOf(accountId: string): Promise<void>
  activeBinding(accountId: string, conversationId: string): ImBinding | undefined
}
