/**
 * The turn runner: one wake becomes one run. Load the inbox, think through a
 * per-agent session, post through the coordination gates, loop on holds
 * (max three), and land in a terminal state — always with a reason.
 *
 * Serialization is per agent (design: 一次唤醒一次回合; concurrent wakes merge
 * into a queued re-run whose inbox reload absorbs them). Failure notices are
 * deduplicated per room per cause inside a six-hour window (design §3.4:
 * 失败必须被看见且不重复轰炸).
 *
 * 回合执行器：一次唤醒变成一次运行。装载收件箱，经按智能体的会话思考，穿过协调闸门写入，
 * 被拒则循环（最多三次），最终落进一个终态——永远带原因。
 *
 * 串行化按智能体（设计：一次唤醒一次回合；并发唤醒合并为排队的重跑，其收件箱重载会吸收
 * 它们）。失败提示按房间按原因在六小时窗口内去重（设计 §3.4：失败必须被看见且不重复轰炸）。
 *
 * @module @veren/im-turn/runner
 */

import type { Context } from '@deepseek-ai/cordis'
import { ImError, ImParticipants } from '@veren/im'
import type { ConversationService } from '@veren/im-conversation'
import type { ImWakeRequest } from '@veren/im-coordination'
import type { CoordinationService } from '@veren/im-coordination'
import { buildHoldPrompt, buildPrompt } from './prompt.ts'
import type { RunStore } from './runs.ts'
import { fingerprintOf } from './runs.ts'
import type { RunView, SkipCause } from './types.ts'
import type { Sessions } from './sessions.ts'
import type { ActivityBoard } from './activity.ts'
import { errorMessage } from './errors.ts'

/** How many gate rounds one reply may pass through before giving up (design: 第三次). */
/** 一条回复可以穿过的闸门轮数上限（设计：第三次）。 */
export const MAX_GATE_ROUNDS = 3

/**
 * The thinking engine seam: one prompt in, one turn's reply text out.
 * Tests substitute a scripted fake; production binds it to {@link Sessions}.
 * 思考引擎接缝：一条 prompt 进，一个回合的回复文本出。测试用脚本化假实现；生产绑定到
 * {@link Sessions}。
 */
export interface TurnEngine {
  /** Ensure the session one agent uses in one room. */
  /** 确保一个智能体在一个房间使用的会话。 */
  ensure(agentId: string, roomId: string): Promise<string>
  /** Deliver one prompt and wait for that turn's reply text. */
  /** 投递一条 prompt 并等待该回合的回复文本。 */
  ask(request: { sessionId: string; prompt: string; runId: string; timeoutMs: number }): Promise<string | undefined>
}

/** What one think-and-post cycle concluded. */
/** 一次思考-写入循环的结论。 */
type ThinkOutcome =
  | { kind: 'posted'; replyMessageId: string }
  | { kind: 'quiet' }
  | { kind: 'held-out' }

/** Construction options; everything arrives by injection. */
/** 构造选项；一切都走注入。 */
export interface RunnerOptions {
  readonly ctx: Context
  readonly conversation: ConversationService
  readonly coordination: CoordinationService
  readonly participants: ImParticipants
  readonly runs: RunStore
  readonly sessions: TurnEngine
  /** The board the panel polls for the working row; entries live only while a run does. */
  /** 面板轮询工作行所用的板；条目只在运行期间存在。 */
  readonly activity: ActivityBoard
  /** Maximum wait for one session turn (hard boundary, per design §3.2). */
  /** 单次会话回合的最大等待（硬边界，设计 §3.2）。 */
  readonly replyTimeoutMs: number
}

/** The runner. */
/** 回合执行器。 */
export class Runner {
  /** The chains serialize one run per agent; the queued flag marks re-runs. */
  /** 写链按智能体串行化运行；排队标记记录重跑。 */
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly noticeAt = new Map<string, number>()

  /**
   * @param options - injected collaborators plus the turn budget knobs.
   */
  constructor(private readonly options: RunnerOptions) {}

