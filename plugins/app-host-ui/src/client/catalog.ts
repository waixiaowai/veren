/**
 * The catalog observable: one Host-backed snapshot of the installed apps.
 *
 * The dropdown reads the catalog through this source object wrapped as a
 * HostObservable (`{ getSnapshot, subscribe }`, both identities stable), so it
 * arrives through the inject `hooks` compartment and the renderer binds it to
 * a `use<Name>` hook — the component never sees the remote or any subscription
 * machinery. Reads are pull-based with explicit refreshes on connection
 * resets; the catalog changes only when plugins install or unload, so no
 * polling is needed.
 *
 * 目录可观察对象：一份宿主支撑的已装应用快照。下拉经由包装成 HostObservable
 * （`{ getSnapshot, subscribe }`，两个身份都稳定）的这个源对象读目录，因此它走
 * inject 的 `hooks` 面下发，渲染器把它绑成 `use<Name>` 钩子——组件既看不到
 * remote 也看不到订阅机制。读取是拉取式，连接重置时显式刷新；目录只在插件
 * 安装/卸载时变化，因此无需轮询。
 * @module @veren/app-host-ui/client/catalog
 */

import type { AppEntryView, AppHostRemoteApi } from './remote.ts'

/** One catalog snapshot the dropdown renders. */
export interface AppCatalogSnapshot {
  readonly state: 'loading' | 'ready' | 'failed'
  readonly apps: readonly AppEntryView[]
  /** Present when state is 'failed': why the catalog is unreadable. */
  readonly error?: { readonly code: string; readonly message: string }
}

/** The stable observable source the inject face hands to the renderer. */
export interface AppCatalogSource {
  getSnapshot(): AppCatalogSnapshot
  subscribe(listener: () => void): () => void
  /** Re-read the catalog now (connection reset, retry button). */
  refresh(): void
  /** Release the invalidation listener; the disposer is idempotent and fiber-scoped. */
  dispose(): () => void
}

const LOADING: AppCatalogSnapshot = { state: 'loading', apps: [] }

/** Build one catalog source over the mounted `appHost` remote. */
export function createAppCatalog(remote: AppHostRemoteApi, onInvalidate: (listener: () => void) => () => void): AppCatalogSource {
  let snapshot: AppCatalogSnapshot = LOADING
  const listeners = new Set<() => void>()
  const publish = (next: AppCatalogSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  let reading = false
  const read = (): void => {
    if (reading) return
    reading = true
    void remote.catalog().then((result) => {
      reading = false
      publish(result.ok
        ? { state: 'ready', apps: result.value }
        : { state: 'failed', apps: [], error: result.error })
    })
  }
  read()
  const disposeInvalidate = onInvalidate(read)
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh: read,
    dispose: () => disposeInvalidate,
  }
}
