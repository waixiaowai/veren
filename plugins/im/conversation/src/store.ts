/**
 * The durable store over the `im_conversation` domain: the raw-table seam,
 * the production assembly from an opened domain, and the in-process per-room
 * write chains that serialize sequence allocation.
 *
 * The single DSH host process is the only writer (the design's cross-replica
 * counter lock degenerates to an in-process mutex here); every mutation of one
 * room runs on that room's chain, so two concurrent posts queue instead of
 * racing the counter row.
 *
 * `im_conversation` 域之上的持久存储：裸表接缝、从已打开域组装的生产装配，以及把序号分配
 * 串行化的进程内按房间写链。
 *
 * 单个 DSH 宿主进程是唯一写者（设计的跨副本计数器锁在这里退化为进程内互斥）；一个房间的
 * 每次变更都在该房间的写链上跑，并发的两次写入因此排队，而不是竞争计数器行。
 *
 * @module @veren/im-conversation/store
 */

import type { Context } from '@deepseek-ai/cordis'
import { ImError } from '@veren/im'
import { CONVERSATION_DOMAIN_NAME, conversationDomain } from './schema.ts'
import type { ConversationStore } from './schema.ts'
import { clientIdKey, memberKey, readKey } from './rows.ts'
import type { ClientIdRow, CounterRow, MessageRow, ReadRow, RoomMemberRow, RoomRow } from './rows.ts'

/** One table handle: the subset of the domain-table face every accessor needs. */
/** 一个表句柄：每个访问器都需要的域表面的子集。 */
export interface ConvTable<V> {
  get(key: string): V | undefined
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  entries(): IterableIterator<[string, V]>
}

/** Every row of one table, order not specified. */
/** 一张表的全部行，顺序不作承诺。 */
function rowsOf<V>(table: ConvTable<V>): V[] {
  return [...table.entries()].map(([, row]) => row)
}

/** The raw-table seam the store programs against; tests substitute maps. */
/** 存储面向编程的裸表接缝；测试用内存 Map 替换。 */
export interface ConvTables {
  readonly rooms: ConvTable<RoomRow>
  readonly room_members: ConvTable<RoomMemberRow>
  readonly messages: ConvTable<MessageRow>
  readonly room_counters: ConvTable<CounterRow>
  readonly room_reads: ConvTable<ReadRow>
  readonly message_client_ids: ConvTable<ClientIdRow>
}

/** Assemble the raw-table seam from one opened conversation domain. */
/** 从一个已打开的会话域组装裸表接缝。 */
export function tablesOf(domain: ConversationStore): ConvTables {
  return {
    rooms: domain.table('rooms'),
    room_members: domain.table('room_members'),
    messages: domain.table('messages'),
    room_counters: domain.table('room_counters'),
    room_reads: domain.table('room_reads'),
    message_client_ids: domain.table('message_client_ids'),
  }
}

/** Durable store over the conversation domain. */
/** 会话域之上的持久存储。 */
export class ConvStorage {
  private tables: ConvTables | undefined
  private readonly roomChains = new Map<string, Promise<unknown>>()

  /**
   * Open the domain, closing a handle left by a previous activation first.
   * @param ctx - context carrying `storageDomain`.
   */
  async open(ctx: Context): Promise<void> {
    const stale = ctx.storageDomain.get(CONVERSATION_DOMAIN_NAME)
    if (stale !== undefined) {
      try {
        await stale.close()
        ctx.logger.warn('im-conversation: closed the storage domain left open by a previous activation')
      } catch (error: unknown) {
        ctx.logger.warn(`im-conversation: the previous storage domain could not close: ${String(error)}`)
      }
    }
    const domain = await ctx.storageDomain.open(conversationDomain)
    this.tables = tablesOf(domain)
  }

  /** Attach an already-assembled seam; tests use this instead of `open`. */
  /** 挂接一个已组装的接缝；测试用它替代 `open`。 */
  attach(tables: ConvTables): void {
    this.tables = tables
  }

  /** Close the domain; safe to call twice. */
  /** 关闭域；可安全重复调用。 */
  async close(): Promise<void> {
    this.tables = undefined
  }

  // ---- rooms ----
  // ---- 房间 ----

  getRoom(roomId: string): RoomRow | undefined {
    return this.table('rooms').get(roomId)
  }

  rooms(): RoomRow[] {
    return rowsOf(this.table('rooms'))
  }

  async putRoom(row: RoomRow): Promise<void> {
    await this.table('rooms').put(row.id, row)
  }

  // ---- members ----
  // ---- 成员 ----

  getMember(roomId: string, participantId: string): RoomMemberRow | undefined {
    return this.table('room_members').get(memberKey(roomId, participantId))
  }

  members(): RoomMemberRow[] {
    return rowsOf(this.table('room_members'))
  }

  membersOf(roomId: string): RoomMemberRow[] {
    return this.members().filter(row => row.room_id === roomId)
  }

  async putMember(row: RoomMemberRow): Promise<void> {
    await this.table('room_members').put(memberKey(row.room_id, row.participant_id), row)
  }

  // ---- messages ----
  // ---- 消息 ----

  getMessage(messageId: string): MessageRow | undefined {
    return this.table('messages').get(messageId)
  }

  messages(): MessageRow[] {
    return rowsOf(this.table('messages'))
  }

  messagesOf(roomId: string): MessageRow[] {
    return this.messages().filter(row => row.room_id === roomId)
  }

  async putMessage(row: MessageRow): Promise<void> {
    await this.table('messages').put(row.id, row)
  }

  // ---- counters ----
  // ---- 计数器 ----

  getCounter(roomId: string): CounterRow | undefined {
    return this.table('room_counters').get(roomId)
  }

  async putCounter(row: CounterRow): Promise<void> {
    await this.table('room_counters').put(row.room_id, row)
  }

  // ---- reads ----
  // ---- 已读 ----

  getRead(roomId: string, participantId: string): ReadRow | undefined {
    return this.table('room_reads').get(readKey(roomId, participantId))
  }

  reads(): ReadRow[] {
    return rowsOf(this.table('room_reads'))
  }

  async putRead(row: ReadRow): Promise<void> {
    await this.table('room_reads').put(readKey(row.room_id, row.participant_id), row)
  }

  // ---- idempotency index ----
  // ---- 幂等索引 ----

  getClientId(roomId: string, authorId: string, clientId: string): ClientIdRow | undefined {
    return this.table('message_client_ids').get(clientIdKey(roomId, authorId, clientId))
  }

  async putClientId(row: ClientIdRow): Promise<void> {
    await this.table('message_client_ids').put(
      clientIdKey(row.room_id, row.author_id, row.client_id),
      row,
    )
  }

  /**
   * Run one room's mutation on that room's write chain, so concurrent posts to
   * one room serialize instead of racing the counter row.
   * 把一个房间的变更放到该房间的写链上跑，同房间的并发写入因此串行，而不是竞争计数器行。
   */
  onRoomChain<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.roomChains.get(roomId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.roomChains.set(roomId, tail)
    return next.finally(() => {
      if (this.roomChains.get(roomId) === tail) this.roomChains.delete(roomId)
    })
  }

  /** Resolve the attached seam or fail loudly. */
  /** 解析已挂接的接缝，否则响亮失败。 */
  private table<K extends keyof ConvTables>(name: K): ConvTables[K] {
    const tables = this.tables
    if (tables === undefined) {
      throw new ImError('IM_INTERNAL', 'conversation storage is not open')
    }
    return tables[name]
  }
}