  /**
   * React to one wake request: queue the run on the agent's chain.
   * 对一条唤醒请求做出反应：把运行排上该智能体的写链。
   */
  onWake(request: ImWakeRequest): void {
    const previous = this.chains.get(request.agentParticipantId) ?? Promise.resolve()
    const next = previous.then(() => this.runTurn(request), () => this.runTurn(request))
    const tail = next.catch(() => undefined)
    this.chains.set(request.agentParticipantId, tail)
    void next.finally(() => {
      if (this.chains.get(request.agentParticipantId) === tail) {
        this.chains.delete(request.agentParticipantId)
      }
    })
  }

  /**
   * Run one turn directly, outside the per-agent chain (tests use this to
   * await the outcome; production path is {@link onWake}).
   * 直接跑一次回合，不经过按智能体的写链（测试用它等待结果；生产路径是 {@link onWake}）。
   */
  async runOnce(request: ImWakeRequest): Promise<void> {
    await this.runTurn(request)
  }

  /** Stop the runner; pending prompts reject on session dispose. */
  /** 停止执行器；悬挂的 prompt 随会话释放而拒绝。 */
  dispose(): void {
    this.chains.clear()
    this.noticeAt.clear()
  }

  /** The chain body: one full run lifecycle. */
  /** 写链主体：一次完整的运行生命周期。 */
  private async runTurn(request: ImWakeRequest): Promise<void> {
    const run = await this.options.runs.start(request.agentParticipantId, request.roomId, request.reason)
    // 登记为实时：面板从这一瞬间起有工作行可显示，落定后由 finally 摘除。
    // Register as live: the panel has a working row from this instant; the
    // finally clause removes it once the run settles.
    this.options.activity.begin({
      runId: run.id,
      roomId: request.roomId,
      agentParticipantId: request.agentParticipantId,
    })
    this.announce(run)
    try {
      const prepared = await this.prepare(run, request)
      if (prepared === undefined) return
      const outcome = await this.thinkAndPost(run, prepared.sessionId, request, prepared.prompt)
      await this.settle(run, request, prepared.inboxTail, outcome)
    } catch (error: unknown) {
      await this.fail(run, error)
    } finally {
      this.options.activity.finish(run.id)
    }
  }

  /**
   * Load the inbox and the session; `undefined` means the run already landed
   * in a terminal state (nothing to read, fingerprint hit, room vanished).
   * 装载收件箱与会话；返回 `undefined` 表示运行已落入终态（无信可读、指纹命中、房间消失）。
   */
  private async prepare(run: RunView, request: ImWakeRequest): Promise<{
    readonly sessionId: string
    readonly prompt: string
    readonly inboxTail: number
  } | undefined> {
    const { conversation, coordination, runs, sessions, participants } = this.options
    const unread = this.inboxOf(request.agentParticipantId, request.roomId)
    if (unread.length === 0) {
      await this.end(run, 'skipped', { skipCause: 'nothing-to-read' })
      return undefined
    }
    const inboxTail = unread[unread.length - 1]!.sequence
    const fingerprint = fingerprintOf(request.agentParticipantId, request.roomId, unread.map(m => m.id))
    await runs.stampFingerprint(run, fingerprint)
    if (runs.fingerprintRecentlyDone(request.agentParticipantId, fingerprint)) {
      await coordination.markSeen(request.agentParticipantId, request.roomId, inboxTail)
      await this.end(run, 'skipped', { skipCause: 'fingerprint-hit' })
      return undefined
    }
    const room = conversation.room(request.roomId)
    if (room === undefined) {
      await this.end(run, 'failed', { error: 'the room vanished before the run' })
      return undefined
    }
    const sessionId = await sessions.ensure(request.agentParticipantId, request.roomId)
    // 会话一旦存在就挂到活动条目上，后续的会话事件与流帧才找得到这个运行。
    // Attach the session as soon as it exists so later session events and
    // stream frames resolve back to this run.
    this.options.activity.attachSession(run.id, sessionId)
    const prompt = buildPrompt({ room, agentId: request.agentParticipantId, participants, unread })
    return { sessionId, prompt, inboxTail }
  }

