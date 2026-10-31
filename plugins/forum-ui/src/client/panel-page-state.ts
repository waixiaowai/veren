/**
 * The forum page body's state stage: the feed filters, the reader-scoped
 * caches, the workspace→board registration, the write runner, and the two
 * contracts — {@link ForumPageState} (what the page holds) and
 * {@link ForumPageOps} (what the page does) — that the actions and the view
 * bind against.
 *
 * 论坛页面体的状态阶段：信息流筛选、读者本地缓存、工作区→板块登记、写入簿记，以及两个
 * 契约——{@link ForumPageState}（页面持有什么）与 {@link ForumPageOps}（页面做什么）——
 * 动作与视图都绑在它们之上。
 *
 * @module @veren/forum-ui/client/panel-page-state
 */

import { useEffect, useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  AutoPostSettings, AutoPostSnapshot, CatalogQuery, CatalogView, NotificationView, PersonView,
  PostDetailView, PostSort,
} from './remote.ts'
import type { ForumCatalog, ForumCatalogSnapshot } from './catalog.ts'
import { messageOf } from './catalog.ts'
import type { ForumKey } from './locales.ts'
import type { CommentInput, PublishInput } from './panel-model.ts'
import type { Toast, ToastCenter } from './panel-kit.tsx'

/** The feed's four filters and their setters. 信息流的四个筛选器与设置器。 */
export interface FeedFilters {
  readonly boardId: string | undefined
  readonly setBoardId: (id: string) => void
  readonly query: string
  readonly setQuery: (value: string) => void
  readonly tag: string
  readonly setTag: (value: string) => void
  readonly sort: PostSort
  readonly setSort: (value: PostSort) => void
}

/** Hold the four feed filters. 持有信息流的四个筛选器。 */
export function useFeedFilters(): FeedFilters {
  const [boardId, setBoardId] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<PostSort>('heat')
  return { boardId, setBoardId, query, setQuery, tag, setTag, sort, setSort }
}

/** The reader-scoped caches: locally cast votes plus the read inbox. 读者本地的缓存：本地投出的票与已读的收件箱。 */
export interface ReaderCache {
  readonly localVotes: Readonly<Record<string, 'up' | 'down'>>
  readonly setLocalVotes: (
    update: (votes: Readonly<Record<string, 'up' | 'down'>>) => Readonly<Record<string, 'up' | 'down'>>,
  ) => void
  readonly inbox: readonly NotificationView[]
  readonly setInbox: (items: readonly NotificationView[]) => void
  readonly inboxLoaded: boolean
  readonly setInboxLoaded: (loaded: boolean) => void
}

/** Hold the reader caches; a different reader drops them all. 持有读者缓存；换读者即全部丢弃。 */
export function useReaderCache(active: string | undefined): ReaderCache {
  const [localVotes, setLocalVotes] = useState<Readonly<Record<string, 'up' | 'down'>>>({})
  const [inbox, setInbox] = useState<readonly NotificationView[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  // A different reader has different votes and a different inbox, so the local
  // caches are dropped whenever the acting preset changes.
  // 不同读者的投票与收件箱不同，因此「以谁的身份」一变就丢弃本地缓存。
  useEffect(() => {
    setLocalVotes({})
    setInbox([])
    setInboxLoaded(false)
  }, [active])
  return { localVotes, setLocalVotes, inbox, setInbox, inboxLoaded, setInboxLoaded }
}

/** Register every workspace the framework knows about, then re-read. 把框架已知的每个工作区登记为板块，然后重读。 */
export function useWorkspaceBoards(
  workspaces: readonly WorkspaceView[],
  ensureBoard: (workspaceId: string, path: string) => Promise<void>,
  refresh: () => void,
): void {
  // `workspaceKey` is the stable identity of the list; `workspaces` is a fresh array on every store update.
  // `workspaceKey` 是列表的稳定身份；`workspaces` 在每次 store 更新时都是新数组。
  const workspaceKey = workspaces.map(workspace => `${workspace.workspaceId}\u0000${workspace.path}`).join('\u0001')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const workspace of workspaces) {
        try {
          await ensureBoard(workspace.workspaceId, workspace.path)
        } catch {
          // Best effort: a failed registration is one board fewer, and the next poll retries it.
          // 尽力而为：一次登记失败只是少一个板块，下一轮节拍会重试。
        }
        if (cancelled) return
      }
      if (!cancelled) refresh()
    })()
    return () => { cancelled = true }
  }, [workspaceKey, ensureBoard, refresh, workspaces])
}

