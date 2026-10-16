// 派发看守：把「目标会话已经真正静止」这件事变成一次性回报。
// The dispatch guard: turn "the target session reached true quiescence" into
// exactly one report.
//
// 形状照抄官方子 agent 的结算观察者 packages/subagent/subagent/src/manager.ts
// 的 watchLocalSettlement() / settlementState() / wake()，因为那里已经解决了同一
// 个问题：**同步通知与异步静止是两件事**。
//   - 同步面：agent/inbox/* 的 emit 通知只做一件事——唤醒观察者（wake() 结清并
//     更新 poke 令牌）；
//   - 异步面：观察者是一个常驻协程，自己 await whenIdle()，再按令牌判断这次等待
//     期间状态有没有变过（retry）、还有没有待跑输入（wait）还是可以收尾（ready）。
// 因此这里既不订阅 agent/status，也不做任何 sessionId 比对，更不排定时任务。
// The shape follows the official subagent settlement observer
// (`watchLocalSettlement()` / `settlementState()` / `wake()` in
// packages/subagent/subagent/src/manager.ts), which already solves this exact
// problem: a synchronous notification and an asynchronous quiescence are two
// different things. The synchronous face - `agent/inbox/*` notifications - only
// wakes the observer (settling and renewing the `poke` token). The asynchronous
// face is a standing coroutine that awaits `whenIdle()` itself and then reads the
// token to decide: state changed while waiting (retry), input still pending
// (wait), or genuinely quiescent (ready). So this file subscribes to no
// `agent/status`, compares no session ids, and schedules nothing.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from './index.js'
import { deliverReport, readFinalOutput, renderReport } from './report.js'
import type { ReportContext, WatchOutcome } from './types.js'

/** 观察者的判定结果，与官方 settlementState 同构。 */
/** The observer's verdict, isomorphic to the official `settlementState`. */
type SettlementState = 'closed' | 'retry' | 'wait' | 'ready'

/** 一个可以从外部结清的 promise。/ A promise an outside caller can settle. */
interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/**
 * 建一个可以从外部结清的 promise。/ Build a promise an outside caller can settle.
 * @returns 结清句柄。/ The settle handle.
 */
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** 一个挂起中的看守。/ One armed watch. */
interface WatchRecord {
  readonly watchId: string
  readonly targetSessionId: SessionId
  readonly callerSessionId: SessionId
  readonly armedAt: number
  /** 投递那一刻的派生历史长度：回报只看这之后的新输出，不看目标的历史。 */
  /** Derived-history length at delivery: the report reads only output produced after it. */
  readonly outputBaseline: number
  /** 观察令牌；每次唤醒都换新，用来发现「等待期间状态变过」。 */
  /** The observation token; renewed on every wake so a mid-await change is visible. */
  poke: Deferred
  readonly offEvents: (() => boolean)[]
  settled: boolean
}

/** 看守注册表：挂起、观察、结清与卸载。/ The watch registry: arm, observe, settle, unload. */
export interface WatchRegistry {
  /** 是否还能再接一个看守。/ Whether another watch fits the configured cap. */
  readonly hasCapacity: () => boolean
  /**
   * 先挂看守、再执行投递、最后启动观察者；三件事在同一个同步块里，顺序不可交换。
   * Arm the watch, run the delivery, then start the observer; all three run in
   * one synchronous block and the order is not interchangeable.
   */
  readonly arm: (agent: Agent, callerSessionId: SessionId, deliver: () => void) => string
  /** 卸载：取消全部看守，不再回报。/ Unload: cancel every watch and stop reporting. */
  readonly dispose: () => void
}

/**
 * 创建看守注册表。/ Create the watch registry.
 * @param ctx - 插件 Context。/ The plugin Context.
 * @param config - 已校验配置。/ The validated config.
 * @returns 注册表句柄。/ The registry handle.
 */
