// 结算看守：把「目标会话已经真正静止」变成恰好一条通知。
// The settlement guard: turn "the target session reached true quiescence" into
// exactly one notice.
//
// 形状照抄官方子 agent 的 src/manager.ts：watchLocalSettlement() / settlementState()
// / wake()。那里已经把**同步通知**与**异步静止**分开了：
//   - 同步面：agent/inbox/inserted|claimed|discarded 只唤醒观察者——wake() 结清并
//     换新 poke 令牌；
//   - 异步面：常驻协程自己 await whenIdle()，再按令牌判 retry / wait / ready。
// 因此这里既不订阅 agent/status（maintenance 期间公开状态仍是 idle，那是会写错的判据），
// 也不排任何定时任务，也不做 sessionId 比对（监听挂在目标 Agent 自己的作用域上）。
// The shape follows the official subagent's src/manager.ts: watchLocalSettlement()
// / settlementState() / wake(). That code already separates a synchronous
// notification from an asynchronous quiescence: `agent/inbox/*` only wakes the
// observer (wake() settles and renews the `poke` token), and a standing coroutine
// awaits `whenIdle()` itself and reads the token to decide retry / wait / ready.
// So this subscribes to no `agent/status` (the public status stays `idle` while a
// maintenance task runs, which is a verdict that can be wrong), schedules
// nothing, and compares no session ids - the wake sources live on the target
// Agent's own scope.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { emitAgentEvent, foldConsumedWork } from '@deepseek-ai/dsh-agent'
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { createSettlementNotice, deliverNotice } from './notice.js'
import type { SessionDispatchOutcome } from './types.js'

/** 观察者的判定结果，与官方 settlementState 同构。The observer's verdict, isomorphic to the official `settlementState`. */
type SettlementState = 'closed' | 'retry' | 'wait' | 'ready'

/** 一个可以从外部结清的 promise。A promise an outside caller can settle. */
interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/**
 * 建一个可以从外部结清的 promise。Build a promise an outside caller can settle.
 * @returns 结清句柄。The settle handle.
 */
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** 一个挂起中的看守。One armed watch. */
interface WatchRecord {
  readonly watchId: string
  readonly targetSessionId: SessionId
  readonly callerSessionId: SessionId
  readonly armedAt: number
  /**
   * 订阅之后目标会话的事件（事件对象是共享的冻结值，所以这只是引用数组，很便宜）。
   * 它同时供三件事使用：官方 foldConsumedWork 的结算归因、收尾输出折叠、失败取代判断。
   * The target session's events since subscription (events are shared frozen
   * values, so this is just an array of references). It feeds three things: the
   * official `foldConsumedWork` accounting, the closing-output fold, and failure
   * supersession.
   */
  readonly events: SessionEvent[]
  /**
   * 尚未被后续已提交轮次取代的失败位置（`agent/error` 时的 session seq）。
   * 官方规则：已记录的失败优先于取消——停掉一个已经失败的会话不会把失败变成取消。
   * The position of a failure not yet superseded by a later committed turn (the
   * session seq at `agent/error`). Official rule: a recorded failure wins over a
   * cancellation - stopping a child that had already failed does not turn its
   * failure into a cancellation.
   */
  failureAt: number | undefined
  /** 观察令牌；每次唤醒都换新，用来发现「等待期间状态变过」。 */
  /** The observation token; renewed on every wake so a mid-await change is visible. */
  poke: Deferred
  readonly offEvents: (() => boolean)[]
  settled: boolean
}

/** 结算看守注册表。The settlement-watch registry. */
export interface SettlementWatch {
  /** 是否还能再接一个看守。Whether another watch fits the configured cap. */
  readonly hasCapacity: () => boolean
  /**
   * 先登记唤醒源、再执行投递、最后启动观察者；三步同处一个同步块，顺序不可交换。
   * Register the wake sources, run the delivery, then start the observer; all
   * three run in one synchronous block and the order is not interchangeable.
   */
  readonly arm: (agent: Agent, callerSessionId: SessionId, deliver: () => void) => string
  /** 卸载：取消全部看守，不再回报。Unload: cancel every watch and stop reporting. */
  readonly dispose: () => void
}

