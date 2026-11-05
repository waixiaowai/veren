/**
 * The page's single observable over the Remote namespace, plus the callbacks
 * the panel injects.
 *
 * One snapshot object is published to every listener; the catalog re-reads on
 * an interval while at least one listener is subscribed, so the panel stays
 * current without polling when nobody is looking.
 *
 * 页面对 Remote 命名空间的唯一可观察对象，外加面板注入的动作回调。
 *
 * 快照对象发布给所有订阅者；目录在仍有订阅者时按固定间隔重读，因此面板在有人看时保持最新，
 * 没人看时不必轮询。
 *
 * @module @veren/mail-ui/client/source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MailRemoteApi, MailSnapshot } from './remote.ts'

/** How long the open page waits between catalog re-reads, in milliseconds. */
const POLL_MS = 5_000

/**
 * The mutable state the source's closures share. `epoch` invalidates
 * in-flight reads; the timer lives here so the unsubscribe path can stop it.
 */
interface MailSourceState {
  snapshot: MailSnapshot
  epoch: number
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  listeners: Set<() => void>
}

/**
 * Publish one snapshot to every listener.
 *
 * 向每个订阅者发布一份快照。
 *
 * @param state - the shared source state / 共享的 source 状态
 * @param next - the fields to replace / 要替换的字段
 */
function publish(state: MailSourceState, next: Partial<MailSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.listeners]) listener()
}

/**
 * One catalog read; a stale read (a superseded epoch) is dropped. A transport
 * failure (a dropped socket under a reconnect, say) publishes the error
 * state instead of vanishing — the next poll tick or connection reset
 * recovers the panel on its own.
 *
 * 一次目录读取；过期读（epoch 已被超越）直接丢弃。传输失败（比如重连期间断开的 socket）
 * 会发布错误态而不是凭空消失——下一轮询 tick 或连接重置会让面板自行恢复。
 *
 * @param api - the Remote namespace / Remote 命名空间
 * @param state - the shared source state / 共享的 source 状态
 * @param mine - the epoch this read belongs to / 本次读取所属的 epoch
 */
async function readCatalog(api: MailRemoteApi, state: MailSourceState, mine: number): Promise<void> {
  let result: Awaited<ReturnType<MailRemoteApi['catalog']>>
  try {
    result = await api.catalog({})
  } catch (error: unknown) {
    if (mine !== state.epoch) return
    publish(state, { status: 'error', error: error instanceof Error ? error.message : String(error) })
    return
  }
  if (mine !== state.epoch) return
  if (!result.ok) {
    publish(state, { status: 'error', error: result.error.message })
    return
  }
  publish(state, {
    messages: result.value.messages,
    runs: result.value.runs,
    status: 'ready',
    settled: true,
    error: '',
  })
}

/**
 * Kick one catalog read; a source that never settled shows loading again.
 *
 * 发起一次目录读取；尚未落定的 source 重新进入 loading。
 *
 * @param api - the Remote namespace / Remote 命名空间
 * @param state - the shared source state / 共享的 source 状态
 */
function load(api: MailRemoteApi, state: MailSourceState): void {
  state.epoch += 1
  const mine = state.epoch
  if (!state.snapshot.settled) publish(state, { status: 'loading' })
  void readCatalog(api, state, mine)
}

/**
 * The first listener starts the polling; the unsubscribe path cleans up.
 *
 * 第一个订阅者启动轮询；取消订阅路径负责清理。
 *
 * @param api - the Remote namespace / Remote 命名空间
 * @param state - the shared source state / 共享的 source 状态
 * @param listener - the listener to add / 要加入的订阅者
 * @returns the disposer that removes it / 移除它的 disposer
 */
function subscribe(api: MailRemoteApi, state: MailSourceState, listener: () => void): () => void {
  state.listeners.add(listener)
  if (state.listeners.size === 1) {
    load(api, state)
    state.timer = globalThis.setInterval(() => load(api, state), POLL_MS)
  }
  return () => { unsubscribe(state, listener) }
}

/**
 * One listener left: stop the timer, and stop everything for the last one.
 *
 * 一个订阅者离开：停止定时器；最后一个离开时停止一切。
 *
 * @param state - the shared source state / 共享的 source 状态
 * @param listener - the listener to remove / 要移除的订阅者
 */
function unsubscribe(state: MailSourceState, listener: () => void): void {
  state.listeners.delete(listener)
  if (state.listeners.size !== 0) return
  if (state.timer !== undefined) globalThis.clearInterval(state.timer)
  state.timer = undefined
  state.epoch += 1
}

/**
 * Build the page's single observable over the Remote namespace.
 *
 * 基于 Remote 命名空间构建页面的唯一可观察对象。
 *
 * @param api - the Remote namespace / Remote 命名空间
 * @returns the observable and the panel's callbacks / 可观察对象与面板回调
 */
export function createMailSource(api: MailRemoteApi): {
  readonly source: HostObservable<MailSnapshot>
  readonly refresh: () => void
  readonly mark: (messageId: string, action: 'read' | 'unread' | 'archive' | 'unarchive') => void
} {
  const state: MailSourceState = {
    snapshot: { messages: [], runs: [], settled: false, status: 'loading', error: '' },
    epoch: 0,
    timer: undefined,
    listeners: new Set(),
  }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: (listener) => subscribe(api, state, listener),
    },
    refresh: () => { load(api, state) },
    mark: (messageId, action) => {
      void api.markMessage({ messageId, action }).then(() => { load(api, state) })
    },
  }
}
