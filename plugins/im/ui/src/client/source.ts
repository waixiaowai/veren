/**
 * The page's single observable over the Remote namespace, plus the bind
 * wizard's poll loop and the action callbacks the panel injects.
 *
 * One snapshot object is published to every listener; the catalog re-reads on a
 * 5s interval while at least one listener is subscribed, and the bind wizard
 * polls on its own 2s interval until it reaches a terminal state.
 *
 * 页面对 Remote 命名空间的唯一可观察对象，外加绑定向导的轮询循环与面板注入的动作回调。
 *
 * 快照对象发布给所有监听者；目录在仍有订阅者时按 5s 间隔重读，绑定向导按自己的 2s 间隔
 * 轮询直到终态。
 *
 * @module @veren/im-ui/client/source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImRemoteApi, ImSnapshot } from './remote.ts'

/** How long the open page waits between catalog re-reads, in milliseconds. */
/** 打开的页面两次目录重读之间的等待时长（毫秒）。 */
const POLL_MS = 5_000

/** How long the bind wizard waits between bind polls while open. */
/** 绑定向导打开时两次 bind 轮询之间的等待时长（毫秒）。 */
const BIND_POLL_MS = 2_000

/**
 * Mutable state shared by the source's closures. `epoch` invalidates in-flight
 * catalog reads; the timers live here so the unsubscribe path can stop them.
 * source 各闭包共享的可变状态。`epoch` 使在途目录读失效；定时器也放在这里，
 * 供取消订阅路径停止。
 */
interface ImSourceState {
  snapshot: ImSnapshot
  epoch: number
  catalogTimer: ReturnType<typeof globalThis.setInterval> | undefined
  bindTimer: ReturnType<typeof globalThis.setInterval> | undefined
  listeners: Set<() => void>
}

/** The intake view shape before the first catalog lands. */
/** 首次目录数据到达之前的采集视图形状。 */
function emptyIntake(): ImSnapshot['catalog']['intake'] {
  return {
    enabled: false,
    askText: '',
    replyWindowMs: 120_000,
    maxAsksPerHour: 10,
    minAskIntervalMs: 0,
    counts: { asked: 0, answered: 0, declined: 0, expired: 0 },
    recent: [],
  }
}

/** Merge one partial snapshot and notify every listener. */
/** 合并一份部分快照并通知所有监听者。 */
function publish(state: ImSourceState, next: Partial<ImSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.listeners]) listener()
}

/** One catalog read; stale reads (superseded epochs) are dropped. */
/** 一次目录读取；过期读（epoch 已被超越）直接丢弃。 */
async function readCatalog(api: ImRemoteApi, state: ImSourceState, mine: number): Promise<void> {
  const result = await api.catalog({})
  if (mine !== state.epoch) return
  if (!result.ok) {
    publish(state, { status: 'error', error: result.error.message })
    return
  }
  publish(state, { catalog: result.value, status: 'ready', settled: true, error: '' })
}

/** Kick one catalog read; a not-yet-settled source shows loading again. */
/** 发起一次目录读取；尚未落定的 source 重新进入 loading。 */
function load(api: ImRemoteApi, state: ImSourceState): void {
  state.epoch += 1
  const mine = state.epoch
  if (!state.snapshot.settled) publish(state, { status: 'loading' })
  void readCatalog(api, state, mine)
}

/** Stop the bind poll timer, if one is running. */
/** 停止 bind 轮询定时器（如果在跑）。 */
function stopBindTimer(state: ImSourceState): void {
  if (state.bindTimer === undefined) return
  globalThis.clearInterval(state.bindTimer)
  state.bindTimer = undefined
}

/** The live epoch, for the bind poll's staleness guard (carried over verbatim). */
/** 当前 epoch，供 bind 轮询的新鲜度守卫使用（原样保留）。 */
function liveEpochOf(state: ImSourceState): number {
  return state.epoch
}

