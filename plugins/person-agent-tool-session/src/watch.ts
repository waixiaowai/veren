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
import type { SessionId } from '@deepseek-ai/dsh-session'
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
  /** 投递那一刻的派生历史长度：通知只读这之后的新输出，不捡目标的历史。 */
  /** Derived-history length at delivery: the notice reads only output produced after it. */
  readonly outputBaseline: number
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
      await settle(record, 'settled')
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
    const message = createSettlementNotice(
      record.targetSessionId, outcome, readClosingText(record), config.maxReportChars,
    )
    try {
      await deliverNotice(ctx, record.callerSessionId, message)
    } catch (error: unknown) {
      ctx.logger.warn(`session-dispatch: notice of watch "${record.watchId}" was not delivered: ${String(error)}`)
    }
  }

  /**
   * 读目标会话在投递之后新产生的收尾 assistant 文本。
   * 选取规则与官方 finalAssistantOutput 一致：最后一条**非空** assistant 消息；
   * 空内容（只带 usage）的消息不替换更早的输出。官方走的是事件后缀快照，而
   * Session.snapshotEvents 已被标记弃用（"new calls are prohibited"），所以这里用
   * 未弃用的派生历史加一个投递基线表达同一条规则。
   * Read the target's closing assistant text produced after the delivery. The
   * selection rule matches the official finalAssistantOutput: the last non-empty
   * assistant message, where empty (usage-only) messages never replace earlier
   * output. The official reads an event suffix, but Session.snapshotEvents is
   * deprecated ("new calls are prohibited"), so this expresses the same rule with
   * the non-deprecated derived history plus a delivery baseline.
   * @param record - 看守记录。The watch record.
   * @returns 收尾文本块。The closing text blocks.
   */
  function readClosingText(record: WatchRecord): { type: 'text', text: string }[] {
    const session = ctx.sessions.get(record.targetSessionId) ?? ctx.agents.get(record.targetSessionId)?.session
    if (session === undefined) return []
    const produced = session.deriveMessages().slice(record.outputBaseline)
    for (let index = produced.length - 1; index >= 0; index -= 1) {
      const message = produced[index]
      if (message === undefined || message.role !== 'assistant') continue
      const text = message.content.flatMap(block => (block.type === 'text' && block.text.length > 0 ? [block] : []))
      if (text.length > 0) return text
    }
    return []
  }

  /**
   * 在目标 Agent 自己的作用域上登记同步唤醒源。
   * Register the synchronous wake sources on the target Agent's own scope.
   *
   * `agent.ctx` 上的监听由 @deepseek-ai/dsh-scope 按作用域路由，只会收到这个 Agent 的
   * 通知，因此不需要、也没有任何 sessionId 比对；Agent 卸载时 Cordis 一并摘除。
   * Listeners on `agent.ctx` are routed by @deepseek-ai/dsh-scope to that Agent
   * alone, so no sessionId comparison exists or is needed; Agent disposal unwinds
   * them too.
   * @param record - 看守记录。The watch record.
   * @param agent - 目标 Agent。The target Agent.
   */
  function watchInbox(record: WatchRecord, agent: Agent): void {
    const notify = (): void => { wake(record) }
    record.offEvents.push(
      agent.ctx.on('agent/inbox/inserted', notify),
      agent.ctx.on('agent/inbox/claimed', notify),
      agent.ctx.on('agent/inbox/discarded', notify),
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
        outputBaseline: agent.session.deriveMessages().length,
        poke: deferred(),
        offEvents: [],
        settled: false,
      }
      watches.set(watchId, record)
      watchInbox(record, agent)
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
