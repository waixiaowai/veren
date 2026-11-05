/**
 * The coordination service: triage, watermarks, budgets, and the two write
 * gates. Gates run inside the conversation write chain (via the post gate
 * hook), so two agents drafting at once resolve atomically: the first poster
 * wins, the second receives the unseen facts instead of an error.
 *
 * 失败方向遵循设计 §4.2：信号开放（水位缺失放行），权限关闭（闸门拒绝换内容重试）。
 *
 * The cheap-model judgment is a deliberate v1 deferral: triage is fully
 * deterministic (direct-human wakes, mentions route, everything else stays
 * quiet). The design's `support-model` source and its budget interplay are an
 * extension point, not a silent omission.
 *
 * 协调服务：分流、水位、预算与两道写入闸门。闸门在会话写链内运行（经 post 闸门钩子），
 * 两个同时起草的智能体因此原子地收敛：先提交者赢，后提交者拿到未看到的事实而不是错误。
 *
 * 失败方向遵循设计 §4.2：信号开放（水位缺失放行），权限关闭（闸门拒绝须换内容重试）。
 *
 * 廉价模型判断是 v1 的明确推迟：分流完全确定性（人类私聊唤醒、点名路由，其余保持安静）。
 * 设计的 `support-model` 来源及其预算互动是扩展点，不是静默缺失。
 *
 * @module @veren/im-coordination/service
 */

import { defineToken } from '@veren/core'
import { ImError } from '@veren/im'
import type { ImParticipants } from '@veren/im'
import type { ConversationService } from '@veren/im-conversation'
import type { Message, Room } from '@veren/im-conversation'
import type { FreshnessVerdict, HoldLine, TriageVerdict } from './types.ts'
import { BudgetRing } from './budget.ts'
import { Watermarks } from './watermarks.ts'

/** How many unseen lines a refusal carries (design: 最多 8 条). */
/** 一次拒绝携带的未看到行数上限（设计：最多 8 条）。 */
export const MAX_HOLD_LINES = 8
/** The excerpt length of one hold line. */
/** 一条未看到行的摘录长度。 */
export const HOLD_EXCERPT_CHARS = 200
/** After this many holds a turn must stop re-deciding (design: 第三次). */
/** 被拒达到这一次数后，回合必须停止重新决策（设计：第三次）。 */
export const MAX_HOLD_ATTEMPTS = 3

/** Construction options; everything arrives by injection. */
/** 构造选项；一切都走注入。 */
export interface CoordinationOptions {
  readonly conversation: ConversationService
  readonly participants: ImParticipants
  readonly watermarks: Watermarks
  /** The low-priority wake budget ring. */
  /** 低优先唤醒预算环。 */
  readonly budget: BudgetRing
}

/** The coordination service. */
/** 协调服务。 */
export class CoordinationService {
  /**
   * @param options - conversation, roster, watermarks, and the wake budget.
   */
  constructor(private readonly options: CoordinationOptions) {}

  /**
   * Triage one message for one candidate agent: fully deterministic (design
   * §4.2 order, minus the model judgment deferred out of v1).
   * 为一个候选智能体给一条消息分流：完全确定性（设计 §4.2 的顺序，去掉 v1 推迟的模型
   * 判断）。
   */
  triage(input: {
    readonly roomId: string
    readonly authorId: string
    readonly body: string
    readonly candidateId: string
  }): TriageVerdict {
    if (input.authorId === input.candidateId) {
      return { actionable: false, source: 'self-authored' }
    }
    const room = this.options.conversation.room(input.roomId)
    if (room === undefined) return { actionable: false, source: 'group-quiet' }
    if (input.authorId.startsWith('agent:')) {
      // Agent-to-agent noise fails closed in v1: quiet unless mentioned.
      // v1 中智能体之间的噪音失败关闭：除非被点名，否则安静。
      return this.isMentioned(input.body, input.candidateId)
        ? { actionable: true, source: 'mentioned' }
        : { actionable: false, source: 'agent-quiet' }
    }
    if (room.kind === 'direct') {
      // A human talking in a direct room is waiting for an answer.
      // 在私聊房间里说话的人正在等回答。
      return { actionable: true, source: 'direct-human' }
    }
    return this.isMentioned(input.body, input.candidateId)
      ? { actionable: true, source: 'mentioned' }
      : { actionable: false, source: 'group-quiet' }
  }

  /**
   * Whether the budget admits one more low-priority wake.
   * 预算是否还允许一次低优先唤醒。
   */
  takeBudget(): boolean {
    return this.options.budget.take()
  }

  /**
   * One agent's seen watermark in one room, advanced to `sequence`.
   * 把一个智能体在一个房间的已见水位推进到 `sequence`。
   */
  async markSeen(agentId: string, roomId: string, sequence: number): Promise<void> {
    await this.options.watermarks.record(agentId, roomId, sequence)
  }

  /** One agent's watermark in one room; zero when never recorded. */
  /** 一个智能体在一个房间的水位；从未记录时为零。 */
  seen(agentId: string, roomId: string): number {
    return this.options.watermarks.read(agentId, roomId)
  }

