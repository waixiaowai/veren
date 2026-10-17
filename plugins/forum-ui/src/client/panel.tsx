/**
 * The forum page: a header, board pills, a centered feed, a thread view, two
 * side cards, and the two modal composers.
 *
 * The page is a presentation component. It reads its catalog through the
 * framework's `useCatalog` seat — synthesized from the inject face's `hooks`
 * compartment — takes the workspace list through the framework's
 * `useWorkspaces` seat, and performs every mutation through the callbacks its
 * inject face supplies. It never touches `ctx`, never imports a service, and
 * holds only view state (the board on screen, the open post, the composer's
 * draft, which comments the reader folded, and the transient toasts).
 *
 * 论坛页面：页头、板块标签、居中的帖子流、讨论串、右侧两张卡片，以及两个模态写作框。
 *
 * 页面是展示组件。它通过框架的 `useCatalog` 座位（由注入面的 `hooks` 舱合成）读取目录、
 * 通过 `useWorkspaces` 座位取工作区列表，所有写入都经注入面提供的回调完成——它不碰 `ctx`、
 * 不导入服务，本地只持有视图状态（当前板块、打开的帖子、草稿、折叠的评论，以及瞬态提示）。
 *
 * @module @veren/forum-ui/client/panel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `useWorkspaces` global seat this page reads.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ForumCatalog, ForumCatalogSnapshot } from './catalog.ts'
import { POST_SORTS } from './remote.ts'
import type {
  AutoPostSetting, AutoPostSnapshot, BoardView, CatalogQuery, CommentNodeView, NotificationView,
  PersonView, PostDetailView, PostSort, PostView,
} from './remote.ts'
import type { ForumKey } from './locales.ts'

/** Everything the page's inject face supplies: observables and callbacks. */
export interface ForumPanelInjected {
  /** The catalog and auto-post observables, bound as `useCatalog` / `useAutoPost`. */
  readonly hooks: {
    readonly catalog: HostObservable<ForumCatalogSnapshot>
    readonly autoPost: HostObservable<AutoPostSnapshot>
  }
  /** Re-read the catalog after a change or a failure. */
  readonly onRefresh: (request?: CatalogQuery) => void
  /**
   * Register one workspace as a board.
   *
   * The page owns this call because it is the one place that already reads the
   * framework's live workspace list; registering on every new workspace is what
   * makes a workspace created later appear as a new board with no setup step.
   */
  readonly onEnsureBoard: (workspaceId: string, path: string) => Promise<void>
  /** Read one post with its comment tree. */
  readonly onOpenPost: (postId: string) => Promise<PostDetailView>
  /** Publish one post. */
  readonly onPublish: (input: PublishInput) => Promise<void>
  /** Write one comment or reply. */
  readonly onComment: (input: CommentInput) => Promise<void>
  /** Record one preset's attitude. */
  readonly onVote: (input: {
    readonly subjectKind: 'post' | 'comment'
    readonly subjectId: string
    readonly actor: string
    readonly value: 'up' | 'down'
  }) => Promise<void>
  /** Pin or unpin one post. */
  readonly onPin: (input: {
    readonly postId: string
    readonly pinned: boolean
    readonly reader?: string
  }) => Promise<void>
  /** Read the reading preset's notifications. */
  readonly onReadInbox: (recipient: string) => Promise<readonly NotificationView[]>
  /** Mark every notification of one preset read. */
  readonly onMarkAllRead: (recipient: string) => Promise<void>
  /** Replace the per-preset auto-post settings. */
  readonly onSaveAutoPost: (settings: readonly AutoPostSetting[]) => Promise<void>
}

/** The one write payload the composer builds. */
interface PublishInput {
  readonly boardId: string
  readonly author: string
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  readonly notifyMode: 'inbox' | 'wake'
}

/** The one comment payload the thread's reply box builds. */
interface CommentInput {
  readonly postId: string
  readonly parentCommentId?: string
  readonly author: string
  readonly body: string
  readonly notifyMode: 'inbox' | 'wake'
}

/** Props of {@link ForumPanel}, derived from the framework shares. */
export type ForumPanelProps = PropsRuntime<'main'>
  & InjectFace<ForumPanelInjected>
  & PropsLocale<'forum'>

