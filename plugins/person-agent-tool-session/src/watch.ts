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
//
// 与官方的一处刻意分歧：官方的看守独占一个子会话，"会话静止"因此等价于"这次派发干完
// 了"；这里的目标是别人拥有、可被反复投递的会话，所以注册表强制**一个目标同时只有一个
// 未结清的看守**，在 `arm()` / `deliverGuarded()` 里与登记同处一个同步块地查账，拒绝
// 第二条派发。
// One deliberate divergence from the official guard: the official one exclusively
// owns a child session, so "the session is quiescent" equals "this dispatch
// finished". Here the target is a session someone else owns and can hand more
// work to, so the registry enforces **one unsettled watch per target** and
// refuses a second dispatch inside `arm()` / `deliverGuarded()`, checking the
// ledger in the same synchronous block as the registration.
//
// 职责分域：公共契约、poke 令牌与看守记录在 watch-contract.ts；唤醒源登记与观察
// 循环在 watch-observe.ts；结束原因/收尾输出的纯派生在 watch-outcome.ts。本文件只
// 保留注册表本身：查账（assertNoPending）、结清（settle）、终局广播（emitRunEnd）、
// best-effort flush 与武装入口（armWatch / deliverGuarded / dispose），各步都是
// 模块级函数，经 WatchRegistryState 共享注册表数据。
// Duty domains: the public contract, the poke token and the watch record live in
// watch-contract.ts; the wake sources and the observation loop live in
// watch-observe.ts; the pure stop-reason/closing-output folds live in
// watch-outcome.ts. This file keeps the registry itself: the ledger check
// (assertNoPending), settlement (settle), the terminal broadcast (emitRunEnd),
// the best-effort flush, and the arming entries (armWatch / deliverGuarded /
// dispose) - each a module-level function sharing registry data through
// WatchRegistryState.
import type { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createSettlementNotice, deliverNotice } from './notice.js'
import { SessionToolError } from './types.js'
import type { SessionDispatchOutcome } from './types.js'
import { deferred, wake } from './watch-contract.js'
import type { ArmingRequest, SettlementWatch, SettlementWatchConfig, WatchRecord, WatchRuntime } from './watch-contract.js'
import { observe, watchTarget } from './watch-observe.js'
import { closingText } from './watch-outcome.js'

// 公共契约原从本模块导出；拆分后这里保留薄 re-export，`./watch.js` 的导出面不变。
// The public contract used to be exported from this module; after the split this
// stays a thin re-export so the `./watch.js` export face is unchanged.
export type { ArmingRequest, SettlementWatch, SettlementWatchConfig } from './watch-contract.js'

/**
 * 注册表内部状态：原工厂闭包的数据面，模块级步骤函数经它共享。
 * Internal registry state: the data face of the former factory closure, shared
 * by the module-level step functions through it.
 */
interface WatchRegistryState {
  readonly ctx: Context
  readonly config: SettlementWatchConfig
  readonly watches: Map<string, WatchRecord>
  /** 看守序号发生器，只有 armWatch 推进。The watch sequence, advanced only by armWatch. */
  sequence: number
}

/**
 * 创建结算看守注册表。Create the settlement-watch registry.
 * @param ctx - 插件 Context。The plugin Context.
 * @param config - 已校验配置。The validated config.
 * @returns 注册表句柄。The registry handle.
 */
export function createSettlementWatch(ctx: Context, config: SettlementWatchConfig): SettlementWatch {
  const state: WatchRegistryState = { ctx, config, watches: new Map(), sequence: 0 }
  return {
    hasCapacity: () => state.watches.size < config.maxConcurrentWatches,

    // 卸载必须把每个看守标记结清：观察者可能正挂在 whenIdle() 上，醒来后会先看到
    // settled 而直接返回，不再去碰已经失效的 Context。
    // Unload must mark every watch settled: an observer parked on whenIdle() wakes,
    // sees `settled`, and returns before touching the now-inactive Context.
    dispose() {
      for (const watchId of [...state.watches.keys()]) disarm(state, watchId)
    },

    deliverGuarded(targetSessionId, deliver) {
      assertNoPending(state, targetSessionId)
      deliver()
    },

    arm: request => armWatch(state, request),
  }
}

/**
 * 目标会话上尚未结清的看守句柄；没有时 undefined。
 * The handle of the unsettled watch on a target session, or undefined.
 * 已结清的看守在 settle() / disarm() 里立刻从表里摘除，所以"在表里"就等于"未结清"。
 * A settled watch leaves the map inside settle() / disarm(), so presence in the
 * map already means unsettled.
 */
function pendingOn(state: WatchRegistryState, targetSessionId: SessionId): string | undefined {
  for (const record of state.watches.values()) {
    if (record.targetSessionId === targetSessionId) return record.watchId
  }
  return undefined
}

/**
 * 目标上已有未结清看守就拒绝这次投递。
 * Refuse this delivery while the target already has an unsettled watch.
 *
 * 判据由注册表自己持有并在登记动作里强制执行：谁在这里登记看守，谁就必须先过这一关，
 * 因此调用方（或将来新增的调用方）无法先查一次、再绕开检查去登记。
 * The registry owns the verdict and enforces it inside the registering
 * operation: whoever registers a watch here must pass this gate first, so a
 * caller - including one added later - cannot check once and then register
 * around the check.
 */
