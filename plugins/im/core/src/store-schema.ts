/**
 * The authoritative `im` storage domain: one zod schema per durable table, the
 * domain definition, and the one-opened-domain type.
 *
 * 权威的 `im` 存储域：每张持久化表一个 zod schema、域定义，以及已打开域的类型。
 *
 * @module @veren/im/store-schema
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  ImAccountRow, ImBindingRow, ImConversationRow, ImConversationSessionRow, ImMessageRow,
  ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow,
} from './store-rows.ts'

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
  // 休眠表：绑定机制已删除（2.1.8），定义保留只为打开含此表的旧存储文件不报错；
  // 没有任何代码路径再读写它。
  // Dormant table: the binding mechanism is gone (2.1.8); the definition stays
  // only so older storage files that carry the table still open. No code path
  // reads or writes it anymore.
  id: z.string().min(1),
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  session_id: z.string().min(1),
  active: z.boolean(),
  settings_json: z.string(),
})

const messageSchema = z.object({
  message_id: z.string().min(1),
  provider: z.string().min(1),
  account_id: z.string().min(1),
  conversation_id: z.string().min(1),
  sender: z.string(),
  text: z.string(),
  received_at: z.number(),
  status: z.enum(['queued', 'consuming', 'replied', 'failed', 'dead']),
  attempts: z.number(),
  updated_at: z.number(),
  reply_excerpt: z.string().optional(),
})

const conversationSessionSchema = z.object({
  conversation_id: z.string().min(1),
  session_id: z.string().min(1),
  updated_at: z.number(),
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
    messages: domainTable<string, ImMessageRow>(messageSchema),
    conversation_sessions: domainTable<string, ImConversationSessionRow>(conversationSessionSchema),
    people: domainTable<string, ImPersonRow>(personSchema),
    person_addresses: domainTable<string, ImPersonAddressRow>(personAddressSchema),
    person_intakes: domainTable<string, ImPersonIntakeRow>(intakeSchema),
  },
})

/** Domain name, shared with diagnostics. */
/** 域名，与诊断共享。 */
export const IM_DOMAIN_NAME = imDomain.name

/** One opened IM domain. */
/** 一个已打开的 IM 域。 */
export type ImStore = Domain<typeof imDomain>
