/**
 * Room creation and membership: idempotent room provisioning, idempotent
 * joins, and the member-projection upkeep.
 *
 * Membership rows are the truth; the room row's `members` array is the listing
 * projection this module keeps in step. A repeat join updates nothing and
 * returns the existing membership — same as the design's composite-key
 * convergence.
 *
 * 房间创建与成员关系：幂等的房间筹备、幂等的加入，以及成员投影的维护。
 *
 * 成员关系行才是真值；房间行上的 `members` 数组是本模块随手维护的列表投影。重复加入不改
 * 任何东西、返回既有成员关系——与设计的复合键收敛一致。
 *
 * @module @veren/im-conversation/rooms
 */

import { randomUUID } from 'node:crypto'
import { ImError } from '@veren/im'
import type { Room, RoomKind, RoomMember } from './types.ts'
import { memberOf, roomOf } from './rows.ts'
import type { RoomRow } from './rows.ts'
import type { ConvStorage } from './store.ts'

/** Options for the room service; the clock is injectable for tests. */
/** 房间服务的选项；时钟可注入，供测试使用。 */
export interface RoomServiceOptions {
  readonly store: ConvStorage
  readonly now?: () => number
}

/** Room provisioning and membership. */
/** 房间筹备与成员关系。 */
export class RoomService {
  private readonly now: () => number

  /**
   * @param options - the backing store and an optional clock.
   */
  constructor(private readonly options: RoomServiceOptions) {
    this.now = options.now ?? Date.now
  }

  /**
   * Ensure one channel-backed room exists (idempotent by its deterministic
   * id) and seat every listed member. Seating is idempotent per member.
   * 确保一个渠道背书的房间存在（按确定性 id 幂等），并让列出的每个成员入座。入座按成员幂等。
   */
  async ensureChannelRoom(input: {
    readonly roomId: string
    readonly title?: string
    readonly memberIds: readonly string[]
  }): Promise<Room> {
    return this.options.store.onRoomChain(input.roomId, async () => {
      const existing = this.options.store.getRoom(input.roomId)
      if (existing === undefined) {
        const at = this.now()
        await this.options.store.putRoom({
          id: input.roomId,
          kind: 'direct',
          ...(input.title === undefined ? {} : { title: input.title }),
          members: [],
          created_at: at,
          updated_at: at,
        })
      }
      await this.seatAll(input.roomId, input.memberIds)
      return roomOf(await this.refreshProjection(input.roomId))
    })
  }

  /**
   * Create one internal room; callers that need idempotent creation pass their
   * own `conv:` id, otherwise a fresh one is minted.
   * 创建一个内部房间；需要幂等创建的调用方自带 `conv:` id，否则铸造全新 id。
   */
  async createRoom(input: {
    readonly roomId?: string
    readonly kind: RoomKind
    readonly title?: string
    readonly memberIds: readonly string[]
  }): Promise<Room> {
    const roomId = input.roomId ?? `conv-${randomUUID()}`
    return this.options.store.onRoomChain(roomId, async () => {
      if (this.options.store.getRoom(roomId) === undefined) {
        const at = this.now()
        await this.options.store.putRoom({
          id: roomId,
          kind: input.kind,
          ...(input.title === undefined ? {} : { title: input.title }),
          members: [],
          created_at: at,
          updated_at: at,
        })
      }
      await this.seatAll(roomId, input.memberIds)
      return roomOf(await this.refreshProjection(roomId))
    })
  }

  /** Read one room; a non-existent room stays a non-existent room. */
  /** 读取一个房间；不存在的房间就保持不存在。 */
  room(roomId: string): Room | undefined {
    const row = this.options.store.getRoom(roomId)
    return row === undefined ? undefined : roomOf(row)
  }

  /** Every room, projection included. */
  /** 全部房间，含投影。 */
  list(): Room[] {
    return this.options.store.rooms().map(roomOf)
  }

  /** One room's membership rows, in roster order. */
  /** 一个房间的成员关系行，按名册顺序。 */
  memberships(roomId: string): RoomMember[] {
    return this.options.store.membersOf(roomId).sort((a, b) => a.ordinal - b.ordinal).map(memberOf)
  }

  /** Whether one participant holds membership in one room. */
  /** 一个参与者是否是一个房间的成员。 */
  isMember(roomId: string, participantId: string): boolean {
    return this.options.store.getMember(roomId, participantId) !== undefined
  }

  /**
   * Guard that a room exists and a human/agent actor holds membership; any
   * other case reads as "not found" (design: 非成员一律视为不存在). System
   * writes skip the check — the server is always allowed to record facts.
   * 守卫：房间存在且人类/智能体行动者持有成员关系；其余一律按「不存在」理解（设计：非成员
   * 一律视为不存在）。系统写入跳过该检查——服务端永远可以记录事实。
   */
  requireMembership(roomId: string, actorId: string): void {
    if (actorId === SYSTEM_AUTHOR) return
    if (this.options.store.getRoom(roomId) === undefined
      || this.options.store.getMember(roomId, actorId) === undefined) {
      throw new ImError('CONVERSATION_NOT_FOUND', 'the conversation does not exist')
    }
  }

  /** Seat every listed member; repeats are no-ops. */
  /** 让列出的每个成员入座；重复入座是无操作。 */
  private async seatAll(roomId: string, memberIds: readonly string[]): Promise<void> {
    const existing = this.options.store.membersOf(roomId)
    let ordinal = existing.reduce((max, row) => Math.max(max, row.ordinal), 0) + 1
    for (const participantId of memberIds) {
      if (this.options.store.getMember(roomId, participantId) !== undefined) continue
      await this.options.store.putMember({
        room_id: roomId,
        participant_id: participantId,
        ordinal,
        joined_at: this.now(),
      })
      ordinal += 1
    }
  }

  /** Rewrite one room's member projection and updated_at; returns the fresh row. */
  /** 重写一个房间的成员投影与 updated_at；返回新行。 */
  private async refreshProjection(roomId: string): Promise<RoomRow> {
    const row = this.options.store.getRoom(roomId)
    if (row === undefined) throw new ImError('CONVERSATION_NOT_FOUND', 'the conversation does not exist')
    const members = this.options.store.membersOf(roomId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(member => member.participant_id)
    const fresh: RoomRow = { ...row, members, updated_at: this.now() }
    await this.options.store.putRoom(fresh)
    return fresh
  }
}

/** The fixed author of system rows (design: system rows are server-written). */
/** 系统行的固定作者（设计：system 行由服务端写入）。 */
export const SYSTEM_AUTHOR = 'system'

/** Project one room row into its public view. */
/** 把一行房间投影成公开视图。 */
export { roomOf } from './rows.ts'
