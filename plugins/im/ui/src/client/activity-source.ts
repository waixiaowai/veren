/**
 * The panel's live-activity observable: one poll loop over `imTurn.activity`,
 * adaptive between "something is running" (fast) and "nothing is running"
 * (slow — a run may start at any moment, from this page or from a channel, so
 * the loop never stops while the tab is open).
 *
 * Failures are silent by design: the working row is advisory, and a poll that
 * cannot reach the host must not paint an error over a healthy timeline.
 *
 * 面板的实时活动可观察对象：`imTurn.activity` 之上的一条轮询循环，在「有东西在跑」（快）与
 * 「没有东西在跑」（慢——运行随时可能开始，可能来自本页也可能来自渠道，所以页面开着时循环
 * 不停）之间自适应。
 *
 * 失败刻意静默：工作行只是提示，读不到宿主的轮询绝不能把错误画到健康的时间线上。
 *
 * @module @veren/im-ui/client/activity-source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImTurnApi, RoomActivity } from './turn-remote.ts'

/** Poll cadence while at least one turn runs, in milliseconds. */
/** 至少一个回合在跑时的轮询节奏（毫秒）。 */
const ACTIVE_POLL_MS = 1_200

/** Poll cadence while nothing runs, in milliseconds. */
/** 没有回合在跑时的轮询节奏（毫秒）。 */
const IDLE_POLL_MS = 3_000

/** The activity observable's snapshot: the live turns, oldest first. */
/** 活动可观察对象的快照：实时回合，从旧到新。 */
export interface ActivitySnapshot {
  readonly runs: readonly RoomActivity[]
}

/** Mutable state shared by the source's closures. */
/** source 各闭包共享的可变状态。 */
interface ActivityState {
  snapshot: ActivitySnapshot
  timer: ReturnType<typeof globalThis.setTimeout> | undefined
  inFlight: boolean
  listeners: Set<() => void>
}

/** A cheap identity for one run's rendered state: a change means a re-render. */
/** 一次运行渲染状态的廉价标识：变了就要重渲染。 */
function stampOf(run: RoomActivity): string {
  return `${run.runId}\u0000${run.phase}\u0000${run.toolName ?? ''}\u0000${run.updatedAt}`
}

/** Whether two run lists render identically. */
/** 两份运行清单是否渲染成同一结果。 */
function sameRuns(left: readonly RoomActivity[], right: readonly RoomActivity[]): boolean {
  return left.length === right.length && left.every((run, index) => stampOf(run) === stampOf(right[index]!))
}

/** Replace the snapshot and notify listeners only when something changed. */
/** 只有内容变化时才替换快照并通知监听者。 */
function publish(state: ActivityState, runs: readonly RoomActivity[]): void {
  if (sameRuns(state.snapshot.runs, runs)) return
  state.snapshot = { runs }
  for (const listener of [...state.listeners]) listener()
}

/** Schedule the next poll, or stop when the last listener left. */
/** 安排下一次轮询；最后一个监听者离开时停止。 */
function schedule(api: ImTurnApi, state: ActivityState): void {
  if (state.listeners.size === 0) return
  const delay = state.snapshot.runs.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS
  state.timer = globalThis.setTimeout(() => { void poll(api, state) }, delay)
}

/** One read; a refusal keeps the previous snapshot and the loop going. */
/** 一次读取；被拒时保留上一份快照并继续循环。 */
async function poll(api: ImTurnApi, state: ActivityState): Promise<void> {
  if (state.inFlight) return
  state.inFlight = true
  try {
    const result = await api.activity({})
    if (result.ok) publish(state, result.value.runs)
  } catch {
    // The host refused the read (namespace not mounted, turn domain absent):
    // keep the previous snapshot rather than blanking a healthy timeline.
    // 宿主拒绝了这次读取（命名空间未挂载、回合域缺失）：保留上一份快照，而不是把健康的时间线清空。
  } finally {
    state.inFlight = false
    state.timer = undefined
    schedule(api, state)
  }
}

/** First listener starts the loop; the last one leaving stops it. */
/** 第一个监听者启动循环；最后一个离开时停止。 */
function subscribe(api: ImTurnApi, state: ActivityState, listener: () => void): () => void {
  state.listeners.add(listener)
  if (state.listeners.size === 1) void poll(api, state)
  return () => {
    state.listeners.delete(listener)
    if (state.listeners.size !== 0) return
    if (state.timer !== undefined) globalThis.clearTimeout(state.timer)
    state.timer = undefined
  }
}

/**
 * Build the activity observable over one `imTurn` namespace.
 * 在一个 `imTurn` 命名空间之上构建活动可观察对象。
 * @param api - the mounted turn namespace.
 * @returns the observable the panel binds as `useActivity`, plus the
 *   after-send refresh that makes the working row appear immediately.
 */
export function createActivitySource(api: ImTurnApi): {
  readonly source: HostObservable<ActivitySnapshot>
  readonly refresh: () => void
} {
  const state: ActivityState = {
    snapshot: { runs: [] },
    timer: undefined,
    inFlight: false,
    listeners: new Set(),
  }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: listener => subscribe(api, state, listener),
    },
    // 发出消息之后立刻问一次：工作行不该等到下一轮慢轮询才出现。
    // Ask right after a send: the working row must not wait for the slow idle poll.
    refresh: () => {
      if (state.inFlight || state.listeners.size === 0) return
      if (state.timer !== undefined) globalThis.clearTimeout(state.timer)
      state.timer = undefined
      void poll(api, state)
    },
  }
}
