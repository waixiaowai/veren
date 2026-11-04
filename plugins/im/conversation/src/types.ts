/**
 * The conversation domain's public types: rooms, members, messages, and read
 * cursors — the "what happened" facts every other stage reads (design §2).
 *
 * Field names follow the design's data dictionary; only the v1 subset is
 * implemented (kinds `text`/`system`; room kinds `direct`/`group`), and the
 * deferred extensions (`whisper`/`email` rooms, `attachment`/`poll`/… message
 * kinds, quoted messages) are deliberate non-goals of this cut.
 *
 * 会话域的公开类型：房间、成员、消息与已读游标——所有后续阶段都要读的「发生了什么」事实
 * （设计 §2）。
 *
 * 字段名遵循设计的数据字典；本剪裁只实现 v1 子集（消息类型 `text`/`system`；房间类型
 * `direct`/`group`），推迟的扩展（`whisper`/`email` 房间、`attachment`/`poll`/… 消息类型、
 * 引用消息）是本剪裁的明确非目标。
 *
 * @module @veren/im-conversation/types
 */

/** The v1 room kinds. `whisper` and `email` are deferred by this cut. */
/** v1 的房间类型。`whisper` 与 `email` 由本剪裁推迟。 */
export type RoomKind = 'direct' | 'group'

/** The v1 message kinds. Tool-call transcripts, attachments, and polls are deferred. */
/** v1 的消息类型。工具调用记录、附件与投票由本剪裁推迟。 */
export type MessageKind = 'text' | 'system'

/** One room: the durable unit of "a conversation happened here". */
/** 一个房间：「这里发生过一场对话」的持久单位。 */
export interface Room {
  readonly id: string
  readonly kind: RoomKind
  /** Human-readable title; channel rooms default to the provider conversation title. */
  /** 人类可读标题；渠道房间缺省取 provider 会话标题。 */
  title?: string
  /**
   * Ordered member-id projection for listings. The membership table is the
   * truth; this array is a cache the service keeps in step.
   * 列表用的有序成员投影。成员关系表才是真值；这个数组只是服务随手维护的缓存。
   */
  readonly members: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** One room membership row: the permission truth (design: 投影不是权限依据). */
/** 一行房间成员关系：权限真值（设计：投影不是权限依据）。 */
export interface RoomMember {
  readonly roomId: string
  readonly participantId: string
  /** Stable roster order, assigned on first join. */
  /** 首次加入时分配的稳定名册序号。 */
  readonly ordinal: number
  readonly joinedAt: number
}

/** One posted message: the durable fact with its room-exclusive sequence. */
/** 一条已写入的消息：带房间独占序号的持久事实。 */
export interface Message {
  readonly id: string
  readonly roomId: string
  readonly authorId: string
  readonly kind: MessageKind
  readonly body: string
  /** Strictly increasing inside the room; assigned by the room counter only. */
  /** 房间内严格递增；只由房间计数器分配。 */
  readonly sequence: number
  /** Idempotency key (room+author scoped), when the submitter supplied one. */
  /** 幂等键（房间+作者范围内），提交方提供时才有。 */
  readonly clientId?: string
  readonly createdAt: number
}

/** One monotonic read cursor. */
/** 一条只进不退的已读游标。 */
export interface ReadCursor {
  readonly roomId: string
  readonly participantId: string
  readonly lastReadSequence: number
  readonly updatedAt: number
}

/** One post request. */
/** 一次写入请求。 */
export interface PostInput {
  readonly roomId: string
  readonly actorId: string
  readonly kind: MessageKind
  /** Body is capped at the design's 80k characters. */
  /** 正文上限为设计的 8 万字符。 */
  readonly body: string
  /** Idempotency key; same key same body replays, same key new body conflicts. */
  /** 幂等键；同键同正文回放，同键新正文冲突。 */
  readonly clientId?: string
}

/** One post result; `replayed` marks an idempotent hit, not a new write. */
/** 一次写入结果；`replayed` 表示幂等命中，不是新写入。 */
export interface PostResult {
  readonly message: Message
  readonly replayed: boolean
}

/**
 * One write gate: runs inside the room's write chain after the replay check
 * and before the sequence is allocated. Throwing rejects the write entirely.
 * This is how coordination's freshness and verbatim gates become atomic with
 * the write (design §4.2: the gate compares inside the write transaction).
 * 一道写入闸门：在房间写链内、回放检查之后、序号分配之前运行。抛出即整体拒绝写入。
 * 协调的新鲜度与逐字闸门借此与写入达成原子（设计 §4.2：闸门在写入事务内比对）。
 */
export type PostGate = (room: Room, lastPeer: Message | undefined) => Promise<void> | void

/** Options for one incremental fetch. */
/** 一次增量拉取的选项。 */
export interface ListInput {
  readonly roomId: string
  /** Exclusive lower bound: messages with `sequence` strictly greater. */
  /** 排他下界：只取 `sequence` 严格大于它的消息。 */
  readonly sinceSequence?: number
  readonly limit?: number
}
