/**
 * The authoritative `im_conversation` storage domain: one zod schema per
 * durable table, the domain definition, and the one-opened-domain type.
 *
 * Version stays 1 (same rule as the `im` domain): new tables read as empty in
 * files written before them, so a pre-conversation storage file still opens.
 * 权威的 `im_conversation` 存储域：每张持久表一个 zod schema、域定义，以及已打开域的类型。
 *
 * 版本保持 1（与 `im` 域同一规则）：更早写下的文件把新表读作空表，因此会话域之前的存储文件
 * 仍能打开。
 *
 * @module @veren/im-conversation/schema
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { CounterRow, ClientIdRow, MessageRow, ReadRow, RoomMemberRow, RoomRow } from './rows.ts'

const roomSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['direct', 'group']),
  title: z.string().optional(),
  members: z.array(z.string()),
  created_at: z.number(),
  updated_at: z.number(),
})

const roomMemberSchema = z.object({
  room_id: z.string().min(1),
  participant_id: z.string().min(1),
  ordinal: z.number(),
  joined_at: z.number(),
})

const messageSchema = z.object({
  id: z.string().min(1),
  room_id: z.string().min(1),
  author_id: z.string().min(1),
  kind: z.enum(['text', 'system']),
  body: z.string(),
  sequence: z.number(),
  client_id: z.string().optional(),
  created_at: z.number(),
})

const counterSchema = z.object({
  room_id: z.string().min(1),
  next_sequence: z.number(),
})

const readSchema = z.object({
  room_id: z.string().min(1),
  participant_id: z.string().min(1),
  last_read_sequence: z.number(),
  updated_at: z.number(),
})

const clientIdSchema = z.object({
  room_id: z.string().min(1),
  author_id: z.string().min(1),
  client_id: z.string().min(1),
  message_id: z.string().min(1),
  body: z.string(),
})

/** Authoritative conversation-domain definition. */
/** 权威的会话域定义。 */
export const conversationDomain = defineDomain({
  name: 'im_conversation',
  version: 1,
  tables: {
    rooms: domainTable<string, RoomRow>(roomSchema),
    room_members: domainTable<string, RoomMemberRow>(roomMemberSchema),
    messages: domainTable<string, MessageRow>(messageSchema),
    room_counters: domainTable<string, CounterRow>(counterSchema),
    room_reads: domainTable<string, ReadRow>(readSchema),
    message_client_ids: domainTable<string, ClientIdRow>(clientIdSchema),
  },
})

/** Domain name, shared with diagnostics. */
/** 域名，与诊断共享。 */
export const CONVERSATION_DOMAIN_NAME = conversationDomain.name

/** One opened conversation domain. */
/** 一个已打开的会话域。 */
export type ConversationStore = Domain<typeof conversationDomain>
