/**
 * The centered feed: the filter toolbar, the feed heading, the post cards, and
 * the empty/skeleton guides. Selection stays one level up — the feed only
 * reports intent through its callbacks.
 *
 * 居中的帖子流：筛选工具栏、流标题、帖子卡片与空态/骨架引导。选中状态留在上一层——
 * 帖子流只通过回调上报意图。
 *
 * @module @veren/forum-ui/client/panel-feed
 */

import { useMemo } from 'react'
import type { ForumCatalogSnapshot } from './catalog.ts'
import { POST_SORTS } from './remote.ts'
import type { PostSort, PostView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import { initial } from './panel-model.ts'
import { ChatIcon, PlusIcon, SearchIcon, VoteButtons } from './panel-kit.tsx'

/** The board's tag vocabulary, read from the posts currently in view. 板块的标签词汇表，从当前可见帖子里读取。 */
function tagOptions(catalog: ForumCatalogSnapshot): readonly string[] {
  const tags = new Set<string>()
  for (const post of catalog.catalog.posts) for (const value of post.tags) tags.add(value)
  return [...tags].sort()
}

/** The feed's filter toolbar: search, tag filter, and sort order. 信息流筛选工具栏：搜索、标签筛选与排序。 */
function FeedToolbar(props: {
  readonly t: (key: ForumKey) => string
  readonly tags: readonly string[]
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly tag: string
  readonly onTag: (value: string) => void
  readonly sort: PostSort
  readonly onSort: (value: PostSort) => void
}) {
  const { t, tags, query, onQuery, tag, onTag, sort, onSort } = props
  return (
    <div className="forum-toolbar">
      <div className="forum-search">
        <SearchIcon />
        <input
          className="forum-input" value={query} placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          onChange={event => { onQuery(event.target.value) }}
        />
      </div>
      <select
        className="forum-select" value={tag} aria-label={t('tag')}
        onChange={event => { onTag(event.target.value) }}
      >
        <option value="">{t('allTags')}</option>
        {tags.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <select
        className="forum-select" value={sort} aria-label={t('sort')}
        onChange={event => { onSort(event.target.value as PostSort) }}
      >
        {POST_SORTS.map(value => (
          <option key={value} value={value}>
            {value === 'heat' ? t('sortHeat') : value === 'new' ? t('sortNew') : t('sortViews')}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The feed heading: the board title (or fallback) and the live post count. 信息流标题：板块标题（或回退）与帖子计数。 */
function FeedHeading(props: {
  readonly t: (key: ForumKey) => string
  readonly boardTitle: string | undefined
  readonly count: number
  readonly loading: boolean
}) {
  const { t, boardTitle, count, loading } = props
  return (
    <div className="forum-feed-head">
      <h2 className="forum-feed-title">
        {boardTitle ?? t('posts')}
        <span className="forum-count">{count}</span>
        {loading && <span className="forum-live">{t('loading')}</span>}
      </h2>
    </div>
  )
}

/** The empty feed: which guide to show depends on whether any board exists. 空信息流：按是否存在板块选择引导文案。 */
function FeedEmpty(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: number
  readonly onCreate: () => void
}) {
  const { t, boards, onCreate } = props
  return (
    <div className="forum-empty">
      <span className="forum-empty-icon"><ChatIcon /></span>
      <h3>{boards === 0 ? t('noBoards') : t('emptyTitle')}</h3>
      <p>{boards === 0 ? t('notificationsHint') : t('emptyBody')}</p>
      {boards > 0 && (
        <button type="button" className="forum-btn forum-primary" onClick={onCreate}>
          <PlusIcon />
          {t('emptyCta')}
        </button>
      )}
    </div>
  )
}

/** The feed list: skeletons while loading, the empty guide, or the post cards. 信息流列表：加载骨架、空态引导或帖子卡片。 */
function FeedList(props: {
  readonly t: (key: ForumKey) => string
  readonly catalog: ForumCatalogSnapshot
  readonly posts: readonly PostView[]
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly loading: boolean
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onOpenPost: (postId: string) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly onPin: (postId: string, pinned: boolean) => void
  readonly onCreate: () => void
}) {
  const { t, catalog, posts, actor, readOnly, loading, onOpenPost, onCreate } = props
  return (
    <div className="forum-feed">
      {loading
        ? [0, 1, 2].map(index => <div key={index} className="forum-skeleton" aria-hidden="true" />)
        : posts.length === 0
          ? (
            <FeedEmpty t={t} boards={catalog.catalog.boards.length} onCreate={onCreate} />
          )
          : posts.map(post => (
            <PostCard
              key={post.id} t={t} post={post} actor={actor} readOnly={readOnly}
              myVote={props.voteOf('post', post.id, post.myVote)}
              onOpenPost={onOpenPost} onVote={props.onVote} onPin={props.onPin}
            />
          ))}
    </div>
  )
}

/** The centered feed: filters, the post cards, and the guides. 居中帖子流：筛选器、帖子卡片与空态/骨架引导。 */
export function Feed(props: {
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
  const { t, catalog, posts, boardTitle, actor, readOnly } = props
  const tags = useMemo(() => tagOptions(catalog), [catalog])
  const loading = catalog.status === 'loading' && !catalog.settled
  return (
    <>
      <FeedToolbar
        t={t} tags={tags} query={props.query} onQuery={props.onQuery}
        tag={props.tag} onTag={props.onTag} sort={props.sort} onSort={props.onSort}
      />
      <FeedHeading
        t={t} boardTitle={boardTitle} count={posts.length} loading={catalog.status === 'loading'}
      />
      <FeedList
        t={t} catalog={catalog} posts={posts} actor={actor} readOnly={readOnly} loading={loading}
        voteOf={props.voteOf} onOpenPost={props.onOpenPost} onVote={props.onVote}
        onPin={props.onPin} onCreate={props.onCreate}
      />
    </>
  )
}

/** One post's footer: the vote pair, the counts, and the pin/reply actions. 一条帖子的脚部：投票对、计数与置顶/回复动作。 */
function PostFoot(props: {
  readonly t: (key: ForumKey) => string
  readonly post: PostView
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly myVote: 'up' | 'down' | undefined
  readonly onOpenPost: (postId: string) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly onPin: (postId: string, pinned: boolean) => void
}) {
  const { t, post, actor, readOnly, myVote, onOpenPost, onVote, onPin } = props
  return (
    <div className="forum-post-foot">
      <div className="forum-vote-group">
        <VoteButtons
          t={t} up={post.up} down={post.down} myVote={myVote}
          disabled={readOnly || actor === undefined}
          onVote={value => { onVote('post', post.id, value, myVote) }}
        />
      </div>
      <span className="forum-stat">{post.views} {t('views')}</span>
      <span className="forum-dot">·</span>
      <span className="forum-stat">{post.commentCount} {t('comments')}</span>
      <div className="forum-post-actions">
        <button
          type="button" className="forum-btn forum-ghost" disabled={readOnly}
          onClick={() => { onPin(post.id, !post.pinned) }}
        >{post.pinned ? t('unpin') : t('pin')}</button>
        <button
          type="button" className="forum-btn"
          onClick={() => { onOpenPost(post.id) }}
        >{t('reply')}</button>
      </div>
    </div>
  )
}

/** One post row: title, author, excerpt, counts, and the three quick actions. 一条帖子行：标题、作者、摘要、计数与三个快捷动作。 */
export function PostCard(props: {
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
      <PostFoot
        t={t} post={post} actor={actor} readOnly={readOnly} myVote={props.myVote}
        onOpenPost={props.onOpenPost} onVote={props.onVote} onPin={props.onPin}
      />
    </article>
  )
}
