/**
 * Durable IM tables: the row shapes and the row-key helpers.
 *
 * The store deliberately persists no online status and no creation time. Online
 * status is a live provider fact; creation time is not part of the V1 contract.
 *
 * 持久化的 IM 表：行形状与行键助手。
 *
 * 存储刻意不持久化在线状态与创建时间：在线状态是 provider 的现场事实，创建时间不属于 V1 契约。
 *
 * The zod schemas and the authoritative `im` storage domain live in
 * `store-schema.ts`.
 * zod schema 与权威的 `im` 存储域在 `store-schema.ts`。
 *
 * @module @veren/im/store-rows
 */

import type { ImConversation, ImPersonClaim, ImPersonContact } from './contract.ts'

/** One `im_accounts` row. `status` is intentionally absent. */
/** 一行 `im_accounts`。刻意没有 `status`。 */
export interface ImAccountRow {
  id: string
  provider: string
  token_ref: string
  owner_id?: string
}

/** One `im_conversations` row. */
/** 一行 `im_conversations`。 */
export interface ImConversationRow {
  account_id: string
  conversation_id: string
  kind: ImConversation['kind']
  title?: string
}

/** One `im_bindings` row. `settings_json` is the serialized settings object. */
/** 一行 `im_bindings`。`settings_json` 是序列化的设置对象。 */
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
  /** 未核实的自述；权威姓名字段保持独立。 */
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
/** 一次自动自我介绍请求的生命周期。 */
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
  /** intake 到达终态的时刻；`asked` 期间缺省。 */
  settled_at?: number
  /** What a successful self-report contained. */
  /** 一次成功的自述包含了什么。 */
  outcome?: 'name' | 'contact' | 'both'
  reply_message_id?: string
  /** One-line excerpt of the reply, kept for audit only. */
  /** 回复的单行摘录，仅作审计留存。 */
  reply_excerpt?: string
}

/**
 * One `im_messages` row: the durable inbound queue. `message_id` is unique per
 * provider; the row is the idempotency key, the ordering record, and the audit
 * trail — every message reaches a terminal state (`replied` / `failed` /
 * `dead`) and none is ever silently dropped.
 * 一行 `im_messages`：持久化的入站队列。`message_id` 在 provider 内唯一；这一行既是幂等键，
 * 也是顺序记录与审计轨迹——每条消息都到达终态（`replied` / `failed` / `dead`），绝无静默丢弃。
 */
export interface ImMessageRow {
  message_id: string
  provider: string
  account_id: string
  conversation_id: string
  sender: string
  text: string
  received_at: number
  status: ImMessageStatus
  attempts: number
  updated_at: number
  /** One-line excerpt of the reply, kept for the audit view. */
  /** 回复的单行摘录，供审计视图留存。 */
  reply_excerpt?: string
}

/** Lifecycle of one queued inbound message. */
/** 一条排队入站消息的生命周期。 */
export type ImMessageStatus = 'queued' | 'consuming' | 'replied' | 'failed' | 'dead'

/**
 * One `im_conversation_sessions` row: the private conversation → session map.
 * Keyed by conversation id alone — the account drifts on a bot re-pairing while
 * the conversation id stays stable, so this map needs no migration.
 * 一行 `im_conversation_sessions`：私有的会话 → Session 映射。只按 conversation_id 键控——
 * bot 重配对时 account 漂移而会话 id 稳定，因此这张表无需迁移。
 */
export interface ImConversationSessionRow {
  conversation_id: string
  session_id: string
  updated_at: number
}

/** Stable key for one conversation row. */
/** 一行会话记录的稳定键。 */
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

/** Stable key for one queued message: provider-scoped message ids. */
/** 一条排队消息的稳定键：message_id 在 provider 内唯一。 */
export function messageKey(provider: string, messageId: string): string {
  return `${provider}\u0000${messageId}`
}
