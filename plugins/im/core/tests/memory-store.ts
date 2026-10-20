import type { ImBinding } from '../src/contract.ts'
import type {
  ImAccountRow,
  ImBindingStore,
  ImConversationRow,
  ImPersonAddressRow,
  ImPersonRow,
  ImPersonStore,
} from '../src/store.ts'
import { conversationKey, personAddressKey } from '../src/store.ts'

/** In-memory store used by router and people specs. */
export class MemoryStore implements ImBindingStore, ImPersonStore {
  readonly accountRows = new Map<string, ImAccountRow>()
  readonly conversationRows = new Map<string, ImConversationRow>()
  readonly bindingRows = new Map<string, ImBinding>()
  readonly personRows = new Map<string, ImPersonRow>()
  readonly addressRows = new Map<string, ImPersonAddressRow>()

  getAccount(id: string): ImAccountRow | undefined {
    return this.accountRows.get(id)
  }

  accounts(): ImAccountRow[] {
    return [...this.accountRows.values()]
  }

  async putAccount(row: ImAccountRow): Promise<void> {
    this.accountRows.set(row.id, row)
  }

  async deleteAccount(id: string): Promise<void> {
    this.accountRows.delete(id)
  }

  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined {
    return this.conversationRows.get(conversationKey(accountId, conversationId))
  }

  conversations(): ImConversationRow[] {
    return [...this.conversationRows.values()]
  }

  async putConversation(row: ImConversationRow): Promise<void> {
    this.conversationRows.set(conversationKey(row.account_id, row.conversation_id), row)
  }

  async deleteConversation(accountId: string, conversationId: string): Promise<void> {
    this.conversationRows.delete(conversationKey(accountId, conversationId))
  }

  async deleteConversationsOf(accountId: string): Promise<void> {
    for (const [key, row] of [...this.conversationRows]) {
      if (row.account_id === accountId) this.conversationRows.delete(key)
    }
  }

  getBinding(id: string): ImBinding | undefined {
    return this.bindingRows.get(id)
  }

  bindings(): ImBinding[] {
    return [...this.bindingRows.values()]
  }

  async putBinding(binding: ImBinding): Promise<void> {
    this.bindingRows.set(binding.id, binding)
  }

  async deleteBinding(id: string): Promise<void> {
    this.bindingRows.delete(id)
  }

  async deleteBindingsOf(accountId: string): Promise<void> {
    for (const [id, binding] of [...this.bindingRows]) {
      if (binding.accountId === accountId) this.bindingRows.delete(id)
    }
  }

  activeBinding(accountId: string, conversationId: string): ImBinding | undefined {
    return this.bindings().find(item => item.accountId === accountId
      && item.conversationId === conversationId
      && item.active)
  }

  getPerson(id: string): ImPersonRow | undefined {
    return this.personRows.get(id)
  }

  people(): ImPersonRow[] {
    return [...this.personRows.values()]
  }

  async putPerson(row: ImPersonRow): Promise<void> {
    this.personRows.set(row.id, row)
  }

  getPersonAddress(provider: string, accountId: string, externalId: string): ImPersonAddressRow | undefined {
    return this.addressRows.get(personAddressKey(provider, accountId, externalId))
  }

  personAddresses(): ImPersonAddressRow[] {
    return [...this.addressRows.values()]
  }

  async putPersonAddress(row: ImPersonAddressRow): Promise<void> {
    this.addressRows.set(personAddressKey(row.provider, row.account_id, row.external_id), row)
  }

  async deletePersonAddressesOf(accountId: string): Promise<void> {
    for (const [key, row] of [...this.addressRows]) {
      if (row.account_id === accountId) this.addressRows.delete(key)
    }
  }
}
