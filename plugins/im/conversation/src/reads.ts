/**
 * Read cursors and unread accounting: cursors only move forward (a late stale
 * request never pushes one back), and unread counts derive from the cursor.
 *
 * The read cursor says "this participant saw up to here" — the wake side keeps
 * its own watermarks (design §2.2: 已读不等于看到; the two never overwrite
 * each other).
 *
 * 已读游标与未读记账：游标只进不退（迟到的过期请求绝不把游标推回去），未读数由游标推导。
 *
 * 已读游标表达的是「这个参与者看到了这里」——唤醒侧维护自己的水位（设计 §2.2：已读不等于
 * 看到；两者互不覆盖）。
 *
 * @module @veren/im-conversation/reads
 */

import type { ReadCursor } from './types.ts'
import { readOf } from './rows.ts'
import type { ReadRow } from './rows.ts'
import type { ConvStorage } from './store.ts'

/** Options; the clock is injectable for tests. */
/** 选项；时钟可注入，供测试使用。 */
export interface ReadServiceOptions {
  readonly store: ConvStorage
  readonly now?: () => number
}

/** Read-cursor accounting. */
/** 已读游标记账。 */
export class ReadService {
  private readonly now: () => number

  /**
   * @param options - the backing store and an optional clock.
   */
  constructor(private readonly options: ReadServiceOptions) {
    this.now = options.now ?? Date.now
  }

  /**
   * Advance one participant's cursor; a lower sequence is ignored. The cursor
   * may exceed the newest message (a client ahead of the log is fine).
   * 推进一个参与者的游标；更小的序号被忽略。游标可以超过最新消息（客户端领先于日志是
   * 合法的）。
   */
  async markRead(roomId: string, participantId: string, sequence: number): Promise<ReadCursor> {
    const existing = this.options.store.getRead(roomId, participantId)
    if (existing !== undefined && sequence <= existing.last_read_sequence) {
      return readOf(existing)
    }
    const row: ReadRow = {
      room_id: roomId,
      participant_id: participantId,
      last_read_sequence: sequence,
      updated_at: this.now(),
    }
    await this.options.store.putRead(row)
    return readOf(row)
  }

  /** One participant's cursor in one room; absent reads as zero. */
  /** 一个参与者在一个房间的游标；缺省按零理解。 */
  readOf(roomId: string, participantId: string): number {
    return this.options.store.getRead(roomId, participantId)?.last_read_sequence ?? 0
  }

  /** Every cursor of one participant across rooms. */
  /** 一个参与者在全部房间的游标。 */
  cursorsOf(participantId: string): ReadCursor[] {
    return this.options.store.reads()
      .filter(row => row.participant_id === participantId)
      .map(readOf)
  }

  /** Unread count for one participant in one room (messages after the cursor). */
  /** 一个参与者在一个房间的未读数（游标之后的消息）。 */
  unread(roomId: string, participantId: string): number {
    const cursor = this.readOf(roomId, participantId)
    return this.options.store.messagesOf(roomId).filter(row => row.sequence > cursor).length
  }
}