export function createWatchRegistry(ctx: Context, config: Config): WatchRegistry {
  const watches = new Map<string, WatchRecord>()
  let sequence = 0

  /**
   * 唤醒观察者：结清旧令牌并换新，让「等待期间状态变过」可被观察。
   * Wake the observer: settle the old token and renew it, which is what makes a
   * mid-await state change observable.
   * @param record - 看守记录。/ The watch record.
   */
  function wake(record: WatchRecord): void {
    record.poke.resolve()
    record.poke = deferred()
  }

  /**
   * 判断此刻能否收尾。/ Decide whether the watch may finalize right now.
   * @param record - 看守记录。/ The watch record.
   * @param agent - 目标 Agent。/ The target Agent.
   * @param observation - 本次等待开始时的令牌。/ The token captured when this wait began.
   * @returns 判定结果。/ The verdict.
   */
  function settlementState(record: WatchRecord, agent: Agent, observation: Deferred): SettlementState {
    if (record.settled) return 'closed'
    // 等待期间被唤醒过：状态变过，重新评估而不是就地收尾。
    // Woken during the await: state changed, so re-evaluate instead of finalizing.
    if (record.poke !== observation) return 'retry'
    // 还有输入没跑（本插件刚投递的那条也算）：等下一次唤醒，不空转。
    // Input is still pending (including the prompt just delivered): wait for the
    // next wake instead of spinning.
    const inbox = agent.inbox
    if (inbox.nextTurn.length > 0 || inbox.nextStep.length > 0) return 'wait'
    return 'ready'
  }

  /**
   * 常驻观察者：跟到目标真正静止为止。/ The standing observer: follow the target to true quiescence.
   * @param record - 看守记录。/ The watch record.
   * @param agent - 目标 Agent。/ The target Agent.
   * @returns 观察结束（已结清或已关闭）。/ Resolves when the watch closed.
   */
  async function observe(record: WatchRecord, agent: Agent): Promise<void> {
    for (;;) {
      const observation = record.poke
      // 权威静止信号：没有活动 driver，也没有 maintenance 任务。
      // Authoritative quiescence: no active driver and no maintenance task.
      await agent.whenIdle()
      if (record.settled) return
      // 注册表身份比对（与 manager.ts drainDescendants 同一手法）：看护的那个
      // Agent 已经离开注册表，就没有人可以再产出收尾输出了。
      // Registry identity check (the same move as drainDescendants in
      // manager.ts): the watched Agent left the registry, so nobody can produce
      // closing output any more.
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
   * 结清一个看守并投递回报。/ Retire one watch and deliver its report.
   * @param record - 看守记录。/ The watch record.
   * @param outcome - 结束原因。/ Why the watch ended.
   * @returns 回报投递结束。/ Resolves once the report has been handed over.
   */
  async function settle(record: WatchRecord, outcome: WatchOutcome): Promise<void> {
    if (record.settled) return
    record.settled = true
    watches.delete(record.watchId)
    for (const off of record.offEvents) off()
    // 结清也要唤醒：观察者可能正卡在 wait 分支上。
    // Settlement wakes too: the observer may be parked in its `wait` branch.
    wake(record)
    const context: ReportContext = {
      targetSessionId: record.targetSessionId,
      watchId: record.watchId,
      outcome,
      waitedMs: Date.now() - record.armedAt,
    }
    const output = readFinalOutput(ctx, record.targetSessionId, record.outputBaseline)
    try {
      await deliverReport(ctx, record.callerSessionId, renderReport(config, context, output))
    } catch (error: unknown) {
      ctx.logger.warn(`session-dispatch: report of watch "${record.watchId}" was not delivered: ${String(error)}`)
    }
  }

  /**
   * 在一个 Agent 的作用域上登记同步唤醒源。
   * Register the synchronous wake sources on one Agent's own scope.
   *
   * agent.ctx 上的监听由 dsh-scope 按作用域路由，因此只会收到这个 Agent 的通知，
   * 无需、也没有任何 sessionId 比对；Agent 卸载时 Cordis 一并摘除。
   * Listeners on `agent.ctx` are routed by dsh-scope to that Agent alone, so no
   * sessionId comparison exists or is needed; Agent disposal unwinds them too.
   * @param record - 看守记录。/ The watch record.
   * @param agent - 目标 Agent。/ The target Agent.
   */
  function watchInbox(record: WatchRecord, agent: Agent): void {
    const notify = (): void => { wake(record) }
    record.offEvents.push(
      agent.ctx.on('agent/inbox/inserted', notify),
      agent.ctx.on('agent/inbox/claimed', notify),
      agent.ctx.on('agent/inbox/discarded', notify),
    )
  }

  /**
   * 撤销一个看守且不回报。/ Drop one watch without reporting.
   * @param watchId - 看守句柄。/ The watch handle.
   * @returns 是否撤销了一个仍挂起的看守。/ Whether an armed watch was dropped.
   */
  function disarmWatch(watchId: string): boolean {
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
        // 投递在观察者之前、登记之后，中间没有 await：目标接下来的每一次 inbox
        // 变化都会被记进 poke，观察者不会漏掉，也不会提前宣布完成。
        // Delivery sits between registration and observation with no await in
        // between, so every later inbox change is recorded in `poke` and the
        // observer can neither miss it nor announce completion early.
        deliver()
      } catch (error: unknown) {
        disarmWatch(watchId)
        throw error
      }
      void observe(record, agent).catch((error: unknown) => {
        if (!record.settled) {
          ctx.logger.warn(`session-dispatch: watching "${record.targetSessionId}" failed: ${String(error)}`)
        }
      })
      return watchId
    },

    dispose() {
      for (const record of [...watches.values()]) {
        record.settled = true
        for (const off of record.offEvents) off()
        wake(record)
      }
      watches.clear()
    },
  }
}
