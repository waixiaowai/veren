/**
 * The forum page's stateful body: it owns the view state (the board on screen,
 * the open post, the composer's draft flags, which comments the reader folded,
 * and the transient toasts), adapts the inject face's callbacks, and composes
 * the view modules. Only this module re-renders on selection; the shell above
 * it resolves the framework seats once and never changes.
 *
 * The render output is identical to the single-file panel: the header and the
 * board bar are now `PageHeader` / `BoardBar` components with the same markup.
 *
 * 论坛页面的有状态页面体：持有视图状态（当前板块、打开的帖子、写作框标记、折叠的评论与
 * 瞬态提示），适配注入面的回调并组合各视图模块。选中变化时只有本模块重渲染；上层的壳只
 * 解析一次框架座位，此后不再变化。
 *
 * 渲染输出与单文件面板一致：页头与板块栏现在是 `PageHeader` / `BoardBar` 组件，标记相同。
 *
 * @module @veren/forum-ui/client/panel-body
 */

import { useEffect, useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ForumCatalog, ForumCatalogSnapshot } from './catalog.ts'
import { messageOf } from './catalog.ts'
import type {
  AutoPostSettings, AutoPostSnapshot, NotificationView, PostDetailView, PostSort,
} from './remote.ts'
import type { ForumKey } from './locales.ts'
import type { CommentInput, PublishInput } from './panel-model.ts'
import type { ForumPanelInjected } from './panel.tsx'
import { BoardBar, PageHeader } from './panel-chrome.tsx'
import { ComposerModal } from './panel-composer.tsx'
import { Feed } from './panel-feed.tsx'
import { SettingsPage } from './panel-settings.tsx'
import { Thread } from './panel-thread.tsx'
import { ToastStack, useToasts } from './panel-kit.tsx'

/** Everything the page body needs, with the inject face already resolved. 页面体所需的全部输入，注入面已先行解析。 */
export interface BodyProps {
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly autoPost: AutoPostSnapshot
  readonly workspaces: readonly WorkspaceView[]
  /** The inject face's callbacks, with the hook compartment already bound away. 注入面的回调，hooks 舱已在此前解绑。 */
  readonly actions: Omit<ForumPanelInjected, 'hooks'>
  readonly refresh: ForumCatalog['refresh']
}

