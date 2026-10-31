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
 * Turn one successful catalog read into the ready snapshot the page renders.
 * 把一次成功的目录读取变成页面渲染的 ready 快照。
 * @param value - the Remote's catalog value.
 * @returns the ready snapshot.
 */
function readySnapshot(value: CatalogView): ForumCatalogSnapshot {
  return {
    catalog: {
      boards: value.boards ?? [],
      posts: value.posts ?? [],
      people: value.people ?? [],
      ...(value.boardId === undefined ? {} : { boardId: value.boardId }),
    },
    status: 'ready', settled: true, error: '',
  }
}

/**
 * The catalog source's machinery: the mutable read loop, its listeners, and
 * the poll timer. One instance serves one mounted page; the class replaces the
 * former closure so each concern is its own method.
 * 目录源背后的机构：可变的读取循环、监听者与轮询计时器。一个实例服务一个已挂载页面；
 * 类取代了原先的闭包，让每个关注点各自成为一个方法。
 */
class CatalogSource {
  private snapshot: ForumCatalogSnapshot = { catalog: emptyCatalog(), status: 'loading', settled: false, error: '' }
  private epoch = 0
  private inflight: Promise<void> | undefined
  private request: CatalogQuery = {}
  private timer: ReturnType<typeof globalThis.setInterval> | undefined
  private readonly registry = new Set<() => void>()

  /** @param api - the mounted `remote.forum` namespace. */
  constructor(private readonly api: ForumRemoteApi) {}

  /** The observable face the page binds through `useCatalog`. 页面经 `useCatalog` 绑定的可观察面。 */
  get observable(): HostObservable<ForumCatalogSnapshot> {
    return { getSnapshot: () => this.snapshot, subscribe: listener => this.subscribe(listener) }
  }

  /** Refresh on demand: where every write ends and the poll heartbeat lives. 按需刷新：每次写入的收尾，也是轮询心跳。 */
  readonly refresh = (next?: CatalogQuery): void => { void this.read(next) }

  /** Merge one partial snapshot and notify every listener. 合并一份部分快照并通知所有监听者。 */
  private publish(next: Partial<ForumCatalogSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of [...this.registry]) listener()
  }

  /**
   * Read the catalog once; overlapping reads collapse into the one flight.
   * 读一次目录；重叠的读取合并为同一次在途请求。
   * @param next - when given, the new request to read from scratch.
   * @returns the in-flight read, settled when the snapshot moved.
   */
  private read(next?: CatalogQuery): Promise<void> {
    if (next !== undefined) {
      this.request = next
      this.epoch += 1
      this.inflight = undefined
    }
    if (this.inflight !== undefined) return this.inflight
    const mine = this.epoch
    this.publish({ status: 'loading' })
    this.inflight = this.api.catalog(this.request).then(
      (result) => {
        if (mine !== this.epoch) return
        this.publish(result.ok
          ? readySnapshot(result.value)
          : { status: 'error', error: messageOf(result.error) })
      },
      (error: unknown) => {
        if (mine === this.epoch) this.publish({ status: 'error', error: messageOf(error) })
      },
    ).finally(() => {
      if (mine === this.epoch) this.inflight = undefined
    })
    return this.inflight
  }

  /** Start reading and polling when the first listener arrives. 第一个监听者到来时开始读取与轮询。 */
  private subscribe(listener: () => void): () => void {
    this.registry.add(listener)
    if (this.registry.size === 1) {
      void this.read()
      this.timer = globalThis.setInterval(() => { void this.read() }, POLL_MS)
    }
    return () => { this.unsubscribe(listener) }
  }

  /** Drop the last listener, stop the poll, and reset to the first value. 最后一个监听者离开时停止轮询并重置回初值。 */
  private unsubscribe(listener: () => void): void {
    this.registry.delete(listener)
    if (this.registry.size !== 0) return
    if (this.timer !== undefined) globalThis.clearInterval(this.timer)
    this.timer = undefined
    this.epoch += 1
    this.inflight = undefined
    this.snapshot = { catalog: emptyCatalog(), status: 'loading', settled: false, error: '' }
  }
}

/**
 * Build the catalog source over the Remote namespace.
 * @param api - the mounted `remote.forum` namespace.
 * @returns the observable and its refresh.
 */
export function createForumCatalog(api: ForumRemoteApi): ForumCatalog {
  const source = new CatalogSource(api)
  return { source: source.observable, refresh: source.refresh }
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