function assertNoPending(state: WatchRegistryState, targetSessionId: SessionId): void {
  const pending = pendingOn(state, targetSessionId)
  if (pending === undefined) return
  throw new SessionToolError(
    'SESSION_DISPATCH_WATCH_BUSY',
    `session "${targetSessionId}" already has unsettled settlement watch "${pending}" and its closing output has not been reported back yet. `
    + 'Delivering another prompt now would either collapse two reports onto the same last output or replace what that pending report describes. '
    + `Wait for the notice that names "${pending}" and dispatch again.`,
    { sessionId: targetSessionId, watchId: pending },
  )
}

/**
 * 结清一个看守并投递通知。Retire one watch and deliver its notice.
 */
async function settle(state: WatchRegistryState, record: WatchRecord, outcome: SessionDispatchOutcome): Promise<void> {
  if (record.settled) return
  record.settled = true
  state.watches.delete(record.watchId)
  for (const off of record.offEvents) off()
  // 结清也要唤醒：观察者可能正卡在 wait 分支上。
  // Settlement wakes too: the observer may be parked in its `wait` branch.
  wake(record)
  const closing = closingText(record.events)
  const message = createSettlementNotice(
    record.targetSessionId, outcome, closing, state.config.maxReportChars,
    { watchId: record.watchId, messageId: record.messageId, prompt: record.prompt },
  )
  try {
    // 目标会话已由调用方在收尾复查里 best-effort flush 过，这里只负责投递。
    // The target was already best-effort flushed by the pre-finalization
    // re-check; this only delivers.
    await deliverNotice(state.ctx, record.callerSessionId, message)
  } catch (error: unknown) {
    state.ctx.logger.warn(`session-dispatch: notice of watch "${record.watchId}" was not delivered: ${String(error)}`)
  }
  // 无论通知投递成功与否都广播终局：事件描述的是观察到的事实，不是投递结果。
  // The terminal event fires whether or not delivery succeeded: it reports what
  // was observed, not whether the notice landed.
  emitRunEnd(state.ctx, record, outcome, closing)
}

/**
 * 广播终局事件；调用方已经不在注册表时静默跳过。
 * Broadcast the terminal event; a caller no longer in the registry is skipped.
 */
function emitRunEnd(ctx: Context, record: WatchRecord, outcome: SessionDispatchOutcome, closing: readonly ContentBlock[]): void {
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
 */
async function flushTarget(ctx: Context, record: WatchRecord): Promise<void> {
  const session = ctx.sessions.get(record.targetSessionId) ?? ctx.agents.get(record.targetSessionId)?.session
  if (session === undefined) return
  try {
    await ctx.sessions.flush(session)
  } catch (error: unknown) {
    ctx.logger.warn(`session-dispatch: best-effort flush of "${record.targetSessionId}" failed: ${String(error)}`)
  }
}

/**
 * 撤销一个看守且不通知。Drop one watch without notifying.
 */
function disarm(state: WatchRegistryState, watchId: string): boolean {
  const record = state.watches.get(watchId)
  if (record === undefined) return false
  record.settled = true
  for (const off of record.offEvents) off()
  wake(record)
  state.watches.delete(watchId)
  return true
}

/**
 * 由武装请求铸出看守记录（尚未登记进注册表）。
 * Mint the watch record from an arming request (not yet registered).
 */
function createWatchRecord(request: ArmingRequest, watchId: string): WatchRecord {
  return {
    watchId,
    targetSessionId: request.agent.id,
    callerSessionId: request.callerSessionId,
    messageId: request.messageId,
    prompt: request.prompt,
    armedAt: Date.now(),
    events: [],
    failureAt: undefined,
    poke: deferred(),
    offEvents: [],
    settled: false,
  }
}

/**
 * 武装一个看守：查账、登记、投递、启动观察者四步同处一个同步块，顺序不可交换。
 * Arm one watch: check the ledger, register, deliver, then start the observer;
 * the four steps share one synchronous block and the order is not
 * interchangeable.
 *
 * 查账与登记之间没有 await，因此同一步里并发发出的两条派发不可能都通过这里，第二条
 * 只会拿到拒绝，而且什么都没登记、什么都没投递。投递在登记之后、观察之前，中间没有
 * await：目标接下来的每一次 inbox 变化都会被记进 poke，观察者既不会漏掉转换，也不会
 * 提前宣布完成。观察循环经回调面（flush/settle）回到注册表，失败只告警——结清后观察
 * 者的错误与已废弃的看守无关，不再打扰日志。
 * No await separates the check from the registration, so two dispatches issued
 * concurrently in one step cannot both pass - the second only gets the refusal,
 * with nothing registered and nothing delivered. Delivery sits between
 * registration and observation with no await in between, so every later inbox
 * change is recorded in `poke` and the observer can neither miss a transition
 * nor announce completion early. The observation loop reaches the registry back
 * through the callback face (flush/settle); a failure only warns - once
 * settled, an observer error belongs to a watch that no longer exists and stays
 * out of the log.
 */
function armWatch(state: WatchRegistryState, request: ArmingRequest): string {
  assertNoPending(state, request.agent.id)
  const watchId = `sd-${(state.sequence += 1)}`
  const record = createWatchRecord(request, watchId)
  state.watches.set(watchId, record)
  watchTarget(record, request.agent)
  try {
    request.deliver()
  } catch (error: unknown) {
    disarm(state, watchId)
    throw error
  }
  const runtime: WatchRuntime = {
    flushTarget: target => flushTarget(state.ctx, target),
    settle: (target, outcome) => settle(state, target, outcome),
  }
  void observe(state.ctx, runtime, record, request.agent).catch((error: unknown) => {
    if (!record.settled) {
      state.ctx.logger.warn(`session-dispatch: watching "${record.targetSessionId}" failed: ${String(error)}`)
    }
  })
  return watchId
}
