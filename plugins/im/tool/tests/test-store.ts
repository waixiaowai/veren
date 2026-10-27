import type {
  ImAccountRow,
  ImCoreStore,
  ImConversationRow,
  ImConversationSessionRow,
  ImMessageRow,
  ImPersonAddressRow,
  ImPersonIntakeRow,
  ImPersonRow,
  ImPersonStore,
} from '@veren/im'
import { conversationKey, messageKey, personAddressKey } from '@veren/im'

/** Minimal in-memory store for tool tests. */
export class TestStore implements ImCoreStore, ImPersonStore {
  readonly accountRows = new Map<string, ImAccountRow>()
  readonly conversationRows = new Map<string, ImConversationRow>()
  readonly messageRows = new Map<string, ImMessageRow>()
  readonly sessionRows = new Map<string, ImConversationSessionRow>()
  readonly personRows = new Map<string, ImPersonRow>()
  readonly addressRows = new Map<string, ImPersonAddressRow>()
  readonly intakeRows = new Map<string, ImPersonIntakeRow>()

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

  getPerson(id: string): ImPersonRow | undefined {
    return this.personRows.get(id)
  }

  people(): ImPersonRow[] {
    return [...this.personRows.values()]
  }

  async putPerson(row: ImPersonRow): Promise<void> {
    this.personRows.set(row.id, row)
  }

  async deletePerson(id: string): Promise<void> {
    this.personRows.delete(id)
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

  getIntake(personId: string): ImPersonIntakeRow | undefined {
    return this.intakeRows.get(personId)
  }

  intakes(): ImPersonIntakeRow[] {
    return [...this.intakeRows.values()]
  }

  async putIntake(row: ImPersonIntakeRow): Promise<void> {
    this.intakeRows.set(row.person_id, row)
  }

  async deleteIntake(personId: string): Promise<void> {
    this.intakeRows.delete(personId)
  }

  getMessage(provider: string, messageId: string): ImMessageRow | undefined {
    return this.messageRows.get(messageKey(provider, messageId))
  }

  messages(): ImMessageRow[] {
    return [...this.messageRows.values()]
  }

  async putMessage(row: ImMessageRow): Promise<void> {
    this.messageRows.set(messageKey(row.provider, row.message_id), row)
  }

  getConversationSession(conversationId: string): ImConversationSessionRow | undefined {
    return this.sessionRows.get(conversationId)
  }

  conversationSessions(): ImConversationSessionRow[] {
    return [...this.sessionRows.values()]
  }

  async putConversationSession(row: ImConversationSessionRow): Promise<void> {
    this.sessionRows.set(row.conversation_id, row)
  }
}
