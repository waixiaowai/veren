import type { ImAccountRow, ImBinding, ImBindingStore, ImConversationRow } from '@veren/im'
import { conversationKey } from '@veren/im'

/** Minimal in-memory binding store for tool tests. */
export class TestStore implements ImBindingStore {
  readonly accountRows = new Map<string, ImAccountRow>()
  readonly conversationRows = new Map<string, ImConversationRow>()
  readonly bindingRows = new Map<string, ImBinding>()

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
}