/** 看守使用的配置面。The configuration the guard reads. */
export interface SettlementWatchConfig {
  readonly maxReportChars: number
  readonly maxConcurrentWatches: number
}

/**
 * 创建结算看守注册表。Create the settlement-watch registry.
 * @param ctx - 插件 Context。The plugin Context.
 * @param config - 已校验配置。The validated config.
 * @returns 注册表句柄。The registry handle.
 */
export function createSettlementWatch(ctx: Context, config: SettlementWatchConfig): SettlementWatch {
  const watches = new Map<string, WatchRecord>()
  let sequence = 0

  /**
   * 唤醒观察者：结清旧令牌并换新，让「等待期间状态变过」可被观察。
   * Wake the observer: settle the old token and renew it, which is what makes a
   * mid-await state change observable.
   * @param record - 看守记录。The watch record.
   */
  function wake(record: WatchRecord): void {
    record.poke.resolve()
    record.poke = deferred()
  }

  /**
   * 判断此刻能否收尾。Decide whether the watch may finalize right now.
   * @param record - 看守记录。The watch record.
   * @param agent - 目标 Agent。The target Agent.
   * @param observation - 本次等待开始时的令牌。The token captured when this wait began.
   * @returns 判定结果。The verdict.
   */
  function settlementState(record: WatchRecord, agent: Agent, observation: Deferred): SettlementState {
    if (record.settled) return 'closed'
    // 等待期间被唤醒过：状态变过，重新评估而不是就地收尾。
    // Woken during the await: state changed, so re-evaluate rather than finalize.
    if (record.poke !== observation) return 'retry'
    // 还有输入没跑（刚投递的那条也算）：等下一次唤醒，不空转。
    // Input is still pending (including the prompt just delivered): wait for the
    // next wake instead of spinning.
    const inbox = agent.inbox
    if (inbox.nextTurn.length > 0 || inbox.nextStep.length > 0) return 'wait'
    return 'ready'
  }

  /**
   * 常驻观察者：跟到目标真正静止为止。The standing observer: follow the target to true quiescence.
   * @param record - 看守记录。The watch record.
   * @param agent - 目标 Agent。The target Agent.
   * @returns 观察结束。Resolves when the watch closed.
   */
  async function observe(record: WatchRecord, agent: Agent): Promise<void> {
    for (;;) {
      const observation = record.poke
      // 权威静止信号：没有活动 driver，也没有 maintenance 任务。
      // Authoritative quiescence: no active driver and no maintenance task.
      await agent.whenIdle()
      if (record.settled) return
      // 注册表身份比对（与官方 drainDescendants 同一手法）：被看护的 Agent 已经离开
      // 注册表，就没人再能产出收尾输出了。
      // Registry identity check (the official drainDescendants move): the watched
      // Agent left the registry, so nobody can produce closing output any more.
      if (ctx.agents.get(record.targetSessionId) !== agent) {
        await flushTarget(record)
        await settle(record, 'target-gone')
        return
      }
      const state = settlementState(record, agent, observation)
      if (state === 'closed') return
      if (state === 'retry') continue
      if (state === 'wait') {
        await observation.promise
        continue
      }
      // 收尾前的复查，与官方 watchLocalSettlement 的 ready 分支同一手法：记住当时的
      // seq，best-effort flush，然后**重新**判定——状态或 seq 只要动过就回到循环重判，
      // 绝不拿着 flush 之前的结论去报告。
      // The pre-finalization re-check, the official watchLocalSettlement ready
      // branch move: remember the seq, best-effort flush, then decide AGAIN - if
      // either the state or the seq moved, go back around instead of reporting the
      // conclusion reached before the flush.
      const finalSeq = agent.session.seq
      await flushTarget(record)
      if (record.settled) return
      if (settlementState(record, agent, observation) !== 'ready') continue
      if (agent.session.seq !== finalSeq) continue
      await settle(record, stopReasonOf(record))
      return
    }
  }

  /**
   * 结清一个看守并投递通知。Retire one watch and deliver its notice.
   * @param record - 看守记录。The watch record.
   * @param outcome - 下场。The outcome.
   * @returns 通知投递结束。Resolves once the notice has been handed over.
   */
  async function settle(record: WatchRecord, outcome: SessionDispatchOutcome): Promise<void> {
    if (record.settled) return
    record.settled = true
    watches.delete(record.watchId)
    for (const off of record.offEvents) off()
    // 结清也要唤醒：观察者可能正卡在 wait 分支上。
    // Settlement wakes too: the observer may be parked in its `wait` branch.
    wake(record)
    const closing = closingText(record)
    const message = createSettlementNotice(
      record.targetSessionId, outcome, closing, config.maxReportChars,
    )
    try {
      // 目标会话已由调用方在收尾复查里 best-effort flush 过，这里只负责投递。
      // The target was already best-effort flushed by the pre-finalization
      // re-check; this only delivers.
      await deliverNotice(ctx, record.callerSessionId, message)
    } catch (error: unknown) {
      ctx.logger.warn(`session-dispatch: notice of watch "${record.watchId}" was not delivered: ${String(error)}`)
    }
    // 无论通知投递成功与否都广播终局：事件描述的是观察到的事实，不是投递结果。
    // The terminal event fires whether or not delivery succeeded: it reports what
    // was observed, not whether the notice landed.
    emitRunEnd(record, outcome, closing)
  }

  /**
   * 广播终局事件；调用方已经不在注册表时静默跳过。
   * Broadcast the terminal event; a caller no longer in the registry is skipped.
   * @param record - 看守记录。The watch record.
   * @param outcome - 终局原因。The terminal outcome.
   * @param closing - 目标的收尾内容块。The target's closing blocks.
   */
  function emitRunEnd(record: WatchRecord, outcome: SessionDispatchOutcome, closing: readonly ContentBlock[]): void {
    const caller = ctx.agents.get(record.callerSessionId)
    if (caller === undefined) return
    emitAgentEvent(ctx, caller, 'session-dispatch/end', {
      watchId: record.watchId,
      targetSessionId: record.targetSessionId,
      callerSessionId: record.callerSessionId,
      outcome,
      ...closing.length === 0 ? {} : { lastAssistantMessage: closing },
    })
  }

  /**
   * best-effort 刷目标会话；失败只告警（与官方 flushFinalState 一致）。
   * Best-effort flush of the target session; a failure only warns, as the
   * official flushFinalState does.
   * @param record - 看守记录。The watch record.
   * @returns flush 结束。Resolves after the attempt.
   */
  async function flushTarget(record: WatchRecord): Promise<void> {
    const session = targetSession(record)
    if (session === undefined) return
    try {
      await ctx.sessions.flush(session)
    } catch (error: unknown) {
      ctx.logger.warn(`session-dispatch: best-effort flush of "${record.targetSessionId}" failed: ${String(error)}`)
    }
  }

  /**
   * 取被观察的目标会话。Read the observed target session.
   * @param record - 看守记录。The watch record.
   * @returns 会话，取不到时 undefined。The session, or undefined.
   */
  function targetSession(record: WatchRecord): Session | undefined {
    return ctx.sessions.get(record.targetSessionId) ?? ctx.agents.get(record.targetSessionId)?.session
  }

  /**
   * 从目标自己的事件后缀派生结束原因。
   * Derive the stop reason from the target's own event suffix.
   *
   * 归因用官方 `foldConsumedWork`（`@deepseek-ai/dsh-agent`，运行时可直接解析）：
   * 只有它能把「跑完了」与「认领了输入却被拒/被停/出错」分开——单看轮次边界，
   * 一个在第一步之前停下的轮次与一个平衡的空转轮次形状完全相同，孤立读轮次不是把
   * 被截断的活记成完成，就是把每个空转都定罪。分支本身照抄官方 `epochStopReason`
   * （在 `@deepseek-ai/dsh-subagent` 的 lifecycle.ts；该包在本工作区不可解析，
   * 且让会话工具依赖派活子系统是不该有的依赖边）。
   * The accounting reuses the official `foldConsumedWork` (`@deepseek-ai/dsh-agent`,
   * resolvable at runtime): only it separates "finished" from "claimed input then
   * was rejected/stopped/errored", because a turn stopping before its first step
   * has exactly the shape of a balanced no-op turn, so reading turns in isolation
   * either credits cut-short work as finished or convicts every no-op. The switch
   * mirrors the official `epochStopReason` (in `@deepseek-ai/dsh-subagent`'s
   * lifecycle.ts, which is not resolvable in this workspace and whose subsystem a
   * session tool should not depend on).
   * @param record - 看守记录。The watch record.
   * @returns 结束原因。The stop reason.
   */
  function stopReasonOf(record: WatchRecord): SessionDispatchOutcome {
    // 已记录的失败优先于取消（官方 captureLocalResult 的同一判据）。
    // A recorded failure wins over a cancellation (the official captureLocalResult rule).
    if (record.failureAt !== undefined) return 'error'
    const { end, droppedUnrun } = foldConsumedWork(record.events)
    switch (end?.data.reason.kind) {
      case 'max-tokens': return 'max-tokens'
      case 'aborted':
      case 'interrupted': return 'aborted'
      case 'error': return 'error'
      // pre-step 拒绝（hook 拒绝、策略插件）丢弃了这个 epoch 已认领的输入：那是被拒绝，不是做完了。
      // A pre-step rejection (a hook deny, a policy plugin) discarded input this
      // epoch had claimed: the work was declined, not done.
      case 'blocked': return 'refusal'
      // 干净结束与「根本没有计账轮次」同规则：没有取消留下的未跑输入就算做完了。
      // A clean ending and no accounting turn share one rule: the epoch finished
      // what it was given unless a cancelled queue says otherwise.
      case undefined:
      case 'completed': return droppedUnrun ? 'aborted' : 'completed'
      default:
        // TurnEndReason 可扩展：无法命名的结束按失败汇报，而不是当成成功。
        // Merge-extensible: an unnameable ending is reported as a failure, never
        // as success.
        return 'error'
    }
  }

  /**
   * 折叠目标的收尾输出。规则与官方 `AssistantOutputFold` 一致：最后一条**非空**
   * assistant 消息（空内容消息，例如只带 usage 的，不替换更早的输出）；没有任何消息时
   * 回退到累积的流文本。该官方类来自不可解析的 `@deepseek-ai/dsh-subagent`，所以这里
   * 按其语义就地实现，并复用官方的 `joinAssistantStreamText` 处理流片段。
   * Fold the target's closing output. The rule matches the official
   * `AssistantOutputFold`: the last non-empty assistant message (an empty-content
   * message, such as a usage-only one, never replaces earlier output), falling
   * back to the accumulated stream text when no message exists. That official
   * class lives in the unresolvable `@deepseek-ai/dsh-subagent`, so its semantics
   * are implemented here and the official `joinAssistantStreamText` handles the
   * stream pieces.
   * @param record - 看守记录。The watch record.
   * @returns 收尾内容块。The closing content blocks.
   */
  function closingText(record: WatchRecord): readonly ContentBlock[] {
    let message: readonly ContentBlock[] | undefined
    const partial: string[] = []
    for (const event of record.events) {
      if (event.type === 'assistant/message') {
        const content = event.data.message.content
        if (content.length > 0) message = content
      }
      if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        partial.push(joinAssistantStreamText(event.data.stream))
      }
    }
    if (message !== undefined) return message
    const text = partial.join('')
    return text.length > 0 ? [{ type: 'text', text }] : []
  }

  /**
   * 在目标 Agent 自己的作用域上登记观察面。
   * Register the observation surface on the target Agent's own scope.
   *
   * `agent.ctx` 上的监听由 @deepseek-ai/dsh-scope 按作用域路由，只会收到这个 Agent 的
   * 通知，因此不需要、也没有任何 sessionId 比对；Agent 卸载时 Cordis 一并摘除。
   * Listeners on `agent.ctx` are routed by @deepseek-ai/dsh-scope to that Agent
   * alone, so no sessionId comparison exists or is needed; Agent disposal unwinds
   * them too.
   *
   * 唤醒源只有 inbox 三件事与 `agent/error`（与官方一致）：`session/event` **只记账不唤醒**，
   * 否则每个流片段都会把观察者吵醒一次。
   * The wake sources are exactly the three inbox events plus `agent/error`, as in
   * the official observer: `session/event` records without waking, because
   * otherwise every stream piece would wake the observer.
   * @param record - 看守记录。The watch record.
   * @param agent - 目标 Agent。The target Agent.
   */
  function watchTarget(record: WatchRecord, agent: Agent): void {
    const notify = (): void => { wake(record) }
    const onEvent = (session: Session, event: SessionEvent): void => {
      if (session !== agent.session) return
      record.events.push(event)
      // 后续已提交轮次取代了这次失败：它不再决定结束原因（官方 observeLocalFailure 的规则）。
      // A later committed turn supersedes the failure: it no longer decides the
      // stop reason (the official observeLocalFailure rule).
      if (event.type === 'turn/end' && record.failureAt !== undefined && event.seq >= record.failureAt) {
        record.failureAt = undefined
      }
    }
    const onError = ({ agent: subject }: { agent: Agent }): void => {
      if (subject !== agent) return
      record.failureAt = agent.session.seq
      notify()
    }
    record.offEvents.push(
      agent.ctx.on('agent/inbox/inserted', notify),
      agent.ctx.on('agent/inbox/claimed', notify),
      agent.ctx.on('agent/inbox/discarded', notify),
      agent.ctx.on('session/event', onEvent),
      agent.ctx.on('agent/error', onError),
    )
  }

  /** 撤销一个看守且不通知。Drop one watch without notifying。 */
  function disarm(watchId: string): boolean {
    const record = watches.get(watchId)
    if (record === undefined) return false
    record.settled = true
    for (const off of record.offEvents) off()
    wake(record)
    watches.delete(watchId)
    return true
  }

  return {
    hasCapacity: () => watches.size < config.maxConcurrentWatches,

    // 卸载必须把每个看守标记结清：观察者可能正挂在 whenIdle() 上，醒来后会先看到
    // settled 而直接返回，不再去碰已经失效的 Context。
    // Unload must mark every watch settled: an observer parked on whenIdle() wakes,
    // sees `settled`, and returns before touching the now-inactive Context.
    dispose() {
      for (const watchId of [...watches.keys()]) disarm(watchId)
    },

    arm(agent, callerSessionId, deliver) {
      const watchId = `sd-${(sequence += 1)}`
      const record: WatchRecord = {
        watchId,
        targetSessionId: agent.id,
        callerSessionId,
        armedAt: Date.now(),
        events: [],
        failureAt: undefined,
        poke: deferred(),
        offEvents: [],
        settled: false,
      }
      watches.set(watchId, record)
      watchTarget(record, agent)
      try {
        // 投递在登记之后、观察之前，中间没有 await：目标接下来的每一次 inbox 变化
        // 都会被记进 poke，观察者既不会漏掉转换，也不会提前宣布完成。
        // Delivery sits between registration and observation with no await in
        // between, so every later inbox change is recorded in `poke` and the
        // observer can neither miss a transition nor announce completion early.
        deliver()
      } catch (error: unknown) {
        disarm(watchId)
        throw error
      }
      void observe(record, agent).catch((error: unknown) => {
        if (!record.settled) {
          ctx.logger.warn(`session-dispatch: watching "${record.targetSessionId}" failed: ${String(error)}`)
        }
      })
      return watchId
    },
  }
}