/** The page body: it holds the view state, so only it re-renders on selection. 页面体：持有视图状态，因此选中变化时只有它重渲染。 */
export function ForumBody(props: BodyProps) {
  const { t, catalog, autoPost, workspaces, actions, refresh } = props
  const [boardId, setBoardId] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<PostSort>('heat')
  const [actor, setActor] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState<PostDetailView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inbox, setInbox] = useState<readonly NotificationView[]>([])
  const [inboxLoaded, setInboxLoaded] = useState(false)
  const [localVotes, setLocalVotes] = useState<Readonly<Record<string, 'up' | 'down'>>>({})
  const [composerOpen, setComposerOpen] = useState(false)
  // The second-level settings page: it owns the notifications and the auto-post
  // cards, so the main feed stays a single centered column with no side rail.
  // 二级配置页：持有通知与自动发帖卡片，主信息流因此保持单列居中，不再有侧栏。
  const [configOpen, setConfigOpen] = useState(false)
  const { toasts, push } = useToasts()

  const view = catalog.catalog
  const people = view.people
  const active = actor ?? people[0]?.name
  const shownBoard = boardId ?? view.boardId
  const boardTitle = view.boards.find(board => board.id === shownBoard)?.title
  // A different reader has different votes and a different inbox, so the local
  // caches are dropped whenever the acting preset changes.
  // 不同读者的投票与收件箱不同，因此「以谁的身份」一变就丢弃本地缓存。
  useEffect(() => {
    setLocalVotes({})
    setInbox([])
    setInboxLoaded(false)
  }, [active])
  // `exactOptionalPropertyTypes` rejects an explicit `undefined` for an optional
  // field, so an unselected board omits the key entirely instead of passing one.
  // `exactOptionalPropertyTypes` 下可选字段不接受显式 `undefined`，因此未选板块时
  // 整个 `boardId` 键都不出现，而不是传一个 undefined。
  const boardFilter = shownBoard === undefined ? {} : { boardId: shownBoard }
  // The catalog read does not carry this reader's own attitude, so the page
  // remembers the votes it just cast. That keeps the pressed state and the
  // "cleared" wording truthful until the next full read.
  // 目录读取不携带当前读者的态度，因此页面记住自己刚投过的票；在下一次完整读取前，
  // 按下态与「已取消」措辞都由这份本地记录保证。
  const voteOf = (
    kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined,
  ): 'up' | 'down' | undefined => localVotes[`${kind}:${id}`] ?? fallback

  // Register every workspace the framework knows about, then re-read. This is
  // what turns a workspace created while the page is open into a new board.
  const ensureBoard = actions.onEnsureBoard
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
    // `workspaceKey` is the stable identity of the list; `workspaces` is a fresh array on every store update.
    // `workspaceKey` 是列表的稳定身份；`workspaces` 在每次 store 更新时都是新数组。
  }, [workspaceKey, ensureBoard, refresh, workspaces])

  /** Reframe the current feed's filters; used after every write. 重设当前信息流的筛选；每次写入后使用。 */
  const reload = (): void => { refresh({ ...boardFilter, query, tag, sort }) }

  /** Run one write, surfacing success and failure as a toast. 执行一次写入，成功与失败都以提示呈现。 */
  const run = async (work: () => Promise<void>, success?: string): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await work()
      if (success !== undefined) push('success', success)
      return true
    } catch (cause: unknown) {
      const message = messageOf(cause)
      setError(message)
      push('error', `${t('toastError')}: ${message}`)
      return false
    } finally {
      setBusy(false)
    }
  }

  const openPost = (postId: string): void => {
    void (async () => {
      setBusy(true)
      try {
        setOpen(await actions.onOpenPost(postId))
      } catch (cause: unknown) {
        push('error', `${t('toastError')}: ${messageOf(cause)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  const reread = async (): Promise<void> => {
    if (open === undefined) return
    setOpen(await actions.onOpenPost(open.post.id))
  }

  const vote = (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down'): void => {
    if (active === undefined) return
    const key = `${kind}:${id}`
    const previous = voteOf(kind, id, current)
    const clearing = previous === value
    void run(async () => {
      await actions.onVote({ subjectKind: kind, subjectId: id, actor: active, value })
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

  const pin = (postId: string, pinned: boolean, inThread: boolean): void => {
    void run(async () => {
      await actions.onPin({
        postId, pinned,
        ...active === undefined ? {} : { reader: active },
      })
      if (inThread) await reread()
      reload()
    }, pinned ? t('toastPinned') : t('toastUnpinned'))
  }

  const publish = async (input: PublishInput): Promise<boolean> => {
    const ok = await run(async () => {
      await actions.onPublish(input)
      setBoardId(input.boardId)
      refresh({ boardId: input.boardId, query, tag, sort })
    }, t('toastPublished'))
    if (ok) setComposerOpen(false)
    return ok
  }

  const comment = async (input: CommentInput): Promise<boolean> => {
    return run(async () => {
      await actions.onComment(input)
      await reread()
      reload()
    }, t('toastComment'))
  }

  const readInbox = (): void => {
    if (active === undefined) return
    void run(async () => {
      setInbox(await actions.onReadInbox(active))
      setInboxLoaded(true)
    }, t('toastInbox'))
  }

  const markAllRead = (): void => {
    if (active === undefined) return
    void run(async () => {
      await actions.onMarkAllRead(active)
      setInbox([])
      setInboxLoaded(true)
    }, t('toastMarkedRead'))
  }

  const saveAutoPost = async (settings: readonly AutoPostSettings[]): Promise<boolean> => {
    return run(async () => {
      await actions.onSaveAutoPost(settings)
      reload()
    }, t('toastSaved'))
  }

  const openComposer = (): void => {
    setError('')
    setComposerOpen(true)
  }

  const selectBoard = (id: string): void => {
    setBoardId(id)
    setOpen(undefined)
    refresh({ boardId: id, query, tag, sort })
  }

  return (
    <div className="forum-page">
      <PageHeader
        t={t} people={people} active={active} configOpen={configOpen}
        onActor={setActor}
        onToggleConfig={() => { setConfigOpen(!configOpen); setOpen(undefined) }}
        onOpenComposer={openComposer}
      />

      <BoardBar t={t} boards={view.boards} shownBoard={shownBoard} onSelect={selectBoard} />

      <div className="forum-layout">
        <main className="forum-main">
          {catalog.status === 'error' && !configOpen && (
            <div className="forum-banner" role="alert">
              <span>{t('failed')}: {catalog.error}</span>
              <button type="button" className="forum-link" onClick={() => { refresh() }}>{t('retry')}</button>
            </div>
          )}
          {configOpen ? (
            <SettingsPage
              t={t} inbox={inbox} inboxLoaded={inboxLoaded} attached={active !== undefined}
              readOnly={busy} autoPost={autoPost}
              onRead={readInbox} onMarkAllRead={markAllRead} onSave={saveAutoPost}
              onBack={() => { setConfigOpen(false) }}
            />
          ) : open === undefined ? (
              <Feed
                t={t} catalog={catalog} posts={view.posts} boardTitle={boardTitle} actor={active}
                readOnly={busy} query={query} tag={tag} sort={sort}
                onQuery={value => { setQuery(value); refresh({ ...boardFilter, query: value, tag, sort }) }}
                onTag={value => { setTag(value); refresh({ ...boardFilter, query, tag: value, sort }) }}
                onSort={value => { setSort(value); refresh({ ...boardFilter, query, tag, sort: value }) }}
                onOpenPost={openPost} onVote={vote} voteOf={voteOf}
                onPin={(postId, pinned) => { pin(postId, pinned, false) }}
                onCreate={openComposer}
              />
            ) : (
              <Thread
                t={t} detail={open} actor={active} readOnly={busy}
                onBack={() => { setOpen(undefined); reload() }}
                onVote={vote} voteOf={voteOf} onPin={(postId, pinned) => { pin(postId, pinned, true) }}
                onComment={comment}
              />
            )}
        </main>
      </div>

      {composerOpen && (
        <ComposerModal
          t={t} boards={view.boards} people={people} actor={active}
          defaultBoard={shownBoard} readOnly={busy} error={error}
          onActor={setActor} onClose={() => { setComposerOpen(false) }} onSubmit={publish}
        />
      )}

      <ToastStack toasts={toasts} />
    </div>
  )
}
