/**
 * The post path: idempotency by client id, room-exclusive sequence allocation,
 * and the write-then-emit contract (persist first; delivery failures never
 * roll the fact back).
 *
 * Rules, straight from the design (§2.2/§2.5):
 * - same room + author + client id → replay the existing message
 *   (`replayed: true`), no second row;
 * - same key with a different body → `REQUEST_ID_CONFLICT`, never an overwrite;
 * - the sequence comes from the room counter alone; nobody else may assign it;
 * - membership is checked before any write, and non-members read as
   "not found".
 *
 * 写入路径：按 client id 幂等、房间独占的序号分配、先落库后发事件的契约（持久先行；投递
 * 失败绝不回滚事实）。
 *
 * 规则，直接来自设计（§2.2/§2.5）：
 * - 同房间+同作者+同 client id → 回放既有消息（`replayed: true`），不产生第二行；
 * - 同键不同正文 → `REQUEST_ID_CONFLICT`，绝不覆盖；
 * - 序号只来自房间计数器，其他任何人都不得指定；
 * - 写入之前先查成员资格，非成员按「不存在」理解。
 *
 * @module @veren/im-conversation/post
 */

import { randomUUID } from 'node:crypto'
import { ImError } from '@veren/im'
import type { ListInput, Message, PostGate, PostInput, PostResult, Room } from './types.ts'
import { messageOf, roomOf } from './rows.ts'
import type { MessageRow } from './rows.ts'
import type { ConvStorage } from './store.ts'
import { SYSTEM_AUTHOR, RoomService } from './rooms.ts'

/** The design's body cap (80k characters). */
/** 设计的正文上限（8 万字符）。 */
export const MAX_BODY_CHARS = 80_000
/** Default and maximum page sizes for incremental fetches. */
/** 增量拉取的默认与最大页大小。 */
export const DEFAULT_LIST_LIMIT = 80
export const MAX_LIST_LIMIT = 500

/** Options for the post service; clock and id minting are injectable for tests. */
/** 写入服务的选项；时钟与 id 铸造可注入，供测试使用。 */
export interface PostServiceOptions {
  readonly store: ConvStorage
  readonly rooms: RoomService
  readonly now?: () => number
  readonly newId?: () => string
  /**
   * Called after a fresh commit, never for a replay. The plugin wires this to
   * `ctx.emit('im/message-new')`, so every write path — channel ingest, the
   * model's `im_send`, and the web composer — feeds the same wake fan-out.
   * Throwing here never rolls the fact back: the row is already durable.
   * 新提交后调用，回放不调用。插件把它接到 `ctx.emit('im/message-new')`，因此每条写入
   * 路径——渠道吸收、模型的 `im_send`、Web 输入区——都汇入同一个唤醒扇出。这里抛错不会
   * 回滚事实：行已经持久。
   */
  readonly committed?: (payload: { readonly room: Room; readonly message: Message }) => void
}

/** The write half of the conversation service. */
/** 会话服务的写入半区。 */
export class PostService {
  private readonly now: () => number
  private readonly newId: () => string