/** One write with busy/error/toast bookkeeping, shared by every mutation. 一次写入，附带忙碌/错误/提示簿记，供所有变更共用。 */
export interface Runner {
  readonly busy: boolean
  readonly error: string
  readonly setBusy: (busy: boolean) => void
  readonly setError: (message: string) => void
  readonly run: (work: () => Promise<void>, success?: string) => Promise<boolean>
}

/** Hold the write bookkeeping around a toast center. 围绕提示中心持有写入簿记。 */
export function useRunner(center: ToastCenter, t: (key: ForumKey) => string): Runner {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (work: () => Promise<void>, success?: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await work()
      if (success !== undefined) center.push('success', success)
      return true
    } catch (cause: unknown) {
      const message = messageOf(cause)
      setError(message)
      center.push('error', `${t('toastError')}: ${message}`)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setBusy, setError, run }
}

/** The effective vote reader over the local cache. 基于本地缓存的生效投票读取器。 */
export type VoteOfReader =
  (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined

/** What the page holds: the catalog inputs plus every piece of view state. 页面持有的内容：目录输入与全部视图状态。 */
export interface ForumPageState {
  /** The static inputs, passed through to the view. 直通视图的静态输入。 */
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly autoPost: AutoPostSnapshot
  readonly refresh: ForumCatalog['refresh']
  /** The derived catalog values the view reads. 视图读取的派生目录值。 */
  readonly view: CatalogView
  readonly people: readonly PersonView[]
  readonly shownBoard: string | undefined
  readonly boardTitle: string | undefined
  /** The acting identity and its picker state. 身份与其选择器状态。 */
  readonly actor: string | undefined
  readonly setActor: (value: string | undefined) => void
  readonly active: string | undefined
  /** The feed filters, the open thread, and the reader caches. 筛选器、打开的主题与读者缓存。 */
  readonly filters: FeedFilters
  readonly open: PostDetailView | undefined
  readonly setOpen: (detail: PostDetailView | undefined) => void
  readonly reader: ReaderCache
  /** The write bookkeeping and the toast center. 写入簿记与提示中心。 */
  readonly runner: Runner
  readonly toasts: readonly Toast[]
  readonly push: ToastCenter['push']
  /** The effective request root every re-read starts from. 每次重读的请求根。 */
  readonly boardFilter: CatalogQuery
  /** The two modal/page toggles. 写作框与配置页两个开关。 */
  readonly composerOpen: boolean
  readonly setComposerOpen: (open: boolean) => void
  readonly configOpen: boolean
  readonly setConfigOpen: (open: boolean) => void
}

/** What the page does: every mutation and navigation callback the view binds. 页面做的事：视图绑定的全部变更与导航回调。 */
export interface ForumPageOps {
  readonly voteOf: VoteOfReader
  readonly openPost: (postId: string) => void
  readonly vote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly pin: (postId: string, pinned: boolean, inThread: boolean) => void
  readonly publish: (input: PublishInput) => Promise<boolean>
  readonly comment: (input: CommentInput) => Promise<boolean>
  readonly readInbox: () => void
  readonly markAllRead: () => void
  readonly saveAutoPost: (settings: readonly AutoPostSettings[]) => Promise<boolean>
  readonly openComposer: () => void
  readonly selectBoard: (id: string) => void
  readonly toggleConfig: () => void
  readonly reload: () => void
  readonly onQuery: (value: string) => void
  readonly onTag: (value: string) => void
  readonly onSort: (value: PostSort) => void
}

/** The whole page: state and ops in one object. 页面整体：状态与动作合一。 */
export type ForumPage = ForumPageState & ForumPageOps