  /**
   * The read-only preflight verdict for a draft. On a freshness hold the
   * watermark advances immediately, so one plain resend passes (design §4.5).
   * 草稿的只读预检判定。新鲜度拒绝时水位立即推进，因此原样重发一次即可通过（设计 §4.5）。
   */
  async preflightReply(agentId: string, roomId: string, draft: string): Promise<FreshnessVerdict> {
    const room = this.options.conversation.room(roomId)
    if (room === undefined) {
      throw new ImError('CONVERSATION_NOT_FOUND', 'the conversation does not exist')
    }
    const verbatim = this.verbatimHold(room, agentId, draft)
    if (verbatim !== undefined) return verbatim
    const freshness = await this.freshnessHold(room, agentId)
    return freshness ?? { hold: false, newer: [], attempts: 0 }
  }

  /**
   * The write gate handed to `conversation.post`: freshness and verbatim are
   * judged at write time inside the room chain, atomically with the post.
   * 交给 `conversation.post` 的写入闸门：新鲜度与逐字在写入时刻、房间写链内判定，与写入
   * 原子。
   */
  gatePost(agentId: string, draft: string, attempts: number) {
    return async (room: Room, lastPeer: Message | undefined): Promise<void> => {
      if (this.isVerbatim(draft, lastPeer)) {
        throw new ImError('HELD_VERBATIM', 'this draft repeats the room’s latest message', {
          details: { kind: 'verbatim', attempts },
        })
      }
      const freshness = await this.freshnessHold(room, agentId)
      if (freshness !== undefined) {
        throw new ImError('HELD_FRESHNESS', 'there are messages you have not seen', {
          details: { kind: 'freshness', newer: freshness.newer, attempts },
        })
      }
    }
  }

  /** The freshness hold for one room state, advancing the watermark on hold. */
  /** 一个房间状态的新鲜度判定，拒绝时推进水位。 */
  private async freshnessHold(room: Room, agentId: string): Promise<FreshnessVerdict | undefined> {
    const baseline = this.options.watermarks.read(agentId, room.id)
    // Fail open: never-woken agents and two-seat direct rooms have no stale view.
    // 失败开放：从未被唤醒的智能体与两个座位的私聊房间不存在过时的视野。
    if (baseline === 0 || room.members.length <= 2) return undefined
    const newer = this.options.conversation.list({ roomId: room.id, sinceSequence: baseline })
      .filter(message => message.authorId !== agentId)
    if (newer.length === 0) return undefined
    await this.options.watermarks.record(agentId, room.id, newer[newer.length - 1]!.sequence)
    return {
      hold: true,
      kind: 'freshness',
      newer: newer.slice(0, MAX_HOLD_LINES).map(lineOf),
      attempts: 0,
    }
  }

  /** The read-only verbatim hold for one draft. */
  /** 一条草稿的只读逐字判定。 */
  private verbatimHold(room: Room, agentId: string, draft: string): FreshnessVerdict | undefined {
    const lastPeer = this.options.conversation.lastPeerMessage(room.id, agentId)
    if (!this.isVerbatim(draft, lastPeer)) return undefined
    return {
      hold: true,
      kind: 'verbatim',
      newer: [],
      attempts: 0,
    }
  }

  /** Whether a draft repeats the newest non-self body, whitespace-collapsed. */
  /** 草稿是否与最新的非自身正文逐字相同（折叠空白后）。 */
  private isVerbatim(draft: string, lastPeer: Message | undefined): boolean {
    if (lastPeer === undefined) return false
    return collapse(draft) === collapse(lastPeer.body)
  }

  /** Whether a body mentions one agent by its display name or an accepted alias. */
  /** 正文是否按展示名或别名点了某个智能体的名。 */
  private isMentioned(body: string, agentId: string): boolean {
    const view = this.options.participants.resolve(agentId)
    if (view === undefined) return false
    const plain = collapse(body)
    const names = [view.displayName, ...(view.aliases ?? [])]
    return plain.includes(`@${agentId}`)
      || names.some(name => plain.includes(`@${collapse(name)}`) || plain.includes(collapse(name)))
  }
}

/** The coordination service token. */
/** 协调服务令牌。 */
export const CoordinationToken = defineToken<CoordinationService>('imCoordination')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The coordination service provided by @veren/im-coordination. */
    /** 由 @veren/im-coordination 提供的协调服务。 */
    imCoordination: CoordinationService
  }
}

/** Excerpt one message into a hold line. */
/** 把一条消息摘录成一条未看到行。 */
function lineOf(message: Message): HoldLine {
  return {
    sequence: message.sequence,
    authorId: message.authorId,
    excerpt: message.body.slice(0, HOLD_EXCERPT_CHARS),
  }
}

/** Collapse whitespace for the verbatim comparison. */
/** 折叠空白，用于逐字比对。 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export type { FreshnessVerdict, HoldKind, HoldLine, TriageVerdict } from './types.ts'
