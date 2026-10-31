/**
 * The forum page body's action stage: pure factories that bind the page's
 * state and the inject face's callbacks into the single callbacks the view
 * binds. They use no hooks — the body calls them during render, exactly where
 * the former inline closures lived. Every dep is an indexed access of the
 * authoritative contracts in `panel-page-state` and `panel`, so no type is
 * restated here.
 *
 * 论坛页面体的动作阶段：纯工厂函数，把页面状态与注入面的回调绑定成视图绑定的单个回调。
 * 它们不使用 hooks——页面体在渲染期间调用它们，位置正是原先内联闭包所在。每个依赖都是
 * `panel-page-state` 与 `panel` 中权威契约的索引访问，此处不复述任何类型。
 *
 * @module @veren/forum-ui/client/panel-page-actions
 */

import { messageOf } from './catalog.ts'
import type { AutoPostSettings, PostSort } from './remote.ts'
import type { PublishInput } from './panel-model.ts'
import type { ForumPanelInjected } from './panel.tsx'
import type { FeedFilters, ForumPageOps, ForumPageState, ReaderCache, Runner, VoteOfReader } from './panel-page-state.ts'

/** Read the effective vote: the locally cast attitude first, else the catalog's. 读取生效投票：先看本地所投，否则用目录里的。 */
export function voteOfCache(localVotes: ReaderCache['localVotes']): VoteOfReader {
  return (kind, id, fallback) => localVotes[`${kind}:${id}`] ?? fallback
}

/** Re-read the open thread, so its votes and comments reflect the last write. 重读打开的主题，让投票与评论反映最近一次写入。 */
export function rereadAction(deps: {
  readonly open: ForumPageState['open']
  readonly setOpen: ForumPageState['setOpen']
  readonly onOpenPost: ForumPanelInjected['onOpenPost']
}): () => Promise<void> {
  const { open, setOpen, onOpenPost } = deps
  return async (): Promise<void> => {
    if (open === undefined) return
    setOpen(await onOpenPost(open.post.id))
  }
}

/** Open one post as the thread view, surfacing failures as a toast. 打开一条帖子作为主题视图，失败以提示呈现。 */
export function openPostAction(deps: {
  readonly onOpenPost: ForumPanelInjected['onOpenPost']
  readonly setOpen: ForumPageState['setOpen']
  readonly setBusy: Runner['setBusy']
  readonly push: ForumPageState['push']
  readonly t: ForumPageState['t']
}): ForumPageOps['openPost'] {
  const { onOpenPost, setOpen, setBusy, push, t } = deps
  return (postId: string): void => {
    void (async () => {
      setBusy(true)
      try {
        setOpen(await onOpenPost(postId))
      } catch (cause: unknown) {
        push('error', `${t('toastError')}: ${messageOf(cause)}`)
      } finally {
        setBusy(false)
      }
    })()
  }
}

/** Vote on a post or comment, remembering the cast attitude until the next full read. 对帖子或评论投票，并在下一次完整读取前记住所投的态度。 */
export function voteAction(deps: {
  readonly active: ForumPageState['active']
  readonly voteOf: VoteOfReader
  readonly run: Runner['run']
  readonly onVote: ForumPanelInjected['onVote']
  readonly setLocalVotes: ReaderCache['setLocalVotes']
  readonly reread: () => Promise<void>
  readonly reload: () => void
  readonly t: ForumPageState['t']
}): ForumPageOps['vote'] {
  const { active, voteOf, run, onVote, setLocalVotes, reread, reload, t } = deps
  return (kind, id, value, current) => {
    if (active === undefined) return
    const key = `${kind}:${id}`
    const previous = voteOf(kind, id, current)
    const clearing = previous === value
    void run(async () => {
      await onVote({ subjectKind: kind, subjectId: id, actor: active, value })
      setLocalVotes((votes) => {
        const next = { ...votes }
        if (clearing) delete next[key]
        else next[key] = value
        return next
      })
      await reread()
      reload()
    }, clearing ? t('toastVoteCleared') : t('toastVoted'))
  }
}

/** Pin or unpin one post, optionally re-reading the open thread. 置顶或取消置顶，可顺带重读打开的主题。 */
export function pinAction(deps: {
  readonly active: ForumPageState['active']
  readonly run: Runner['run']
  readonly onPin: ForumPanelInjected['onPin']
  readonly reread: () => Promise<void>
  readonly reload: () => void
  readonly t: ForumPageState['t']
}): ForumPageOps['pin'] {
  const { active, run, onPin, reread, reload, t } = deps
  return (postId, pinned, inThread) => {
    void run(async () => {
      await onPin({
        postId, pinned,
        ...active === undefined ? {} : { reader: active },
      })
      if (inThread) await reread()
      reload()
    }, pinned ? t('toastPinned') : t('toastUnpinned'))
  }
}

