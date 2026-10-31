// 结算看守的观察面：唤醒源登记（watchTarget）与常驻观察循环（observe）。
// The settlement watch's observation face: wake-source registration
// (watchTarget) and the standing observation loop (observe).
//
// 本文件不含任何注册表状态：观察循环经 WatchRuntime 回调注册表的 flush/settle，
// 判定与唤醒令牌取自 watch-contract.ts，结束原因取自 watch-outcome.ts。
// This file holds no registry state: the observation loop calls the registry's
// flush/settle back through WatchRuntime, the verdict and the wake token come
// from watch-contract.ts, and the stop reason comes from watch-outcome.ts.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionDispatchOutcome } from './types.js'
import { wake } from './watch-contract.js'
import type { Deferred, SettlementState, WatchRecord, WatchRuntime } from './watch-contract.js'
import { stopReasonOf } from './watch-outcome.js'

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
 * @param ctx - 插件 Context。The plugin Context.
 * @param runtime - 注册表回调面。The registry callback face.
 * @param record - 看守记录。The watch record.
 * @param agent - 目标 Agent。The target Agent.
 * @returns 观察结束。Resolves when the watch closed.
 */
export async function observe(ctx: Context, runtime: WatchRuntime, record: WatchRecord, agent: Agent): Promise<void> {
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
      await runtime.flushTarget(record)
      await runtime.settle(record, 'target-gone')
      return
    }
    const state = settlementState(record, agent, observation)
    if (state === 'closed') return
    if (state === 'retry') continue
    if (state === 'wait') {
      await observation.promise
      continue
    }
    if (await recheckBeforeFinalize(runtime, record, agent, observation)) return
  }
}

/**
 * 收尾前的复查，与官方 watchLocalSettlement 的 ready 分支同一手法：记住当时的
 * seq，best-effort flush，然后**重新**判定——状态或 seq 只要动过就回到循环重判，
 * 绝不拿着 flush 之前的结论去报告。返回 true 表示观察结束（已结清或已回报）。
 * The pre-finalization re-check, the official watchLocalSettlement ready branch
 * move: remember the seq, best-effort flush, then decide AGAIN - if either the
 * state or the seq moved, the caller goes back around instead of reporting the
 * conclusion reached before the flush. Returns true when the observation is over
 * (settled or reported).
 * @param runtime - 注册表回调面。The registry callback face.
 * @param record - 看守记录。The watch record.
 * @param agent - 目标 Agent。The target Agent.
 * @param observation - 本次等待开始时的令牌。The token captured when this wait began.
 * @returns 观察是否结束。Whether the observation ended.
 */
async function recheckBeforeFinalize(
  runtime: WatchRuntime,
  record: WatchRecord,
  agent: Agent,
  observation: Deferred,
): Promise<boolean> {
  const finalSeq = agent.session.seq
  await runtime.flushTarget(record)
  if (record.settled) return true
  if (settlementState(record, agent, observation) !== 'ready') return false
  if (agent.session.seq !== finalSeq) return false
  await runtime.settle(record, stopReasonOf(record.events, record.failureAt))
  return true
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
export function watchTarget(record: WatchRecord, agent: Agent): void {
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
