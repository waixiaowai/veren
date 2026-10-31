/**
 * The comment tree of one thread: the section with its count and empty guide,
 * the recursive comment card, and one card's vote/reply footer. Cards recurse
 * through themselves, so a reply's replies render with the same folding rule.
 *
 * 一条主题的评论树：含计数与空态引导的区块、递归的评论卡片，以及单张卡片的投票/回复
 * 脚部。卡片通过自身递归，回复的回复按同一折叠规则渲染。
 *
 * @module @veren/forum-ui/client/panel-comments
 */

import { useState } from 'react'
import type { CommentNodeView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import { initial } from './panel-model.ts'
import type { ReplyTarget } from './panel-model.ts'
import { VoteButtons } from './panel-kit.tsx'

/** One comment's footer: the vote pair and, above the depth limit, the reply action. 一条评论的脚部：投票对，以及未达深度上限时的回复动作。 */
function CommentFoot(props: {
  readonly t: (key: ForumKey) => string
  readonly comment: CommentNodeView
  readonly actor: string | undefined
  readonly busy: boolean
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onReply: (target: ReplyTarget) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
}) {
  const { t, comment, actor, busy, onReply, onVote } = props
  return (
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
  )
}

/** A comment's direct replies, rendered as nested cards. 一条评论的直接回复，渲染为嵌套卡片。 */
function CommentReplies(props: {
  readonly t: (key: ForumKey) => string
  readonly replies: readonly CommentNodeView[]
  readonly actor: string | undefined
  readonly busy: boolean
  readonly postAuthor: string
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onReply: (target: ReplyTarget) => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
}) {
  const { t, replies, actor, busy, postAuthor, voteOf, onReply, onVote } = props
  if (replies.length === 0) return null
  return (
    <div className="forum-replies">
      {replies.map(reply => (
        <CommentCard
          key={reply.id} t={t} comment={reply} actor={actor} busy={busy}
          postAuthor={postAuthor} voteOf={voteOf} onReply={onReply} onVote={onVote}
        />
      ))}
    </div>
  )
}

/** One comment, its folded body, its votes, and its direct replies. 一条评论：折叠正文、投票与直接回复。 */
export function CommentCard(props: {
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
      <CommentFoot
        t={t} comment={comment} actor={actor} busy={busy} voteOf={props.voteOf}
        onReply={onReply} onVote={onVote}
      />
      <CommentReplies
        t={t} replies={comment.replies} actor={actor} busy={busy} postAuthor={postAuthor}
        voteOf={props.voteOf} onReply={onReply} onVote={onVote}
      />
    </article>
  )
}

/** One thread's comments: the counted section head, the empty guide, or the tree. 一条主题的评论：带计数的区块头、空态引导或评论树。 */
export function CommentsSection(props: {
  readonly t: (key: ForumKey) => string
  readonly comments: readonly CommentNodeView[]
  readonly total: number
  readonly actor: string | undefined
  readonly busy: boolean
  readonly postAuthor: string
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onReply: (target: ReplyTarget) => void
  readonly onStartReply: () => void
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
}) {
  const { t, comments, total, actor, busy, postAuthor, voteOf, onReply, onStartReply, onVote } = props
  return (
    <section className="forum-comments">
      <div className="forum-section-head">
        <h3>{t('comments')}<span className="forum-count">{total}</span></h3>
      </div>
      {comments.length === 0
        ? (
          <div className="forum-empty forum-empty-sm">
            <h3>{t('noReplies')}</h3>
            <button
              type="button" className="forum-btn" disabled={actor === undefined}
              onClick={onStartReply}
            >{t('writeReply')}</button>
          </div>
        )
        : comments.map(comment => (
          <CommentCard
            key={comment.id} t={t} comment={comment} actor={actor} busy={busy}
            postAuthor={postAuthor} voteOf={voteOf}
            onReply={onReply} onVote={onVote}
          />
        ))}
    </section>
  )
}
