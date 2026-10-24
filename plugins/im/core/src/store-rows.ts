/**
 * Durable IM tables: row shapes, their zod schemas, and the authoritative `im`
 * storage domain, plus the row-key and settings-mapping helpers.
 *
 * The store deliberately persists no online status and no creation time. Online
 * status is a live provider fact; creation time is not part of the V1 contract.
 *
 * 持久化的 IM 表：行形状、对应的 zod schema 与权威 `im` 存储域，外加行键与 settings 映射助手。
 *
 * 存储刻意不持久化在线状态与创建时间：在线状态是 provider 的现场事实，创建时间不属于 V1 契约。
 *
 * @module @veren/im/store-rows
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { ImBinding, ImBindingSettings, ImConversation, ImPersonClaim, ImPersonContact } from './contract.ts'

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
export function toBinding(row: ImBindingRow): ImBinding {
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
export function toRow(binding: ImBinding): ImBindingRow {
  return {
    id: binding.id,
    account_id: binding.accountId,
    conversation_id: binding.conversationId,
    session_id: binding.sessionId,
    active: binding.active,
    settings_json: JSON.stringify(binding.settings),
  }
}
