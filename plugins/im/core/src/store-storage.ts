/**
 * The durable store implementation over the `im` storage domain: opening and
 * closing the domain handle, and typed accessors for every table.
 *
 * Split out of `store.ts` so the storage seams and key helpers stay under the
 * file-size ceiling; the export surface is unchanged — `store.ts` re-exports
 * `ImStorage` from here.
 *
 * `im` 存储域之上的持久化存储实现：域句柄的打开与关闭，以及每张表的类型化访问器。
 *
 * 按职责从 `store.ts` 拆出，让存储接缝与键助手保持在单文件行数上限内；导出面不变——
 * `store.ts` 从这里原样再导出 `ImStorage`。
 *
 * @module @veren/im/store-storage
 */

import type { Context } from '@deepseek-ai/cordis'
import { ImError } from './contract.ts'
import { IM_DOMAIN_NAME, conversationKey, imDomain, personAddressKey, toBinding, toRow } from './store-rows.ts'
import type {
  ImAccountRow, ImConversationRow, ImPersonAddressRow, ImPersonIntakeRow,
  ImPersonRow, ImStore,
} from './store-rows.ts'
import type { ImBinding } from './contract.ts'

/** Durable store over the `im` storage domain. */
export class ImStorage {
  private domain: ImStore | undefined

  /**
   * Open the domain, closing a handle left by a previous activation first.
   * @param ctx - context carrying `storageDomain`.
   */
  async open(ctx: Context): Promise<void> {
    const stale = ctx.storageDomain.get(IM_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        ctx.logger.warn('im: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        ctx.logger.warn(`im: the previous storage domain could not close: ${String(error)}`)
      }
    }
    this.domain = await ctx.storageDomain.open(imDomain)
  }

  /** Close the domain; safe to call twice. */
  async close(): Promise<void> {
    const domain = this.domain
    this.domain = undefined
    await domain?.close()
  }

  getAccount(id: string): ImAccountRow | undefined {
    return this.table('accounts').get(id)
  }

  accounts(): ImAccountRow[] {
    return [...this.table('accounts').entries()].map(([, row]) => row)
  }

  async putAccount(row: ImAccountRow): Promise<void> {
    await this.table('accounts').put(row.id, row)
  }

  async deleteAccount(id: string): Promise<void> {
    await this.table('accounts').delete(id)
  }

  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined {
    return this.table('conversations').get(conversationKey(accountId, conversationId))
  }

  conversations(): ImConversationRow[] {
    return [...this.table('conversations').entries()].map(([, row]) => row)
  }

  async putConversation(row: ImConversationRow): Promise<void> {
    await this.table('conversations').put(conversationKey(row.account_id, row.conversation_id), row)
  }

  async deleteConversation(accountId: string, conversationId: string): Promise<void> {
    await this.table('conversations').delete(conversationKey(accountId, conversationId))
  }

  async deleteConversationsOf(accountId: string): Promise<void> {
    const table = this.table('conversations')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  getPerson(id: string): ImPersonRow | undefined {
    return this.table('people').get(id)
  }

  people(): ImPersonRow[] {
    return [...this.table('people').entries()].map(([, row]) => row)
  }

  async putPerson(row: ImPersonRow): Promise<void> {
    await this.table('people').put(row.id, row)
  }

  getPersonAddress(provider: string, accountId: string, externalId: string): ImPersonAddressRow | undefined {
    return this.table('person_addresses').get(personAddressKey(provider, accountId, externalId))
  }

  personAddresses(): ImPersonAddressRow[] {
    return [...this.table('person_addresses').entries()].map(([, row]) => row)
  }

  async putPersonAddress(row: ImPersonAddressRow): Promise<void> {
    await this.table('person_addresses').put(
      personAddressKey(row.provider, row.account_id, row.external_id),
      row,
    )
  }

  async deletePersonAddressesOf(accountId: string): Promise<void> {
    const table = this.table('person_addresses')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  getIntake(personId: string): ImPersonIntakeRow | undefined {
    return this.table('person_intakes').get(personId)
  }

  intakes(): ImPersonIntakeRow[] {
    return [...this.table('person_intakes').entries()].map(([, row]) => row)
  }

  async putIntake(row: ImPersonIntakeRow): Promise<void> {
    await this.table('person_intakes').put(row.person_id, row)
  }

  getBinding(id: string): ImBinding | undefined {
    const row = this.table('bindings').get(id)
    return row === undefined ? undefined : toBinding(row)
  }

  bindings(): ImBinding[] {
    return [...this.table('bindings').entries()].map(([, row]) => toBinding(row))
  }

  async putBinding(binding: ImBinding): Promise<void> {
    await this.table('bindings').put(binding.id, toRow(binding))
  }

  async deleteBinding(id: string): Promise<void> {
    await this.table('bindings').delete(id)
  }

  async deleteBindingsOf(accountId: string): Promise<void> {
    const table = this.table('bindings')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  activeBinding(accountId: string, conversationId: string): ImBinding | undefined {
    return this.bindings().find(
      binding => binding.accountId === accountId
        && binding.conversationId === conversationId
        && binding.active,
    )
  }

  activeBindingOfConversation(conversationId: string): ImBinding | undefined {
    return this.bindings().find(binding => binding.conversationId === conversationId && binding.active)
  }

  /** Resolve the open domain or fail loudly. */
  private table<K extends 'accounts' | 'conversations' | 'bindings' | 'people' | 'person_addresses' | 'person_intakes'>(name: K) {
    const domain = this.domain
    if (domain === undefined) {
      throw new ImError('IM_INTERNAL', 'IM storage is not open')
    }
    return domain.table(name)
  }
}