  /** Land the run after thinking: held-out, quiet, or posted. */
  /** 思考之后落定运行：收手、安静或已发送。 */
  private async settle(
    run: RunView,
    request: ImWakeRequest,
    inboxTail: number,
    outcome: ThinkOutcome,
  ): Promise<void> {
    const { conversation, coordination } = this.options
    if (outcome.kind === 'held-out') {
      // 三次被拒不重入终态：thinkAndPost 已落下 skipped(held-out)。
      // Held three times does not re-enter a terminal state: thinkAndPost
      // already landed skipped(held-out).
      await coordination.markSeen(request.agentParticipantId, request.roomId, inboxTail)
      return
    }
    if (outcome.kind === 'quiet') {
      // 安静也是正当终态：把已见推进到收件箱末端。
      // Quiet is a legitimate terminal state too: advance the seen mark to
      // the inbox end.
      await coordination.markSeen(request.agentParticipantId, request.roomId, inboxTail)
      await this.end(run, 'completed', {})
      return
    }
    const posted = conversation.message(outcome.replyMessageId)
    await coordination.markSeen(request.agentParticipantId, request.roomId, posted?.sequence ?? inboxTail)
    await this.end(run, 'completed', { replyMessageId: outcome.replyMessageId })
  }

  /**
   * Think once, post through the gates, and loop on holds.
   * 思考一次，穿闸门写入，被拒则循环。
   */
  private async thinkAndPost(
    run: RunView,
    sessionId: string,
    request: ImWakeRequest,
    prompt: string,
  ): Promise<ThinkOutcome> {
    let current = prompt
    for (let round = 0; round < MAX_GATE_ROUNDS; round++) {
      const reply = await this.options.sessions.ask({
        sessionId,
        prompt: current,
        runId: run.id,
        timeoutMs: this.options.replyTimeoutMs,
      })
      if (reply === undefined || reply.trim() === '') return { kind: 'quiet' }
      const posted = await this.postBehindGate(run, request, reply, round)
      if (posted !== undefined) return posted
      // 被拒：把未看到的事实织进再提示，进入下一轮。
      // Held: weave the unseen facts into the re-prompt and take the next round.
      const hold = this.lastHold!
      current = buildHoldPrompt({ draft: reply, newer: holdLines(hold), kind: holdKind(hold) })
    }
    return { kind: 'quiet' }
  }

  /** The hold error of this reply's most recent refusal, for the re-prompt. */
  /** 本条回复最近一次拒绝的错误，供再提示使用。 */
  private lastHold: unknown = undefined

  /**
   * Post one reply behind the gates. Returns the outcome when the loop is done
   * (posted / held-out), or `undefined` when the gate held this round.
   * 在闸门之后写入一条回复。循环结束时返回结果（已发送/收手）；本轮被拒返回 `undefined`。
   */
  private async postBehindGate(
    run: RunView,
    request: ImWakeRequest,
    reply: string,
    round: number,
  ): Promise<ThinkOutcome | undefined> {
    const gate = this.options.coordination.gatePost(request.agentParticipantId, reply, round + 1)
    try {
      const posted = await this.options.conversation.post({
        roomId: request.roomId,
        actorId: request.agentParticipantId,
        kind: 'text',
        body: reply,
      }, gate)
      return { kind: 'posted', replyMessageId: posted.message.id }
    } catch (error: unknown) {
      if (!isHold(error)) throw error
      if (round === MAX_GATE_ROUNDS - 1) {
        // 三次被拒：按设计的收手指令结束——记为 skipped(held-out)。
        // Held three times: end per the design's stand-down instruction —
        // recorded as skipped(held-out).
        await this.end(run, 'skipped', { skipCause: 'held-out' })
        return { kind: 'held-out' }
      }
      this.lastHold = error
      return undefined
    }
  }

  /** Assemble the agent's inbox: the messages after its seen watermark. */
  /** 组装智能体的收件箱：已见水位之后的消息。 */
  private inboxOf(agentId: string, roomId: string): import('@veren/im-conversation').Message[] {
    const since = this.options.coordination.seen(agentId, roomId)
    const unread = this.options.conversation.list({ roomId, sinceSequence: since })
    return unread.filter(message => message.authorId !== agentId)
  }