/** Everything the page body needs, with the inject face already resolved. */
interface BodyProps {
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly autoPost: AutoPostSnapshot
  readonly workspaces: readonly WorkspaceView[]
  readonly useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  /** The inject face's callbacks, with the hook compartment already bound away. */
  readonly actions: Omit<ForumPanelInjected, 'hooks'>
  readonly refresh: ForumCatalog['refresh']
}

/** One transient feedback message. */
interface Toast {
  readonly id: number
  readonly kind: 'success' | 'error'
  readonly text: string
}

/** Where one reply modal points, when a comment started it. */
interface ReplyTarget {
  readonly commentId?: string
  readonly author?: string
}

/** Render the page shell and resolve the framework seats once. */
export function ForumPanel(props: ForumPanelProps) {
  const catalog = props.useCatalog(state => state)
  const autoPost = props.useAutoPost(state => state)
  const workspaces = props.useWorkspaces(state => state.items)
  const body: BodyProps = {
    t: props.t,
    catalog,
    autoPost,
    workspaces,
    useWorkspaces: props.useWorkspaces,
    actions: props,
    refresh: props.onRefresh,
  }
  return <ForumBody {...body} />
}

/** The page body: it holds the view state, so only it re-renders on selection. */
function ForumBody(props: BodyProps) {
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
  const [notificationsOpen, setNotificationsOpen] = useState(true)
  const [autoPostOpen, setAutoPostOpen] = useState(false)
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
          // Best effort: a failed registration is one board fewer, and the
          // next poll retries it.
        }
        if (cancelled) return
      }
      if (!cancelled) refresh()
    })()
    return () => { cancelled = true }
    // `workspaceKey` is the stable identity of the list; `workspaces` is a
    // fresh array on every store update.
  }, [workspaceKey, ensureBoard, refresh, workspaces])

  /** Reframe the current feed's filters; used after every write. */
  const reload = (): void => { refresh({ ...boardFilter, query, tag, sort }) }

  /** Run one write, surfacing success and failure as a toast. */
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

  const saveAutoPost = async (settings: readonly AutoPostSetting[]): Promise<boolean> => {
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
      <header className="forum-header">
        <div className="forum-heading">
          <div className="forum-heading-row">
            <span className="forum-mark" aria-hidden="true"><ChatIcon /></span>
            <h1>{t('panel')}</h1>
          </div>
          <p>{t('panelSubtitle')}</p>
        </div>
        <div className="forum-header-actions">
          {people.length > 0 && (
            <label className="forum-actor">
              <span>{t('actingAs')}</span>
              <select
                value={active ?? ''} aria-label={t('actingAs')}
                onChange={event => { setActor(event.target.value) }}
              >
                {people.map(person => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="forum-btn forum-primary forum-cta" onClick={openComposer}>
            <PlusIcon />
            {t('newPost')}
          </button>
        </div>
      </header>

      <nav className="forum-boardbar" aria-label={t('boards')}>
        {view.boards.length === 0
          ? <span className="forum-boardbar-empty">{t('noBoards')}</span>
          : view.boards.map(board => (
            <button
              key={board.id} type="button" className="forum-pill"
              aria-selected={board.id === shownBoard}
              onClick={() => { selectBoard(board.id) }}
            >
              {board.title}
              <span className="forum-pill-count">{board.postCount}</span>
            </button>
          ))}
      </nav>

      <div className="forum-layout">
        <main className="forum-main">
          {catalog.status === 'error' && (
            <div className="forum-banner" role="alert">
              <span>{t('failed')}: {catalog.error}</span>
              <button type="button" className="forum-link" onClick={() => { refresh() }}>{t('retry')}</button>
            </div>
          )}
          {open === undefined
            ? (
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
            )
            : (
              <Thread
                t={t} detail={open} actor={active} readOnly={busy}
                onBack={() => { setOpen(undefined); reload() }}
                onVote={vote} voteOf={voteOf} onPin={(postId, pinned) => { pin(postId, pinned, true) }}
                onComment={comment}
              />
            )}
        </main>

        <aside className="forum-side">
          <NotificationsCard
            t={t} items={inbox} loaded={inboxLoaded} attached={active !== undefined} readOnly={busy}
            open={notificationsOpen} onToggle={() => { setNotificationsOpen(!notificationsOpen) }}
            onRead={readInbox} onMarkAllRead={markAllRead}
          />
          <AutoPostCard
            t={t} snapshot={autoPost} readOnly={busy}
            open={autoPostOpen} onToggle={() => { setAutoPostOpen(!autoPostOpen) }}
            onSave={saveAutoPost}
          />
        </aside>
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

/** The centered feed: filters, the post cards, and the guides. */
function Feed(props: {
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly posts: readonly PostView[]
  readonly boardTitle: string | undefined
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly query: string
  readonly tag: string
  readonly sort: PostSort
  readonly onQuery: (value: string) => void
  readonly onTag: (value: string) => void
  readonly onSort: (value: PostSort) => void
  readonly onOpenPost: (postId: string) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onPin: (postId: string, pinned: boolean) => void
  readonly onCreate: () => void
}) {
  const { t, catalog, posts, actor, readOnly } = props
  const tags = useMemo(() => tagOptions(catalog), [catalog])
  const loading = catalog.status === 'loading' && !catalog.settled
  return (
    <>
      <div className="forum-toolbar">
        <div className="forum-search">
          <SearchIcon />
          <input
            className="forum-input" value={props.query} placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            onChange={event => { props.onQuery(event.target.value) }}
          />
        </div>
        <select
          className="forum-select" value={props.tag} aria-label={t('tag')}
          onChange={event => { props.onTag(event.target.value) }}
        >
          <option value="">{t('allTags')}</option>
          {tags.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          className="forum-select" value={props.sort} aria-label={t('sort')}
          onChange={event => { props.onSort(event.target.value as PostSort) }}
        >
          {POST_SORTS.map(value => (
            <option key={value} value={value}>
              {value === 'heat' ? t('sortHeat') : value === 'new' ? t('sortNew') : t('sortViews')}
            </option>
          ))}
        </select>
      </div>

      <div className="forum-feed-head">
        <h2 className="forum-feed-title">
          {props.boardTitle ?? t('posts')}
          <span className="forum-count">{posts.length}</span>
          {catalog.status === 'loading' && <span className="forum-live">{t('loading')}</span>}
        </h2>
      </div>

      <div className="forum-feed">
        {loading
          ? [0, 1, 2].map(index => <div key={index} className="forum-skeleton" aria-hidden="true" />)
          : posts.length === 0
            ? (
              <div className="forum-empty">
                <span className="forum-empty-icon"><ChatIcon /></span>
                <h3>{catalog.catalog.boards.length === 0 ? t('noBoards') : t('emptyTitle')}</h3>
                <p>{catalog.catalog.boards.length === 0 ? t('notificationsHint') : t('emptyBody')}</p>
                {catalog.catalog.boards.length > 0 && (
                  <button type="button" className="forum-btn forum-primary" onClick={props.onCreate}>
                    <PlusIcon />
                    {t('emptyCta')}
                  </button>
                )}
              </div>
            )
            : posts.map(post => (
              <PostCard
                key={post.id} t={t} post={post} actor={actor} readOnly={readOnly}
                myVote={props.voteOf('post', post.id, post.myVote)}
                onOpenPost={props.onOpenPost} onVote={props.onVote} onPin={props.onPin}
              />
            ))}
      </div>
    </>
  )
}

/** One post row: title, author, excerpt, counts, and the three quick actions. */
function PostCard(props: {
  readonly t: (key: ForumKey) => string
  readonly post: PostView
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly myVote: 'up' | 'down' | undefined
  readonly onOpenPost: (postId: string) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly onPin: (postId: string, pinned: boolean) => void
}) {
  const { t, post, actor, readOnly } = props
  return (
    <article className={post.pinned ? 'forum-card forum-post is-pinned' : 'forum-card forum-post'}>
      <div className="forum-post-top">
        {post.pinned && <span className="forum-chip is-warn">{t('pinned')}</span>}
        <h3 className="forum-post-title">
          <button type="button" className="forum-post-link" onClick={() => { props.onOpenPost(post.id) }}>
            {post.title}
          </button>
        </h3>
      </div>
      <div className="forum-post-meta">
        <span className="forum-avatar" aria-hidden="true">{initial(post.author)}</span>
        <span className="forum-post-author">{post.author}</span>
        {post.tags.length > 0 && <span className="forum-dot">·</span>}
        {post.tags.map(value => <span key={value} className="forum-chip">{value}</span>)}
      </div>
      {post.excerpt !== '' && <p className="forum-post-excerpt">{post.excerpt}</p>}
      <div className="forum-post-foot">
        <div className="forum-vote-group">
          <VoteButtons
            t={t} up={post.up} down={post.down} myVote={props.myVote}
            disabled={readOnly || actor === undefined}
            onVote={value => { props.onVote('post', post.id, value, props.myVote) }}
          />
        </div>
        <span className="forum-stat">{post.views} {t('views')}</span>
        <span className="forum-dot">·</span>
        <span className="forum-stat">{post.commentCount} {t('comments')}</span>
        <div className="forum-post-actions">
          <button
            type="button" className="forum-btn forum-ghost" disabled={readOnly}
            onClick={() => { props.onPin(post.id, !post.pinned) }}
          >{post.pinned ? t('unpin') : t('pin')}</button>
          <button
            type="button" className="forum-btn"
            onClick={() => { props.onOpenPost(post.id) }}
          >{t('reply')}</button>
        </div>
      </div>
    </article>
  )
}

/** The publish form, in a centered modal instead of the always-on feed. */
function ComposerModal(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly BoardView[]
  readonly people: readonly PersonView[]
  readonly actor: string | undefined
  readonly defaultBoard: string | undefined
  readonly readOnly: boolean
  readonly error: string
  readonly onActor: (value: string) => void
  readonly onClose: () => void
  readonly onSubmit: (input: PublishInput) => Promise<boolean>
}) {
  const { t, boards, actor, onActor, onClose, onSubmit, readOnly, error } = props
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [notify, setNotify] = useState<'inbox' | 'wake'>('inbox')
  const [board, setBoard] = useState(props.defaultBoard ?? boards[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const canSubmit = !readOnly && !pending && actor !== undefined && board !== '' && title.trim() !== ''
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit || actor === undefined) return
    setPending(true)
    void onSubmit({ boardId: board, author: actor, title, body, tags: splitTags(tags), notifyMode: notify })
      .finally(() => { setPending(false) })
  }
  return (
    <Modal title={t('newPost')} subtitle={t('newPostHint')} closeLabel={t('close')} onClose={onClose}>
      <form className="forum-form" onSubmit={submit}>
        <div className="forum-modal-body">
          <label className="forum-field">
            <span className="forum-label">{t('title')}</span>
            <input
              className="forum-input" value={title} autoFocus aria-label={t('title')}
              placeholder={t('titlePlaceholder')}
              onChange={event => { setTitle(event.target.value) }}
            />
          </label>
          <label className="forum-field">
            <span className="forum-label">{t('body')}</span>
            <textarea
              className="forum-textarea" value={body} rows={7} aria-label={t('body')}
              placeholder={t('bodyPlaceholder')}
              onChange={event => { setBody(event.target.value) }}
            />
          </label>
          <div className="forum-two">
            <label className="forum-field">
              <span className="forum-label">{t('board')}</span>
              <select className="forum-select" value={board} onChange={event => { setBoard(event.target.value) }}>
                {boards.length === 0 && <option value="">{t('pickBoard')}</option>}
                {boards.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
              </select>
            </label>
            <label className="forum-field">
              <span className="forum-label">{t('actingAs')}</span>
              <select className="forum-select" value={actor ?? ''} onChange={event => { onActor(event.target.value) }}>
                {props.people.map(person => <option key={person.name} value={person.name}>{person.name}</option>)}
              </select>
            </label>
          </div>
          <label className="forum-field">
            <span className="forum-label">{t('tags')}</span>
            <input
              className="forum-input" value={tags} placeholder={t('tagsPlaceholder')}
              onChange={event => { setTags(event.target.value) }}
            />
          </label>
          <div className="forum-field">
            <span className="forum-label">{t('notifyMethod')}</span>
            <div className="forum-seg" role="group" aria-label={t('notifyMethod')}>
              <button
                type="button" className="forum-seg-btn" aria-pressed={notify === 'inbox'}
                onClick={() => { setNotify('inbox') }}
              >{t('notifyInboxShort')}</button>
              <button
                type="button" className="forum-seg-btn" aria-pressed={notify === 'wake'}
                onClick={() => { setNotify('wake') }}
              >{t('notifyWakeShort')}</button>
            </div>
          </div>
          {error !== '' && <p className="forum-form-error" role="alert">{error}</p>}
        </div>
        <div className="forum-modal-foot">
          <span />
          <div className="forum-actions">
            <button type="button" className="forum-btn forum-ghost" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="forum-btn forum-primary" disabled={!canSubmit}>
              {t('publish')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

/** One post's discussion: the body, the comment tree, and its reply modal. */
function Thread(props: {
  readonly t: (key: ForumKey) => string
  readonly detail: PostDetailView
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly onBack: () => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onPin: (postId: string, pinned: boolean) => void
  readonly onComment: (input: CommentInput) => Promise<boolean>
}) {
  const { t, detail, actor, readOnly, onBack, onVote, onPin, onComment } = props
  const [replyTo, setReplyTo] = useState<ReplyTarget | undefined>(undefined)
  const total = countComments(detail.comments)
  return (
    <div className="forum-thread">
      <button type="button" className="forum-btn forum-ghost forum-back" onClick={onBack}>
        <ArrowLeftIcon />
        {t('back')}
      </button>

      <article className="forum-card forum-thread-card">
        <div className="forum-thread-head">
          <h2>{detail.post.title}</h2>
          <div className="forum-actions">
            <button
              type="button" className="forum-btn forum-ghost" disabled={readOnly}
              onClick={() => { onPin(detail.post.id, !detail.post.pinned) }}
            >{detail.post.pinned ? t('unpin') : t('pin')}</button>
            <button
              type="button" className="forum-btn forum-primary" disabled={actor === undefined}
              onClick={() => { setReplyTo({}) }}
            >{t('reply')}</button>
          </div>
        </div>
        <div className="forum-post-meta">
          <span className="forum-avatar" aria-hidden="true">{initial(detail.post.author)}</span>
          <span className="forum-post-author">{detail.post.author}</span>
          <span className="forum-dot">·</span>
          <span className="forum-stat">{detail.post.views} {t('views')}</span>
          <span className="forum-dot">·</span>
          <span className="forum-stat">{total} {t('comments')}</span>
          {detail.post.pinned && <span className="forum-chip is-warn">{t('pinned')}</span>}
          {detail.post.tags.length > 0 && <span className="forum-dot">·</span>}
          {detail.post.tags.map(value => <span key={value} className="forum-chip">{value}</span>)}
        </div>
        <p className="forum-thread-body">{detail.body}</p>
        <div className="forum-thread-foot">
          <VoteButtons
            t={t} up={detail.post.up} down={detail.post.down}
            myVote={props.voteOf('post', detail.post.id, detail.post.myVote)}
            disabled={readOnly || actor === undefined}
            onVote={value => { onVote('post', detail.post.id, value, props.voteOf('post', detail.post.id, detail.post.myVote)) }}
          />
        </div>
      </article>

      <section className="forum-comments">
        <div className="forum-section-head">
          <h3>{t('comments')}<span className="forum-count">{total}</span></h3>
        </div>
        {detail.comments.length === 0
          ? (
            <div className="forum-empty forum-empty-sm">
              <h3>{t('noReplies')}</h3>
              <button
                type="button" className="forum-btn" disabled={actor === undefined}
                onClick={() => { setReplyTo({}) }}
              >{t('writeReply')}</button>
            </div>
          )
          : detail.comments.map(comment => (
            <CommentCard
              key={comment.id} t={t} comment={comment} actor={actor} busy={readOnly}
              postAuthor={detail.post.author} voteOf={props.voteOf}
              onReply={target => { setReplyTo(target) }} onVote={onVote}
            />
          ))}
      </section>

      {replyTo !== undefined && (
        <ReplyModal
          t={t} author={replyTo.author} actor={actor} readOnly={readOnly}
          onClose={() => { setReplyTo(undefined) }}
          onSubmit={async (body, notify) => {
            const target = replyTo.commentId
            const ok = await onComment({
              postId: detail.post.id, author: actor ?? '', body, notifyMode: notify,
              ...target === undefined ? {} : { parentCommentId: target },
            })
            return ok
          }}
        />
      )}
    </div>
  )
}

/** One comment, its folded body, its votes, and its direct replies. */
function CommentCard(props: {
  readonly t: (key: ForumKey) => string
  readonly comment: CommentNodeView
  readonly actor: string | undefined
  readonly busy: boolean
  readonly postAuthor: string
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onReply: (target: ReplyTarget) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
}) {
  const { t, comment, actor, busy, postAuthor, onReply, onVote } = props
  const [expanded, setExpanded] = useState(false)
  const folded = comment.foldable && !expanded
  return (
    <article className={comment.depth > 1 ? 'forum-card forum-comment is-nested' : 'forum-card forum-comment'}>
      <div className="forum-comment-head">
        <span className="forum-avatar" aria-hidden="true">{initial(comment.author)}</span>
        <strong>{comment.author}</strong>
        {comment.author === postAuthor && <span className="forum-chip is-accent">{t('originalPoster')}</span>}
      </div>
      <p className="forum-body">{folded ? `${comment.body.slice(0, 200)}…` : comment.body}</p>
      {comment.foldable && (
        <button type="button" className="forum-link" onClick={() => { setExpanded(!expanded) }}>
          {expanded ? t('collapse') : t('expand')}
        </button>
      )}
      <div className="forum-post-foot">
        <VoteButtons
          t={t} up={comment.up} down={comment.down}
          myVote={props.voteOf('comment', comment.id, comment.myVote)}
          disabled={busy || actor === undefined}
          onVote={value => { onVote('comment', comment.id, value, props.voteOf('comment', comment.id, comment.myVote)) }}
        />
        {comment.depth < 2 && (
          <div className="forum-post-actions">
            <button
              type="button" className="forum-btn forum-ghost" disabled={actor === undefined}
              onClick={() => { onReply({ commentId: comment.id, author: comment.author }) }}
            >{t('reply')}</button>
          </div>
        )}
      </div>
      {comment.replies.length > 0 && (
        <div className="forum-replies">
          {comment.replies.map(reply => (
            <CommentCard
              key={reply.id} t={t} comment={reply} actor={actor} busy={busy}
              postAuthor={postAuthor} voteOf={props.voteOf} onReply={onReply} onVote={onVote}
            />
          ))}
        </div>
      )}
    </article>
  )
}

/** The reply box, in a centered modal. */
function ReplyModal(props: {
  readonly t: (key: ForumKey) => string
  readonly author: string | undefined
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly onClose: () => void
  readonly onSubmit: (body: string, notify: 'inbox' | 'wake') => Promise<boolean>
}) {
  const { t, author, actor, readOnly, onClose, onSubmit } = props
  const [body, setBody] = useState('')
  const [notify, setNotify] = useState<'inbox' | 'wake'>('inbox')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const canSubmit = !readOnly && !pending && actor !== undefined && body.trim() !== ''
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    setPending(true)
    void onSubmit(body, notify).then((ok) => {
      if (ok) onClose()
    }, (cause: unknown) => { setError(messageOf(cause)) })
      .finally(() => { setPending(false) })
  }
  return (
    <Modal
      title={author === undefined ? t('writeReply') : `${t('replyingTo')} @${author}`}
      subtitle={t('replyPlaceholder')} closeLabel={t('close')} onClose={onClose}
    >
      <form className="forum-form" onSubmit={submit}>
        <div className="forum-modal-body">
          <label className="forum-field">
            <span className="forum-label">{t('replyBody')}</span>
            <textarea
              className="forum-textarea" value={body} rows={5} autoFocus aria-label={t('replyBody')}
              placeholder={t('replyPlaceholder')}
              onChange={event => { setBody(event.target.value) }}
            />
          </label>
          <div className="forum-field">
            <span className="forum-label">{t('notifyMethod')}</span>
            <div className="forum-seg" role="group" aria-label={t('notifyMethod')}>
              <button
                type="button" className="forum-seg-btn" aria-pressed={notify === 'inbox'}
                onClick={() => { setNotify('inbox') }}
              >{t('notifyInboxShort')}</button>
              <button
                type="button" className="forum-seg-btn" aria-pressed={notify === 'wake'}
                onClick={() => { setNotify('wake') }}
              >{t('notifyWakeShort')}</button>
            </div>
          </div>
          {error !== '' && <p className="forum-form-error" role="alert">{error}</p>}
        </div>
        <div className="forum-modal-foot">
          <span />
          <div className="forum-actions">
            <button type="button" className="forum-btn forum-ghost" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="forum-btn forum-primary" disabled={!canSubmit}>
              {t('send')}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

/** The up/down pair, showing the reader's own attitude and clearing it on a second click. */
function VoteButtons(props: {
  readonly t: (key: ForumKey) => string
  readonly up: number
  readonly down: number
  readonly myVote: 'up' | 'down' | undefined
  readonly disabled: boolean
  readonly onVote: (value: 'up' | 'down') => void
}) {
  const { t, up, down, myVote, disabled, onVote } = props
  return (
    <div className="forum-vote-group">
      <button
        type="button" className="forum-vote" aria-pressed={myVote === 'up'} disabled={disabled}
        aria-label={t('upvote')} onClick={() => { onVote('up') }}
      ><span aria-hidden="true">↑</span> {up}</button>
      <button
        type="button" className="forum-vote" aria-pressed={myVote === 'down'} disabled={disabled}
        aria-label={t('downvote')} onClick={() => { onVote('down') }}
      ><span aria-hidden="true">↓</span> {down}</button>
    </div>
  )
}

/** The notification card, collapsible and read on demand. */
function NotificationsCard(props: {
  readonly t: (key: ForumKey) => string
  readonly items: readonly NotificationView[]
  readonly loaded: boolean
  readonly attached: boolean
  readonly readOnly: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly onRead: () => void
  readonly onMarkAllRead: () => void
}) {
  const { t, items, loaded, attached, readOnly, open, onToggle, onRead, onMarkAllRead } = props
  return (
    <section className="forum-side-card">
      <button type="button" className="forum-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="forum-card-title">{t('notifications')}</span>
        {items.length > 0 && <span className="forum-count">{items.length}</span>}
        <ChevronIcon />
      </button>
      {open && (
        <div className="forum-card-body">
          <button
            type="button" className="forum-btn forum-wide"
            disabled={!attached || readOnly} onClick={onRead}
          >{loaded ? t('refreshNotifications') : t('readNotifications')}</button>
          {items.length === 0
            ? <p className="forum-side-hint">{loaded ? t('noNotifications') : t('notificationsHint')}</p>
            : (
              <>
                <div className="forum-notif-list">
                  {items.map(item => (
                    <div key={item.id} className="forum-notif">
                      <p>{item.summary}</p>
                      <div className="forum-notif-meta">
                        <span className={item.reason === 'mention' ? 'forum-reason' : 'forum-reason is-reply'}>
                          {item.reason === 'mention' ? t('mentionsYou') : t('repliedYou')}
                        </span>
                        <span>{item.state === 'read' ? t('read') : t('unread')}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="forum-link forum-wide" onClick={onMarkAllRead}>
                  {t('markAllRead')}
                </button>
              </>
            )}
        </div>
      )}
    </section>
  )
}

/** The per-preset auto-post switches, off by default, collapsed on first paint. */
function AutoPostCard(props: {
  readonly t: (key: ForumKey) => string
  readonly snapshot: AutoPostSnapshot
  readonly readOnly: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly onSave: (settings: readonly AutoPostSetting[]) => Promise<boolean>
}) {
  const { t, snapshot, readOnly, open, onToggle, onSave } = props
  const [drafts, setDrafts] = useState<Readonly<Record<string, AutoPostSetting>>>({})
  const [pending, setPending] = useState(false)
  const settings = snapshot.settings.map(setting => drafts[setting.preset] ?? setting)
  const dirty = Object.keys(drafts).length > 0
  const save = (): void => {
    setPending(true)
    void onSave(settings).then((ok) => { if (ok) setDrafts({}) }).finally(() => { setPending(false) })
  }
  return (
    <section className="forum-side-card">
      <button type="button" className="forum-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="forum-card-title">{t('autoPost')}</span>
        <span className={snapshot.running ? 'forum-status is-on' : 'forum-status'}>
          {snapshot.running ? t('autoPostRunning') : t('autoPostStopped')}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="forum-card-body">
          <p className="forum-side-hint">{t('autoPostHint')}</p>
          {settings.map(setting => (
            <div key={setting.preset} className="forum-auto-row">
              <label className="forum-switch">
                <input
                  type="checkbox" checked={setting.enabled} aria-label={setting.preset}
                  onChange={event => {
                    setDrafts({ ...drafts, [setting.preset]: { ...setting, enabled: event.target.checked } })
                  }}
                />
                <span className="forum-switch-track" aria-hidden="true" />
              </label>
              <div className="forum-auto-info">
                <span className="forum-auto-name">{setting.preset}</span>
                <span className="forum-auto-note">
                  {t('lastAt')}: {snapshot.lastAt[setting.preset] ?? t('never')}
                </span>
                {snapshot.lastError[setting.preset] !== undefined && (
                  <span className="forum-form-error">{snapshot.lastError[setting.preset]}</span>
                )}
              </div>
              <input
                className="forum-input forum-auto-min" type="number" min={1}
                aria-label={t('everyMinutes')} value={setting.everyMinutes}
                onChange={event => {
                  setDrafts({
                    ...drafts,
                    [setting.preset]: { ...setting, everyMinutes: Math.max(1, Number(event.target.value) || 1) },
                  })
                }}
              />
            </div>
          ))}
          <button
            type="button" className="forum-btn forum-primary forum-wide"
            disabled={readOnly || pending || !dirty} onClick={save}
          >{t('save')}</button>
        </div>
      )}
    </section>
  )
}

/** The centered dialog: mask, card, close button, and Escape/backdrop dismissal. */
function Modal(props: {
  readonly title: string
  readonly subtitle: string
  readonly closeLabel: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div
      className="forum-overlay"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="forum-modal" role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="forum-modal-head">
          <div>
            <h2>{props.title}</h2>
            <p>{props.subtitle}</p>
          </div>
          <button type="button" className="forum-icon-btn" aria-label={props.closeLabel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {props.children}
      </div>
    </div>
  )
}

/** The bottom-right toast stack. */
function ToastStack(props: { readonly toasts: readonly Toast[] }) {
  return (
    <div className="forum-toasts" role="status" aria-live="polite">
      {props.toasts.map(toast => (
        <div key={toast.id} className={toast.kind === 'success' ? 'forum-toast is-success' : 'forum-toast is-error'}>
          <span className="forum-toast-icon" aria-hidden="true">
            {toast.kind === 'success' ? <CheckIcon /> : <AlertIcon />}
          </span>
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  )
}

/** Keep one toast per action, capped at three, each gone after 3.2 seconds. */
function useToasts(): {
  readonly toasts: readonly Toast[]
  readonly push: (kind: 'success' | 'error', text: string) => void
} {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const sequence = useRef(0)
  const timers = useRef<number[]>([])
  const push = (kind: 'success' | 'error', text: string): void => {
    sequence.current += 1
    const id = sequence.current
    setToasts(list => [...list.slice(-2), { id, kind, text }])
    const timer = window.setTimeout(() => {
      setToasts(list => list.filter(toast => toast.id !== id))
    }, 3200)
    timers.current.push(timer)
  }
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer)
  }, [])
  return { toasts, push }
}

/** The board's tag vocabulary, read from the posts currently in view. */
function tagOptions(catalog: ForumCatalogSnapshot): readonly string[] {
  const tags = new Set<string>()
  for (const post of catalog.catalog.posts) for (const value of post.tags) tags.add(value)
  return [...tags].sort()
}

/** Split one comma-separated tag field into the list the Host validates. */
function splitTags(raw: string): readonly string[] {
  return raw.split(',').map(value => value.trim()).filter(value => value !== '')
}

/** Count a comment tree, replies included. */
function countComments(nodes: readonly CommentNodeView[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countComments(node.replies)
  return total
}

/** One-letter avatar text. */
function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase()
}

/** Render one failure as a single line. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="forum-search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="forum-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8H4M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 5.5h16v11H10l-4.5 3v-3H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 9.5h8M8 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 4v5M8 11.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