  /**
   * @param options - store, room service, clock, and id minter.
   */
  constructor(private readonly options: PostServiceOptions) {
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => `msg-${randomUUID()}`)
  }

  /**
   * Post one message, with an optional write gate. Runs on the room's write
   * chain, so concurrent posters serialize on sequence allocation and the gate
   * sees the room's truth at write time.
   * 写入一条消息，可带一道写入闸门。在房间的写链上运行，并发写入者在序号分配上串行，闸门
   * 看到的是写入时刻的房间真相。
   */
  async post(input: PostInput, gate?: PostGate): Promise<PostResult> {
    if (input.body.length > MAX_BODY_CHARS) {
      throw new ImError('INVALID_ARGUMENT', 'the message body exceeds the limit')
    }
    this.options.rooms.requireMembership(input.roomId, input.actorId)
    return this.options.store.onRoomChain(input.roomId, () => this.postChained(input, gate))
  }

  /** The chain-serialized post body. */
  /** 写链内的写入主体。 */
  private async postChained(input: PostInput, gate: PostGate | undefined): Promise<PostResult> {
    const replayed = this.replayOf(input)
    if (replayed !== undefined) return replayed
    await this.runGate(input, gate)
    const sequence = await this.nextSequence(input.roomId)
    const row: MessageRow = {
      id: this.newId(),
      room_id: input.roomId,
      author_id: input.actorId,
      kind: input.kind,
      body: input.body,
      sequence,
      created_at: this.now(),
      ...(input.clientId === undefined ? {} : { client_id: input.clientId }),
    }
    await this.options.store.putMessage(row)
    await this.rememberClientId(input, row.id)
    const message = messageOf(row)
    this.announce(input.roomId, message)
    return { message, replayed: false }
  }

  /**
   * Hand one fresh commit to the family bus. Delivery is best effort: the row
   * is already durable, so a throwing listener must not fail the write.
   * 把一次新提交交给家族总线。投递尽力而为：行已持久，监听者抛错不得让写入失败。
   */
  private announce(roomId: string, message: Message): void {
    const room = this.options.rooms.room(roomId)
    if (room === undefined || this.options.committed === undefined) return
    try {
      this.options.committed({ room, message })
    } catch {
      // 通知失败不回滚事实：写链已提交，重连的客户端会按拉取对账。
      // A failed notification never rolls the fact back: the chain committed and
      // reconnecting clients reconcile by pulling.
    }
  }

  /**
   * The idempotent replay of an earlier identical submit, or a loud conflict
   * for the same key with different content; `undefined` when fresh.
   * 一次更早相同提交的幂等回放，或同键不同正文的响亮冲突；新提交时返回 `undefined`。
   */
  private replayOf(input: PostInput): PostResult | undefined {
    if (input.clientId === undefined) return undefined
    const hit = this.options.store.getClientId(input.roomId, input.actorId, input.clientId)
    if (hit === undefined) return undefined
    if (hit.body !== input.body) {
      throw new ImError('REQUEST_ID_CONFLICT', 'this client id was already used with different content')
    }
    const existing = this.options.store.getMessage(hit.message_id)
    if (existing === undefined) return undefined
    return { message: messageOf(existing), replayed: true }
  }

  /**
   * Run the write gate inside the chain: the gate sees the room's truth at
   * write time, so two racing posters resolve atomically.
   * 在写链内运行写入闸门：闸门看到的是写入时刻的房间真相，并发的两个提交者因此原子收敛。
   */
  private async runGate(input: PostInput, gate: PostGate | undefined): Promise<void> {
    if (gate === undefined) return
    const roomRow = this.options.store.getRoom(input.roomId)
    if (roomRow === undefined) {
      throw new ImError('CONVERSATION_NOT_FOUND', 'the conversation does not exist')
    }
    const lastPeer = this.lastPeerMessage(input.roomId, input.actorId)
    await gate(roomOf(roomRow), lastPeer)
  }

  /** Index one posted message under its client id, when it carried one. */
  /** 带了 client id 的消息写入幂等索引。 */
  private async rememberClientId(input: PostInput, messageId: string): Promise<void> {
    if (input.clientId === undefined) return
    await this.options.store.putClientId({
      room_id: input.roomId,
      author_id: input.actorId,
      client_id: input.clientId,
      message_id: messageId,
      body: input.body,
    })
  }

  /** Read one message by id; `undefined` when it does not exist. */
  /** 按 id 读取一条消息；不存在时返回 `undefined`。 */
  message(messageId: string): Message | undefined {
    const row = this.options.store.getMessage(messageId)
    return row === undefined ? undefined : messageOf(row)
  }

  /**
   * Incremental fetch: messages of one room strictly after `sinceSequence`,
   * ascending; the cursor work of other rooms is nobody else's business.
   * 增量拉取：一个房间内 `sinceSequence` 之后的消息，按序号升序；其他房间的游标与本请求
   * 无关。
   */
  list(input: ListInput): Message[] {
    const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
    const since = input.sinceSequence ?? 0
    return this.options.store.messagesOf(input.roomId)
      .filter(row => row.sequence > since)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
      .map(messageOf)
  }

  /**
   * The last non-self message authored by someone else — the verbatim gate's
   * comparison target (design §4.2: the gate compares inside the write
   * transaction, against the newest non-self body).
   * 房间内别人写的最后一条消息——逐字闸门的比对对象（设计 §4.2：闸门在写入事务内、与
   * 最新的非自身正文比对）。
   */
  lastPeerMessage(roomId: string, selfId: string): Message | undefined {
    const peers = this.options.store.messagesOf(roomId)
      .filter(row => row.author_id !== selfId)
      .sort((a, b) => b.sequence - a.sequence)
    const row = peers[0]
    return row === undefined ? undefined : messageOf(row)
  }

  /**
   * Allocate the next room-exclusive sequence. Runs inside the room chain, so
   * read-increment-write cannot interleave within this process — the only
   * writer.
   * 分配下一个房间独占序号。在房间写链内运行，读-增-写不会在本进程（唯一写者）内交错。
   */
  private async nextSequence(roomId: string): Promise<number> {
    const store = this.options.store
    const counter = store.getCounter(roomId)
    const sequence = counter?.next_sequence ?? 1
    await store.putCounter({ room_id: roomId, next_sequence: sequence + 1 })
    return sequence
  }
}

/** Re-export so callers need one import site for the system author constant. */
/** 再导出一次，调用方为一个常量只需一处导入。 */
export { SYSTEM_AUTHOR }