  /** Land a run in a terminal state and announce it. */
  /** 把运行落进一个终态并通告。 */
  private async end(
    run: RunView,
    status: 'completed' | 'failed' | 'skipped',
    extra: { skipCause?: SkipCause; error?: string; replyMessageId?: string } = {},
  ): Promise<void> {
    const finished = await this.options.runs.finish(run, status, extra)
    this.announce(finished)
  }

  /** Classify one failure, raise the deduplicated notice, and land the run. */
  /** 给一次失败分类，发出去重提示，并落下运行。 */
  private async fail(run: RunView, error: unknown): Promise<void> {
    const classified = classify(error)
    const finished = await this.options.runs.finish(run, classified.status, {
      ...(classified.skipCause === undefined ? {} : { skipCause: classified.skipCause }),
      ...(classified.message === undefined ? {} : { error: classified.message }),
    })
    this.announce(finished)
    if (classified.notice !== undefined) {
      await this.raiseNotice(run.roomId, classified.notice)
    }
  }

  /** Announce one run transition on the family bus. */
  /** 在家族总线上通告一次运行转变。 */
  private announce(run: RunView): void {
    this.options.ctx.emit('im/run-updated', { run })
  }

  /**
   * Post one deduplicated system notice into the room: same room + same cause
   * notifies once inside six hours (design §3.4).
   * 往房间里发一条去重的系统提示：同房间+同原因六小时内只提示一次（设计 §3.4）。
   */
  private async raiseNotice(roomId: string, notice: string): Promise<void> {
    const WINDOW_MS = 6 * 60 * 60 * 1_000
    const key = `${roomId}\u0000${notice}`
    const at = Date.now()
    const last = this.noticeAt.get(key)
    if (last !== undefined && at - last < WINDOW_MS) return
    this.noticeAt.set(key, at)
    try {
      await this.options.conversation.post({
        roomId,
        actorId: 'system',
        kind: 'system',
        body: notice,
      })
    } catch {
      // A failed notice must never break the run's own settlement.
      // 提示失败绝不能破坏运行自身的结算。
    }
  }
}

/** Whether one error is a coordination hold. */
/** 一个错误是否是协调拒绝。 */
function isHold(error: unknown): boolean {
  return error instanceof ImError && (error.code === 'HELD_FRESHNESS' || error.code === 'HELD_VERBATIM')
}

/** The hold kind of one hold error. */
/** 一个拒绝错误的种类。 */
function holdKind(error: unknown): string {
  return error instanceof ImError && error.code === 'HELD_VERBATIM' ? 'verbatim' : 'freshness'
}

/** The unseen lines carried by one hold error. */
/** 一个拒绝错误携带的未看到行。 */
function holdLines(error: unknown): string[] {
  if (!(error instanceof ImError)) return []
  const details = error.details as { newer?: ReadonlyArray<{ sequence: number; authorId: string; excerpt: string }> } | undefined
  return (details?.newer ?? []).map(line => `#${line.sequence} ${line.authorId}: ${line.excerpt}`)
}

/** Failure classification per design §20.2: rate/quota → skipped, rest → failed. */
/** 按 §20.2 的失败分类：限流/额度 → skipped，其余 → failed。 */
function classify(error: unknown): {
  status: 'failed' | 'skipped'
  skipCause?: SkipCause
  message?: string
  notice?: string
} {
  const message = errorMessage(error)
  const isLlm = error instanceof ImError
  const code = isLlm ? error.code : undefined
  const rateHit = /429|rate.?limit/i.test(message) || code === 'IM_RATE_LIMITED' || code === 'RATE_LIMITED'
  if (rateHit) {
    return {
      status: 'skipped',
      skipCause: 'model-rate-limited',
      notice: '智能体暂时没有回复：模型限流，稍后会自动恢复。',
    }
  }
  if (code === 'MODEL_QUOTA_EXHAUSTED') {
    return {
      status: 'skipped',
      skipCause: 'model-quota',
      notice: '智能体暂时没有回复：本周期模型额度已用完。',
    }
  }
  return { status: 'failed', message }
}
