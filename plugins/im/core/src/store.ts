/**
 * Durable IM tables: accounts, conversations, and bindings.
 *
 * The store deliberately persists no online status and no creation time. Online
 * status is a live provider fact; creation time is not part of the V1 contract.
 * The active-pointer invariant is enforced by the router inside one serialized
 * write, because the KV domain has no partial unique index.
 *
 * 持久化的 IM 表：账号、会话与绑定。
 *
 * 存储刻意不持久化在线状态与创建时间：在线状态是 provider 的现场事实，创建时间不属于 V1 契约。
 * active 指针不变量由路由层在同一个串行写事务里维护，因为 KV 域没有部分唯一索引。
 *
 * @module @veren/im/store
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ImError } from './contract.ts'
import type { ImBinding, ImBindingSettings, ImConversation } from './contract.ts'

/** One `im_accounts` row. `status` is intentionally absent. */
export interface ImAccountRow {
  id: string
  provider: string
  token_ref: string
  owner_id?: string
}

/** One `im_conversations` row. */
export interface ImConversationRow {
  account_id: string
  conversation_id: string
  kind: ImConversation['kind']
  title?: string
}

/** One `im_bindings` row. `settings_json` is the serialized settings object. */
export interface ImBindingRow {
  id: string
  account_id: string
  conversation_id: string
  session_id: string
  active: boolean
  settings_json: string
}

const accountSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  token_ref: z.string().min(1),
  owner_id: z.string().optional(),
})

const conversationSchema = z.object({
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  kind: z.enum(['direct', 'group', 'thread']),
  title: z.string().optional(),
})

const bindingSchema = z.object({
  id: z.string().min(1),
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  session_id: z.string().min(1),
  active: z.boolean(),
  settings_json: z.string(),
})

/** Authoritative IM storage domain. */
export const imDomain = defineDomain({
  name: 'im',
  version: 1,
  tables: {
    accounts: domainTable<string, ImAccountRow>(accountSchema),
    conversations: domainTable<string, ImConversationRow>(conversationSchema),
    bindings: domainTable<string, ImBindingRow>(bindingSchema),
  },
})

/** Domain name, shared with diagnostics. */
export const IM_DOMAIN_NAME = imDomain.name

/** One opened IM domain. */
export type ImStore = Domain<typeof imDomain>

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

/** Stable key for one conversation row. */
export function conversationKey(accountId: string, conversationId: string): string {
  return `${accountId}\u0000${conversationId}`
}

/**
 * Parse stored settings without letting a malformed row break the router.
 * @param json - serialized settings.
 * @returns the settings object, or an empty object.
 */
export function parseSettings(json: string): ImBindingSettings {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const record = value as Record<string, unknown>
    const settings: ImBindingSettings = {}
    for (const key of ['presetId', 'provider', 'model', 'reasoning'] as const) {
      const field = record[key]
      if (typeof field === 'string' && field.length > 0) settings[key] = field
    }
    return settings
  } catch {
    // A malformed settings row degrades to defaults instead of hiding the binding.
    return {}
  }
}

/** Project one storage row onto the public binding model. */
function toBinding(row: ImBindingRow): ImBinding {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    active: row.active,
    settings: parseSettings(row.settings_json),
  }
}

/** Serialize the public binding model into one storage row. */
function toRow(binding: ImBinding): ImBindingRow {
  return {
    id: binding.id,
    account_id: binding.accountId,
    conversation_id: binding.conversationId,
    session_id: binding.sessionId,
    active: binding.active,
    settings_json: JSON.stringify(binding.settings),
  }
}

/** Durable store over the `im` storage domain. */
export class ImStorage implements ImBindingStore {
  #domain: ImStore | undefined

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
    this.#domain = await ctx.storageDomain.open(imDomain)
  }

  /** Close the domain; safe to call twice. */
  async close(): Promise<void> {
    const domain = this.#domain
    this.#domain = undefined
    await domain?.close()
  }

  getAccount(id: string): ImAccountRow | undefined {
    return this.#table('accounts').get(id)
  }

  accounts(): ImAccountRow[] {
    return [...this.#table('accounts').entries()].map(([, row]) => row)
  }

  async putAccount(row: ImAccountRow): Promise<void> {
    await this.#table('accounts').put(row.id, row)
  }

  async deleteAccount(id: string): Promise<void> {
    await this.#table('accounts').delete(id)
  }

  getConversation(accountId: string, conversationId: string): ImConversationRow | undefined {
    return this.#table('conversations').get(conversationKey(accountId, conversationId))
  }

  conversations(): ImConversationRow[] {
    return [...this.#table('conversations').entries()].map(([, row]) => row)
  }

  async putConversation(row: ImConversationRow): Promise<void> {
    await this.#table('conversations').put(conversationKey(row.account_id, row.conversation_id), row)
  }

  async deleteConversation(accountId: string, conversationId: string): Promise<void> {
    await this.#table('conversations').delete(conversationKey(accountId, conversationId))
  }

  async deleteConversationsOf(accountId: string): Promise<void> {
    const table = this.#table('conversations')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  getBinding(id: string): ImBinding | undefined {
    const row = this.#table('bindings').get(id)
    return row === undefined ? undefined : toBinding(row)
  }

  bindings(): ImBinding[] {
    return [...this.#table('bindings').entries()].map(([, row]) => toBinding(row))
  }

  async putBinding(binding: ImBinding): Promise<void> {
    await this.#table('bindings').put(binding.id, toRow(binding))
  }

  async deleteBinding(id: string): Promise<void> {
    await this.#table('bindings').delete(id)
  }

  async deleteBindingsOf(accountId: string): Promise<void> {
    const table = this.#table('bindings')
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

  /** Resolve the open domain or fail loudly. */
  #table<K extends 'accounts' | 'conversations' | 'bindings'>(name: K) {
    const domain = this.#domain
    if (domain === undefined) {
      throw new ImError('IM_INTERNAL', 'IM storage is not open')
    }
    return domain.table(name)
  }
}