/** One bind poll; terminal states stop the timer and refresh the catalog. */
/** 一次 bind 轮询；终态会停止定时器并刷新目录。 */
async function pollBind(api: ImRemoteApi, state: ImSourceState, bindId: string): Promise<void> {
  const result = await api.pollBind({ bindId })
  if (liveEpochOf(state) !== state.epoch || state.snapshot.bind?.bindId !== bindId) return
  if (!result.ok) {
    publish(state, { bind: { ...state.snapshot.bind!, status: 'failed', error: result.error } })
    stopBindTimer(state)
    return
  }
  publish(state, { bind: result.value })
  if (result.value.status === 'bound' || result.value.status === 'expired' || result.value.status === 'failed') {
    stopBindTimer(state)
    void readCatalog(api, state, state.epoch)
  }
}

/** Open the bind wizard: begin the QR bind and start polling it. */
/** 打开绑定向导：发起 QR 绑定并开始轮询。 */
async function startBind(api: ImRemoteApi, state: ImSourceState): Promise<void> {
  const result = await api.beginBind({ label: 'WeChat' })
  if (!result.ok) {
    publish(state, { bind: { bindId: '', status: 'failed', error: result.error } })
    return
  }
  publish(state, { bind: result.value })
  stopBindTimer(state)
  state.bindTimer = globalThis.setInterval(() => void pollBind(api, state, result.value.bindId), BIND_POLL_MS)
}

/** Submit the verify code for the open bind attempt. */
/** 为打开中的绑定尝试提交验证码。 */
async function submitCode(api: ImRemoteApi, state: ImSourceState, code: string): Promise<void> {
  const bind = state.snapshot.bind
  if (bind === undefined) return
  const result = await api.submitBindCode({ bindId: bind.bindId, code })
  if (!result.ok) {
    publish(state, { bind: { ...bind, error: result.error } })
    return
  }
  publish(state, { bind: result.value })
}

/** One listener left: stop the bind timer, and stop everything for the last one. */
/** 一个监听者离开：停止 bind 定时器；最后一个离开时停止一切。 */
function unsubscribe(state: ImSourceState, listener: () => void): void {
  state.listeners.delete(listener)
  stopBindTimer(state)
  if (state.listeners.size !== 0) return
  if (state.catalogTimer !== undefined) globalThis.clearInterval(state.catalogTimer)
  state.catalogTimer = undefined
  state.epoch += 1
}

/** First listener starts the catalog polling; the unsubscribe path cleans up. */
/** 第一个监听者启动目录轮询；取消订阅路径负责清理。 */
function subscribe(api: ImRemoteApi, state: ImSourceState, listener: () => void): () => void {
  state.listeners.add(listener)
  if (state.listeners.size === 1) {
    load(api, state)
    state.catalogTimer = globalThis.setInterval(() => load(api, state), POLL_MS)
  }
  return () => { unsubscribe(state, listener) }
}

/** Build the page's single observable over the Remote namespace. */
/** 基于 Remote 命名空间构建页面的唯一可观察对象。 */
export function createImSource(api: ImRemoteApi): {
  readonly source: HostObservable<ImSnapshot>
  readonly startBind: () => void
  readonly closeBind: () => void
  readonly submitCode: (code: string) => void
  readonly unbindAccount: (accountId: string) => void
  readonly renamePerson: (personId: string, displayName: string) => void
  readonly refresh: () => void
} {
  const state: ImSourceState = {
    snapshot: {
      catalog: { accounts: [], conversations: [], people: [], intake: emptyIntake() },
      status: 'loading', settled: false, error: '', bind: undefined,
    },
    epoch: 0,
    catalogTimer: undefined,
    bindTimer: undefined,
    listeners: new Set(),
  }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: listener => subscribe(api, state, listener),
    },
    startBind: () => { void startBind(api, state) },
    closeBind: () => {
      stopBindTimer(state)
      publish(state, { bind: undefined })
    },
    submitCode: code => { void submitCode(api, state, code) },
    unbindAccount: accountId => {
      void api.unbindAccount({ accountId }).then(() => { stopBindTimer(state); load(api, state) })
    },
    renamePerson: (personId, displayName) => {
      void api.renamePerson({ personId, displayName }).then(() => load(api, state))
    },
    refresh: () => { load(api, state) },
  }
}