/** Publish one post: land it on the right board, then close the composer. 发布一帖：落到正确板块后关闭写作框。 */
export function publishAction(deps: {
  readonly run: Runner['run']
  readonly onPublish: ForumPanelInjected['onPublish']
  readonly filters: FeedFilters
  readonly refresh: ForumPageState['refresh']
  readonly setComposerOpen: ForumPageState['setComposerOpen']
  readonly t: ForumPageState['t']
}): (input: PublishInput) => Promise<boolean> {
  const { run, onPublish, filters, refresh, setComposerOpen, t } = deps
  return async (input) => {
    const ok = await run(async () => {
      await onPublish(input)
      filters.setBoardId(input.boardId)
      refresh({ boardId: input.boardId, query: filters.query, tag: filters.tag, sort: filters.sort })
    }, t('toastPublished'))
    if (ok) setComposerOpen(false)
    return ok
  }
}

/** Write one comment, then re-read the open thread and the feed. 写一条评论，随后重读打开的主题与信息流。 */
export function commentAction(deps: {
  readonly run: Runner['run']
  readonly onComment: ForumPanelInjected['onComment']
  readonly reread: () => Promise<void>
  readonly reload: () => void
  readonly t: ForumPageState['t']
}): ForumPageOps['comment'] {
  const { run, onComment, reread, reload, t } = deps
  return async (input) => {
    return run(async () => {
      await onComment(input)
      await reread()
      reload()
    }, t('toastComment'))
  }
}

/** The two inbox operations: read into the cache, or clear it as read. 收件箱的两个操作：读入缓存，或清空标已读。 */
export function inboxActions(deps: {
  readonly active: ForumPageState['active']
  readonly run: Runner['run']
  readonly onReadInbox: ForumPanelInjected['onReadInbox']
  readonly onMarkAllRead: ForumPanelInjected['onMarkAllRead']
  readonly setInbox: ReaderCache['setInbox']
  readonly setInboxLoaded: ReaderCache['setInboxLoaded']
  readonly t: ForumPageState['t']
}): Pick<ForumPageOps, 'readInbox' | 'markAllRead'> {
  const { active, run, onReadInbox, onMarkAllRead, setInbox, setInboxLoaded, t } = deps
  const readInbox = (): void => {
    if (active === undefined) return
    void run(async () => {
      setInbox(await onReadInbox(active))
      setInboxLoaded(true)
    }, t('toastInbox'))
  }
  const markAllRead = (): void => {
    if (active === undefined) return
    void run(async () => {
      await onMarkAllRead(active)
      setInbox([])
      setInboxLoaded(true)
    }, t('toastMarkedRead'))
  }
  return { readInbox, markAllRead }
}

/** Replace the per-preset auto-post settings and re-read the feed. 替换按预设的自动发帖设置并重读信息流。 */
export function saveAutoPostAction(deps: {
  readonly run: Runner['run']
  readonly onSaveAutoPost: ForumPanelInjected['onSaveAutoPost']
  readonly reload: () => void
  readonly t: ForumPageState['t']
}): ForumPageOps['saveAutoPost'] {
  const { run, onSaveAutoPost, reload, t } = deps
  return async (settings: readonly AutoPostSettings[]) => {
    return run(async () => {
      await onSaveAutoPost(settings)
      reload()
    }, t('toastSaved'))
  }
}

/** Open the composer with a clean error slate. 清空错误并打开发帖写作框。 */
export function openComposerAction(deps: {
  readonly setError: Runner['setError']
  readonly setComposerOpen: ForumPageState['setComposerOpen']
}): ForumPageOps['openComposer'] {
  const { setError, setComposerOpen } = deps
  return (): void => {
    setError('')
    setComposerOpen(true)
  }
}

/** Switch boards: reset the open thread and re-read the new board. 切换板块：关掉打开的主题并重读新板块。 */
export function selectBoardAction(deps: {
  readonly filters: FeedFilters
  readonly refresh: ForumPageState['refresh']
  readonly setOpen: ForumPageState['setOpen']
}): ForumPageOps['selectBoard'] {
  const { filters, refresh, setOpen } = deps
  return (id: string): void => {
    filters.setBoardId(id)
    setOpen(undefined)
    refresh({ boardId: id, query: filters.query, tag: filters.tag, sort: filters.sort })
  }
}

/** Build the three filter handlers, each re-reading with the changed value. 构建三个筛选处理器，各自带着改后的值重读。 */
export function filterHandlers(deps: {
  readonly filters: FeedFilters
  readonly boardFilter: ForumPageState['boardFilter']
  readonly refresh: ForumPageState['refresh']
}): Pick<ForumPageOps, 'onQuery' | 'onTag' | 'onSort'> {
  const { filters, boardFilter, refresh } = deps
  const rereadWith = (query: string, tag: string, sort: PostSort): void => {
    refresh({ ...boardFilter, query, tag, sort })
  }
  return {
    onQuery: (value) => { filters.setQuery(value); rereadWith(value, filters.tag, filters.sort) },
    onTag: (value) => { filters.setTag(value); rereadWith(filters.query, value, filters.sort) },
    onSort: (value) => { filters.setSort(value); rereadWith(filters.query, filters.tag, value) },
  }
}
