/**
 * The panel's authoritative item catalog.
 *
 * One source serves the whole page: it reads `startup/catalog` through the
 * mounted Remote namespace and re-reads whenever the Host reports a durable
 * change (`startup-autostart/changed`) or the transport generation is replaced
 * (a reconnect). Its observable follows the Client rule that the snapshot keeps
 * its identity until a fact moves, so components re-render only on real change.
 *
 * Reads are shared: a commit that mounts several consumers still issues one
 * call. A read that resolves after its subscription went away is discarded by
 * epoch, so a closed panel cannot publish over a live one.
 *
 * 面板的权威启动项目录。一个源服务整个页面：通过挂载的 Remote 命名空间读
 * `startup/catalog`，并在宿主报告持久化变更（`startup-autostart/changed`）或连接代
 * 重置（重连）时重读。可观察对象遵循客户端规则：事实未变时快照引用保持不变，因此只有真
 * 正变化才会触发重渲染。读取会共享：同一个提交里挂载多个消费者也只发一次调用；订阅已
 * 消失后才返回的读取会按 epoch 丢弃，关闭的面板不会覆盖活着的面板。
 *
 * 实现按步骤拆分：广播、读取、订阅/退订各自是模块级函数，经 CatalogState 共享
 * 可变状态。
 * The implementation is split by step: publish, read, and subscribe/unsubscribe
 * are module-level functions sharing mutable state through CatalogState.
 *
 * @module @veren/startup-autostart/client/catalog
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupItemView, StartupRemoteResult } from './remote.ts'

/** What the panel renders from the catalog. */
export interface StartupCatalogSnapshot {
  /** Items of the last successful read, newest state first as the Host ordered them. */
  readonly records: readonly StartupItemView[]
  /** Read state; a refresh republishes `loading` over the previous records. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Whether an authoritative read has ever succeeded. */
  readonly settled: boolean
}

/** The Remote read and the invalidations this catalog follows. */
export interface StartupCatalogDeps {
  /** Read every stored item. */
  readonly list: () => Promise<StartupRemoteResult<readonly StartupItemView[]>>
  /**
   * Subscribe to the Host's durable-change notification.
   *
   * The Host emits `startup-autostart/changed` after every committed write, and
   * the Web application forwards it because the event is on its allowlist
   * (`packages/api/remotes/src/remote-events.ts`). An item the model registers
   * with `startup_create` therefore appears without user action.
   */
  readonly subscribeChanged: (listener: () => void) => () => void
  /** Subscribe to a replaced transport generation, which invalidates every read. */
  readonly subscribeReset: (listener: () => void) => () => void
}

/** Catalog observable plus the manual refresh a failure offers. */
export interface StartupCatalog {
  /** Observable snapshot consumed through an injected hook. */
  readonly source: HostObservable<StartupCatalogSnapshot>
  /** Re-read the catalog, for the retry affordance. */
  readonly refresh: () => void
}

/** 目录源的内部可变状态。Internal mutable state of the catalog source. */
interface CatalogState {
  snapshot: StartupCatalogSnapshot
  disposers: (() => void)[]
  epoch: number
  inflight: Promise<void> | undefined
  readonly registry: Set<() => void>
}

/** 初值/复位快照；每次调用都给新对象，保持原来的引用语义。The initial/reset snapshot; a new object per call keeps the original reference semantics. */
const initialSnapshot = (): StartupCatalogSnapshot => ({ records: [], status: 'loading', settled: false })

/** 向全部监听者广播一次快照更新。Broadcast one snapshot update to every listener. */
function publishSnapshot(state: CatalogState, next: Partial<StartupCatalogSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.registry]) listener()
}

/**
 * 读一次目录：并发读合并为一次，epoch 已前进的过期读按丢弃处理。
 * Read the catalog once: concurrent reads coalesce into one, and a read whose
 * epoch has moved on is discarded.
 */
function readCatalog(deps: StartupCatalogDeps, state: CatalogState): Promise<void> {
  if (state.inflight !== undefined) return state.inflight
  const mine = state.epoch
  publishSnapshot(state, { status: 'loading' })
  state.inflight = deps.list().then(
    (result) => {
      if (mine !== state.epoch) return
      publishSnapshot(state, result.ok
        ? { records: result.value, status: 'ready', settled: true }
        : { status: 'error' })
    },
    () => {
      if (mine === state.epoch) publishSnapshot(state, { status: 'error' })
    },
  ).finally(() => {
    if (mine === state.epoch) state.inflight = undefined
  })
  return state.inflight
}

/** 末位退订：逆序清理失效源、前进 epoch 并复位快照。Last unsubscribe: unwind the invalidation sources in reverse, advance the epoch, and reset the snapshot. */
function unsubscribeCatalog(state: CatalogState, listener: () => void): void {
  state.registry.delete(listener)
  if (state.registry.size !== 0) return
  for (const dispose of state.disposers) dispose()
  state.disposers = []
  state.epoch += 1
  state.inflight = undefined
  state.snapshot = initialSnapshot()
}

/** 首订阅登记失效源并首读，返回退订句柄。The first subscriber registers the invalidation sources and starts the first read; returns the unsubscriber. */
function subscribeCatalog(deps: StartupCatalogDeps, state: CatalogState, listener: () => void): () => void {
  state.registry.add(listener)
  if (state.registry.size === 1) {
    state.disposers = [
      deps.subscribeChanged(() => { void readCatalog(deps, state) }),
      deps.subscribeReset(() => { void readCatalog(deps, state) }),
    ]
    void readCatalog(deps, state)
  }
  return () => { unsubscribeCatalog(state, listener) }
}

/**
 * Build the catalog source over one Remote read.
 * @param deps - read and invalidation subscriptions.
 * @returns the observable and its manual refresh.
 */
export function createStartupCatalog(deps: StartupCatalogDeps): StartupCatalog {
  const state: CatalogState = { snapshot: initialSnapshot(), disposers: [], epoch: 0, inflight: undefined, registry: new Set() }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: listener => subscribeCatalog(deps, state, listener),
    },
    refresh: () => { void readCatalog(deps, state) },
  }
}
