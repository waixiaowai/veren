/**
 * The page's authoritative forum catalog.
 *
 * One source serves the whole page: a read issues the `forum/catalog` call,
 * registers nothing, and re-reads on a slow poll. The forwarded-Host-event
 * allowlist belongs to the shipped application and cannot be extended from an
 * installed bundle, so freshness comes from that poll plus a re-read after every
 * write instead of a pushed event; the observable keeps its snapshot identity
 * between real changes, so the poll costs nothing when nothing moved.
 *
 * 页面的权威论坛目录。
 *
 * 一个源服务整个页面：一次读取发出 `forum/catalog` 调用、不做别的登记，并按慢节拍重读。转发
 * 宿主事件的白名单属于随发行版交付的应用、无法从已安装的组合包扩展，因此新鲜度来自该节拍加
 * 每次写入后的重读，而不是推送事件；快照在真正变化之间保持同一引用，因此没有变化时节拍不产生
 * 开销。
 *
 * @module @veren/forum-ui/client/catalog
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AutoPostSnapshot, CatalogQuery, CatalogView, ForumRemoteApi, NotificationView, PostDetailView,
} from './remote.ts'

/** How long a mounted page waits before re-reading, in milliseconds. */
const POLL_MS = 10_000

/** Read state the page renders. */
export interface ForumCatalogSnapshot {
  /** The last successful read, or the empty first value. */
  readonly catalog: CatalogView
  /** `loading` is republished over the previous value on every refresh. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Whether an authoritative read has ever succeeded. */
  readonly settled: boolean
  /** The last failure's message, for the page's error line. */
  readonly error: string
}

/** The observable plus the manual refresh every write ends with. */
export interface ForumCatalog {
  readonly source: HostObservable<ForumCatalogSnapshot>
  readonly refresh: (request?: CatalogQuery) => void
}

/** An empty catalog, so the page always has something to render. */
function emptyCatalog(): CatalogView {
  return { boards: [], posts: [], people: [] }
}

/**
 * Build the catalog source over the Remote namespace.
 * @param api - the mounted `remote.forum` namespace.
 * @returns the observable and its refresh.
 */
export function createForumCatalog(api: ForumRemoteApi): ForumCatalog {
  let snapshot: ForumCatalogSnapshot = { catalog: emptyCatalog(), status: 'loading', settled: false, error: '' }
  let epoch = 0
  let inflight: Promise<void> | undefined
  let request: CatalogQuery = {}
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  const registry = new Set<() => void>()

  const publish = (next: Partial<ForumCatalogSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...registry]) listener()
  }

  const read = (next?: CatalogQuery): Promise<void> => {
    if (next !== undefined) {
      request = next
      epoch += 1
      inflight = undefined
    }
    if (inflight !== undefined) return inflight
    const mine = epoch
    publish({ status: 'loading' })
    inflight = api.catalog(request).then(
      (result) => {
        if (mine !== epoch) return
        publish(result.ok
          ? {
            catalog: {
              boards: result.value.boards ?? [],
              posts: result.value.posts ?? [],
              people: result.value.people ?? [],
              ...(result.value.boardId === undefined ? {} : { boardId: result.value.boardId }),
            },
            status: 'ready', settled: true, error: '',
          }
          : { status: 'error', error: messageOf(result.error) })
      },
      (error: unknown) => {
        if (mine === epoch) publish({ status: 'error', error: messageOf(error) })
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
          void read()
          timer = globalThis.setInterval(() => { void read() }, POLL_MS)
        }
        return () => {
          registry.delete(listener)
          if (registry.size !== 0) return
          if (timer !== undefined) globalThis.clearInterval(timer)
          timer = undefined
          epoch += 1
          inflight = undefined
          snapshot = { catalog: emptyCatalog(), status: 'loading', settled: false, error: '' }
        }
      },
    },
    refresh: (next) => { void read(next) },
  }
}

/**
 * Read one post with its comment tree. 仅供测试/对外契约 / test-only / external contract.
 */
export async function readPost(
  api: ForumRemoteApi, postId: string, reader: string | undefined,
): Promise<PostDetailView> {
  const result = await api.post(reader === undefined ? { postId } : { postId, reader })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Read one preset's notifications. */
export async function readInbox(api: ForumRemoteApi, recipient: string): Promise<readonly NotificationView[]> {
  const result = await api.inbox({ recipient })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Read the auto-post settings and what the runner is doing. 仅供测试/对外契约 / test-only / external contract. */
export async function readAutoPost(api: ForumRemoteApi): Promise<AutoPostSnapshot> {
  const result = await api.autoPost({})
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Render one failure as a single line. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}
