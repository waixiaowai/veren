/**
 * The wake fan-out: consume one committed message, claim it (one copy per
 * message), triage every agent candidate, and emit wake requests for the
 * survivors.
 *
 * Signal direction per design §4.4: 拿不准宁可叫醒 — but v1 triage is fully
 * deterministic, so there is no "unsure": each rule either fires or not. The
 * per-message claim lives in memory only; a crash between claim and wake
 * re-runs through the conversation's idempotent redelivery, and the turn
 * layer's input fingerprint absorbs the duplicate.
 *
 * 唤醒扇出：消费一条已提交的消息，认领它（每条消息只此一份），对每个候选智能体分流，并为
 * 幸存者发出唤醒请求。
 *
 * 信号方向遵循设计 §4.4：拿不准宁可叫醒——但 v1 分流完全确定性，不存在「拿不准」：每条
 * 规则要么命中要么不命中。每消息认领只在内存里；认领与唤醒之间的崩溃会经会话的幂等重投
 * 重跑，回合层的输入指纹会吸收重复。
 *
 * @module @veren/im-coordination/fanout
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConversationService } from '@veren/im-conversation'
import type { ImMessageNew } from '@veren/im-conversation'
import type { ImParticipants } from '@veren/im'
import type { ImWakeRequest } from './types.ts'
import type { CoordinationService } from './service.ts'

/** How long one message's wake claim holds (design: 60 秒). */
/** 一条消息唤醒认领的持有时长（设计：60 秒）。 */
const CLAIM_MS = 60_000

/** Options for the fan-out; everything arrives by injection. */
/** 扇出的选项；一切都走注入。 */
export interface FanoutOptions {
  readonly ctx: Context
  readonly conversation: ConversationService
  readonly participants: ImParticipants
  readonly coordination: CoordinationService
}

/** The wake fan-out. */
/** 唤醒扇出。 */
export class Fanout {
  private readonly claims = new Map<string, number>()

  /**
   * @param options - injected collaborators.
   */
  constructor(private readonly options: FanoutOptions) {}

  /**
   * React to one committed message: claim it, triage the room's agent
   * members, and emit one wake request per survivor.
   * 对一条已提交的消息做出反应：认领、对房间的智能体成员分流，并为每个幸存者发一条唤醒
   * 请求。
   */
  async onMessageNew(payload: ImMessageNew): Promise<void> {
    const { room, message } = payload
    if (!this.claim(message.id)) return
    const candidates = this.agentCandidates(room.id, message.authorId)
    for (const candidateId of candidates) {
      const verdict = this.options.coordination.triage({
        roomId: room.id,
        authorId: message.authorId,
        body: message.body,
        candidateId,
      })
      if (!verdict.actionable) {
        // 已读不回：把水位推进到本条，稍后的回合不会把这批内容当未读再装载一遍。
        // Seen-and-silent: advance the watermark past this message so a later
        // turn never reloads it as unread.
        await this.options.coordination.markSeen(candidateId, room.id, message.sequence)
        continue
      }
      if (!this.options.coordination.takeBudget()) continue
      const request: ImWakeRequest = {
        agentParticipantId: candidateId,
        roomId: room.id,
        reason: 'message.new',
        triggerMessageId: message.id,
      }
      this.options.ctx.emit('im/wake-request', request)
    }
  }

  /** Drop every remembered claim; called on plugin unload. */
  /** 丢弃全部已记住的认领；插件卸载时调用。 */
  dispose(): void {
    this.claims.clear()
  }

  /**
   * One claim per message id; expired claims are reclaimed.
   * 每个消息 id 一次认领；过期的认领可被重新认领。
   */
  private claim(messageId: string): boolean {
    const at = Date.now()
    for (const [id, expires] of [...this.claims]) {
      if (at - expires >= CLAIM_MS) this.claims.delete(id)
    }
    if (this.claims.has(messageId)) return false
    this.claims.set(messageId, at)
    return true
  }

  /** The room's agent members except the author, in roster order. */
  /** 房间里除作者外的智能体成员，按名册顺序。 */
  private agentCandidates(roomId: string, authorId: string): string[] {
    return this.options.conversation.memberships(roomId)
      .map(member => member.participantId)
      .filter(id => id.startsWith('agent:') && id !== authorId)
      .sort()
  }
}
