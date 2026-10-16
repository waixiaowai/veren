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

/**
 * Build the catalog source over one Remote read.
 * @param deps - read and invalidation subscriptions.
 * @returns the observable and its manual refresh.
 */
export function createStartupCatalog(deps: StartupCatalogDeps): StartupCatalog {
  let snapshot: StartupCatalogSnapshot = { records: [], status: 'loading', settled: false }
  let disposers: (() => void)[] = []
  let epoch = 0
  let inflight: Promise<void> | undefined
  const registry = new Set<() => void>()

  const publish = (next: Partial<StartupCatalogSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...registry]) listener()
  }

  const read = (): Promise<void> => {
    if (inflight !== undefined) return inflight
    const mine = epoch
    publish({ status: 'loading' })
    inflight = deps.list().then(
      (result) => {
        if (mine !== epoch) return
        publish(result.ok
          ? { records: result.value, status: 'ready', settled: true }
          : { status: 'error' })
      },
      () => {
        if (mine === epoch) publish({ status: 'error' })
      },
    ).finally(() => {
      if (mine === epoch) inflight = undefined
    })
    return inflight
  }

  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        registry.add(listener)
        if (registry.size === 1) {
          disposers = [deps.subscribeChanged(() => { void read() }), deps.subscribeReset(() => { void read() })]
          void read()
        }
        return () => {
          registry.delete(listener)
          if (registry.size !== 0) return
          for (const dispose of disposers) dispose()
          disposers = []
          epoch += 1
          inflight = undefined
          snapshot = { records: [], status: 'loading', settled: false }
        }
      },
    },
    refresh: () => { void read() },
  }
}
