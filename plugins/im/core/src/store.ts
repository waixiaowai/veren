/**
 * Durable IM tables: the storage seams the router and the people directory
 * program against, plus the unchanged re-export surface of the row shapes
 * (`store-rows.ts`), the `im` domain (`store-schema.ts`), and the `ImStorage`
 * implementation (`store-storage.ts`).
 *
 * 持久化的 IM 表：路由与人员目录面向编程的存储接缝，外加行形状（`store-rows.ts`）、
 * `im` 域（`store-schema.ts`）与 `ImStorage` 实现（`store-storage.ts`）的原样再导出面。
 *
 * @module @veren/im/store
 */

import type {
  ImAccountRow, ImConversationRow, ImConversationSessionRow, ImMessageRow, ImPersonAddressRow,
  ImPersonIntakeRow, ImPersonRow,
} from './store-rows.ts'

// ---- unchanged export surface (rows/keys live in store-rows.ts, the domain in
// store-schema.ts) ----
// ---- 导出面不变（行形状与键在 store-rows.ts，域在 store-schema.ts）----
export {
  conversationKey, messageKey, personAddressKey,
} from './store-rows.ts'
export {
  IM_DOMAIN_NAME, imDomain,
} from './store-schema.ts'
export type { ImStore } from './store-schema.ts'
export type {
  ImAccountRow,
  ImBindingRow,
  ImConversationRow,
  ImConversationSessionRow,
  ImIntakeStatus,
  ImMessageRow,
  ImMessageStatus,
  ImPersonAddressRow,
  ImPersonIntakeRow,
  ImPersonRow,
} from './store-rows.ts'
export { ImStorage } from './store-storage.ts'

/**
 * Storage seam for the people directory. Kept separate from
 * {@link ImCoreStore} so queue tests do not implement people persistence.
 * 人员目录的存储缝隙。与 {@link ImCoreStore} 分开，队列测试无需实现人员持久化。
 */
export interface ImPersonStore {
  getPerson(id: string): ImPersonRow | undefined
  people(): ImPersonRow[]
  putPerson(row: ImPersonRow): Promise<void>
  /** Drop one person's profile; their addresses and intake are callers' business. */
  deletePerson(id: string): Promise<void>
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
  /** Drop one person's automatic-intake record. */
  deleteIntake(personId: string): Promise<void>
}

/**
 * Storage seam for accounts, conversations, the inbound message queue, and the
 * private conversation → session map. Renamed from `ImBindingStore` when the
 * binding mechanism was deleted (2.1.8): the queue and the session map are the
 * residents now.
 * 账号、会话、入站消息队列与私有会话映射的存储接缝。绑定机制删除（2.1.8）时由
 * `ImBindingStore` 更名而来：如今的住户是队列与会话映射。
 */
export interface ImCoreStore {
  getAccount(id: string): ImAccountRow | undefined
  accounts(): ImAccountRow[]
  putAccount(row: ImAccountRow): Promise<void>
  deleteAccount(id: string): Promise<void>
  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined
  conversations(): ImConversationRow[]
  putConversation(row: ImConversationRow): Promise<void>
  deleteConversation(accountId: string, conversationId: string): Promise<void>
  deleteConversationsOf(accountId: string): Promise<void>
  /** One queued message by its provider-scoped id. */
  getMessage(provider: string, messageId: string): ImMessageRow | undefined
  messages(): ImMessageRow[]
  putMessage(row: ImMessageRow): Promise<void>
  /** The private conversation → session map, keyed by conversation id alone. */
  getConversationSession(conversationId: string): ImConversationSessionRow | undefined
  conversationSessions(): ImConversationSessionRow[]
  putConversationSession(row: ImConversationSessionRow): Promise<void>
}
