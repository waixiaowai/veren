/**
 * Durable IM tables: accounts, conversations, bindings, people, person
 * addresses, and stranger-intake records.
 *
 * The store deliberately persists no online status and no creation time. Online
 * status is a live provider fact; creation time is not part of the V1 contract.
 * The active-pointer invariant is enforced by the router inside one serialized
 * write, because the KV domain has no partial unique index.
 *
 * 持久化的 IM 表：账号、会话、绑定、人员与人员地址。
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
import type {
  ImBinding,
  ImBindingSettings,
  ImConversation,
  ImPersonClaim,
  ImPersonContact,
} from './contract.ts'

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

/**
 * One `im_people` row: a human the directory knows, independent of any one
 * provider. Names and contacts are identity data; reachability lives in
 * `im_person_addresses`.
 * 一行 `im_people`：目录认识的人，独立于单一 provider。姓名与联系方式属于身份数据；
 * 可达性放在 `im_person_addresses`。
 */
export interface ImPersonRow {
  id: string
  display_name: string
  real_name?: string
  aliases: string[]
  contacts: ImPersonContact[]
  bio?: string
  notes?: string
  /** Unverified self-report; authoritative name fields stay separate. */
  claim?: ImPersonClaim
  updated_at: number
}

/**
 * One `im_person_addresses` row: a provider-scoped address that can receive a
 * message for one person. `external_id` is the provider's own user id; the
 * conversation id is kept because sending ultimately targets a conversation.
 * 一行 `im_person_addresses`：某人在某个 provider 上可收消息的地址。`external_id` 是
 * provider 自己的用户 id；保留 conversation id，因为发送最终以会话为目标。
 */
export interface ImPersonAddressRow {
  person_id: string
  provider: string
  account_id: string
  conversation_id: string
  external_id: string
  display_name?: string
  updated_at: number
}

/** Lifecycle of one automatic self-introduction request. */
export type ImIntakeStatus = 'asked' | 'answered' | 'declined' | 'expired'

/**
 * One `im_person_intakes` row: the audit trail and the once-per-person gate for
 * the automatic stranger-intake question. The row records exactly what was
 * sent, to which address, when, and what the reply produced (or why it was
 * abandoned).
 * 一行 `im_person_intakes`：自动陌生人询问的审计记录与「每人一次」闸门。记录实际发了什么、
 * 发给哪个地址、何时发的，以及回复产出了什么（或为何放弃）。
 */
export interface ImPersonIntakeRow {
  person_id: string
  provider: string
  account_id: string
  conversation_id: string
  status: ImIntakeStatus
  asked_at: number
  ask_message_id: string
  ask_text: string
  /** When the intake reached a terminal state; absent while `asked`. */
  settled_at?: number
  /** What a successful self-report contained. */
  outcome?: 'name' | 'contact' | 'both'
  reply_message_id?: string
  /** One-line excerpt of the reply, kept for audit only. */
  reply_excerpt?: string
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

const contactSchema = z.object({
  kind: z.enum(['wechat', 'email', 'phone', 'other']),
  value: z.string().min(1),
  label: z.string().optional(),
})

const claimSchema = z.object({
  name: z.string().min(1).optional(),
  contacts: z.array(contactSchema),
  source: z.literal('self-report'),
  provider: z.string().min(1),
  accountId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  at: z.number(),
})

const personSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1),
  real_name: z.string().optional(),
  aliases: z.array(z.string()),
  contacts: z.array(contactSchema),
  bio: z.string().optional(),
  notes: z.string().optional(),
  claim: claimSchema.optional(),
  updated_at: z.number(),
})

const personAddressSchema = z.object({
  person_id: z.string().min(1),
  provider: z.string().min(1),
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  external_id: z.string().min(1),
  display_name: z.string().optional(),
  updated_at: z.number(),
})

const intakeSchema = z.object({
  person_id: z.string().min(1),
  provider: z.string().min(1),
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  status: z.enum(['asked', 'answered', 'declined', 'expired']),
  asked_at: z.number(),
  ask_message_id: z.string().min(1),
  ask_text: z.string().min(1),
  settled_at: z.number().optional(),
  outcome: z.enum(['name', 'contact', 'both']).optional(),
  reply_message_id: z.string().min(1).optional(),
  reply_excerpt: z.string().min(1).optional(),
})

/**
 * Authoritative IM storage domain.
 *
 * Version stays 1: every added person field is optional and a missing table
 * reads as empty, so a file written before the intake feature still opens
 * without discarding records. Bumping the version would reject that file
 * instead of migrating it.
 * 版本保持 1：新增的人员字段都是可选的，缺失的表读作空表，因此采集功能之前写下的文件仍能
 * 打开且不丢记录。提升版本会直接拒绝该文件，而不是迁移它。
 */
export const imDomain = defineDomain({
  name: 'im',
  version: 1,
  tables: {
    accounts: domainTable<string, ImAccountRow>(accountSchema),
    conversations: domainTable<string, ImConversationRow>(conversationSchema),
    bindings: domainTable<string, ImBindingRow>(bindingSchema),
    people: domainTable<string, ImPersonRow>(personSchema),
    person_addresses: domainTable<string, ImPersonAddressRow>(personAddressSchema),
    person_intakes: domainTable<string, ImPersonIntakeRow>(intakeSchema),
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

/** Stable key for one conversation row. */
export function conversationKey(accountId: string, conversationId: string): string {
  return `${accountId}\u0000${conversationId}`
}

/**
 * Stable key for one person address. A provider user id is unique per account,
 * so the same sender observed twice updates one row instead of cloning a person.
 * 人员地址的稳定键。provider 用户 id 在账号内唯一，因此同一个发送者被观察两次是更新一行，
 * 而不是克隆出第二个人。
 */
export function personAddressKey(provider: string, accountId: string, externalId: string): string {
  return `${provider}\u0000${accountId}\u0000${externalId}`
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

  /** Resolve the open domain or fail loudly. */
  private table<K extends 'accounts' | 'conversations' | 'bindings' | 'people' | 'person_addresses' | 'person_intakes'>(name: K) {
    const domain = this.domain
    if (domain === undefined) {
      throw new ImError('IM_INTERNAL', 'IM storage is not open')
    }
    return domain.table(name)
  }
}
