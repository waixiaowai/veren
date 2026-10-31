// 结算看守的装配契约：公共类型面、可从外部结清的 promise 令牌，以及看守记录。
// The settlement watch's assembly contract: the public type face, the promise
// token an outside caller can settle, and the watch record.
//
// watch.ts（注册表核心）与 watch-observe.ts（观察面）都从这里取类型与 wake()，
// 彼此互不 import，依赖方向恒为 观察面/注册表 → 契约。
// Both watch.ts (the registry core) and watch-observe.ts (the observer) take
// their types and wake() from here and never import each other; the dependency
// direction is always observer/registry → contract.
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionDispatchOutcome } from './types.js'

/** 观察者的判定结果，与官方 settlementState 同构。The observer's verdict, isomorphic to the official `settlementState`. */
export type SettlementState = 'closed' | 'retry' | 'wait' | 'ready'

/** 一个可以从外部结清的 promise。A promise an outside caller can settle. */
export interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

/**
 * 建一个可以从外部结清的 promise。Build a promise an outside caller can settle.
 * @returns 结清句柄。The settle handle.
 */
export function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** 一个挂起中的看守。One armed watch. */
export interface WatchRecord {
  readonly watchId: string
  readonly targetSessionId: SessionId
  readonly callerSessionId: SessionId
  /** 被投递消息的身份；随通知一起回报，让回报可归属。Identity of the delivered prompt; reported with the notice so the notice is attributable. */
  readonly messageId: string
  /** 被投递的提示原文；在通知的归属行里回显。The delivered prompt, echoed in the notice's attribution line. */
  readonly prompt: string
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

/**
 * 唤醒观察者：结清旧令牌并换新，让「等待期间状态变过」可被观察。
 * Wake the observer: settle the old token and renew it, which is what makes a
 * mid-await state change observable.
 * @param record - 看守记录。The watch record.
 */
export function wake(record: WatchRecord): void {
  record.poke.resolve()
  record.poke = deferred()
}

/**
 * 观察者依赖的注册表回调面：best-effort 刷目标与「结清并投递通知」都归注册表
 * （watch.ts）所有，观察循环经它回调，不反向 import。
 * The registry callback face the observer depends on: the best-effort target
 * flush and the "settle and deliver the notice" step are both owned by the
 * registry (watch.ts); the observation loop calls back through this face and
 * never imports the registry in reverse.
 */
export interface WatchRuntime {
  /** best-effort 刷目标会话。Best-effort flush of the target session. */
  readonly flushTarget: (record: WatchRecord) => Promise<void>
  /** 结清看守并投递通知。Retire the watch and deliver its notice. */
  readonly settle: (record: WatchRecord, outcome: SessionDispatchOutcome) => Promise<void>
}

/**
 * 武装一个看守所需的一切。Everything arming one watch needs.
 *
 * 一条派发一个看守，而且**一个目标同时只能有一个未结清的看守**：看守的判据是目标
 * 会话整体静止，若同一目标上再压一条派发，两个看守会在同一瞬间以同一段收尾输出定案，
 * 于是调用方收到两条逐字相同、谁也对不上的回报，而先跑那条任务的结果再也不会送达。
 * `arm()` 自己完成查账，所以调用方绕不过去。
 * One watch per dispatch, and **at most one unsettled watch per target**: the
 * verdict is the whole target session's quiescence, so a second dispatch onto the
 * same target would make two watches settle on the same closing output at the
 * same instant - the caller then receives two byte-identical notices that answer
 * neither dispatch, and the earlier task's result is never delivered at all.
 * `arm()` performs that check itself, so no caller can bypass it.
 */
export interface ArmingRequest {
  /** 目标 Agent。The target Agent. */
  readonly agent: Agent
  /** 调用方会话 id。The caller's session id. */
  readonly callerSessionId: SessionId
  /** 被投递消息的身份。Identity of the delivered prompt. */
  readonly messageId: string
  /** 被投递的提示原文。The delivered prompt. */
  readonly prompt: string
  /** 投递动作，在登记唤醒源之后、启动观察者之前执行。The delivery, run after the wake sources register and before the observer starts. */
  readonly deliver: () => void
}

/** 结算看守注册表。The settlement-watch registry. */
export interface SettlementWatch {
  /** 是否还能再接一个看守。Whether another watch fits the configured cap. */
  readonly hasCapacity: () => boolean
  /**
   * 先查账、再登记唤醒源、然后投递、最后启动观察者；四步同处一个同步块，顺序不可交换。
   * 目标上已有未结清看守时以 `SESSION_DISPATCH_WATCH_BUSY` 拒绝，且不登记、不投递。
   * Check the ledger, register the wake sources, run the delivery, then start the
   * observer; all four run in one synchronous block and the order is not
   * interchangeable. A target that already has an unsettled watch is refused with
   * `SESSION_DISPATCH_WATCH_BUSY`, registering nothing and delivering nothing.
   *
   * 查账留在这里而不是调用方：判据由注册表持有，登记动作自己把关，调用方绕不过去；两者
   * 又同处一个同步块，检查与登记之间不会被任何别的执行插进来。
   * The check lives here rather than in the caller: the registry owns the verdict
   * and the registering operation gates itself, so no caller can bypass it - and
   * sharing one synchronous block means nothing else runs between the check and
   * the registration.
   * @param request - 武装请求。The arming request.
   * @returns 看守句柄。The watch handle.
   */
  readonly arm: (request: ArmingRequest) => string
  /**
   * 投递一条不挂看守的派发（`report: false`）：查账与投递同处一个同步块，目标上已有未结清
   * 看守时拒绝且不投递。
   * Deliver a fire-and-forget dispatch (`report: false`): the check and the
   * delivery share one synchronous block, and a target with an unsettled watch is
   * refused without delivering.
   *
   * 非报告型派发没有可登记的看守，所以这一步同步查账是唯一挡住"提示被接进受看守会话、
   * 换掉那条报告将要描述的收尾输出"的东西。
   * A non-reporting dispatch has no watch to register, so this synchronous check is
   * the only thing stopping a prompt from being accepted into a watched session and
   * replacing what that report will describe as the closing output.
   * @param targetSessionId - 目标会话 id。The target session id.
   * @param deliver - 投递动作。The delivery.
   */
  readonly deliverGuarded: (targetSessionId: SessionId, deliver: () => void) => void
  /** 卸载：取消全部看守，不再回报。Unload: cancel every watch and stop reporting. */
  readonly dispose: () => void
}

/** 看守使用的配置面。The configuration the guard reads. */
export interface SettlementWatchConfig {
  readonly maxReportChars: number
  readonly maxConcurrentWatches: number
}
