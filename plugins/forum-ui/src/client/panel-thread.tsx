/**
 * One post's discussion view: the back button, the thread card, and the reply
 * modal wiring. The comment tree lives in `panel-comments`, the reply form in
 * `panel-reply`; both are composed here with the same markup as before.
 *
 * 一条帖子的讨论视图：返回按钮、主题卡片与回复模态框的接线。评论树在 `panel-comments`，
 * 回复表单在 `panel-reply`；此处按此前的同一标记组合它们。
 *
 * @module @veren/forum-ui/client/panel-thread
 */

import { useState } from 'react'
import type { CommentNodeView, PostDetailView, PostView } from './remote.ts'
import type { CommentInput } from './panel-model.ts'
import type { ForumKey } from './locales.ts'
import { initial } from './panel-model.ts'
import type { ReplyTarget } from './panel-model.ts'
import { ArrowLeftIcon, VoteButtons } from './panel-kit.tsx'
import { CommentsSection } from './panel-comments.tsx'
import { ReplyModal } from './panel-reply.tsx'

/** Count a comment tree, replies included. 统计评论树，含所有回复。 */
function countComments(nodes: readonly CommentNodeView[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countComments(node.replies)
  return total
}

/** One post's meta line: author, view/comment counts, pin chip, and tags. 帖子元信息行：作者、浏览/评论计数、置顶标记与标签。 */
function ThreadMeta(props: {
  readonly t: (key: ForumKey) => string
  readonly post: PostView
  readonly total: number
}) {
  const { t, post, total } = props
  return (
    <div className="forum-post-meta">
      <span className="forum-avatar" aria-hidden="true">{initial(post.author)}</span>
      <span className="forum-post-author">{post.author}</span>
      <span className="forum-dot">·</span>
      <span className="forum-stat">{post.views} {t('views')}</span>
      <span className="forum-dot">·</span>
      <span className="forum-stat">{total} {t('comments')}</span>
      {post.pinned && <span className="forum-chip is-warn">{t('pinned')}</span>}
      {post.tags.length > 0 && <span className="forum-dot">·</span>}
      {post.tags.map(value => <span key={value} className="forum-chip">{value}</span>)}
    </div>
  )
}

/** The thread's article: title with its actions, the meta line, and the votes. 主题文章卡片：标题与动作、元信息行与投票。 */
function ThreadCard(props: {
  readonly t: (key: ForumKey) => string
  readonly detail: PostDetailView
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly voteOf: (kind: 'post' | 'comment', id: string, fallback: 'up' | 'down' | undefined) => 'up' | 'down' | undefined
  readonly onVote: (kind: 'post' | 'comment', id: string, value: 'up' | 'down', current?: 'up' | 'down') => void
  readonly onPin: (postId: string, pinned: boolean) => void
  readonly onStartReply: () => void
}) {
  const { t, detail, actor, readOnly, onPin, onStartReply } = props
  const total = countComments(detail.comments)
  return (
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
            onClick={onStartReply}
          >{t('reply')}</button>
        </div>
      </div>
      <ThreadMeta t={t} post={detail.post} total={total} />
      <p className="forum-thread-body">{detail.body}</p>
      <div className="forum-thread-foot">
        <VoteButtons
          t={t} up={detail.post.up} down={detail.post.down}
          myVote={props.voteOf('post', detail.post.id, detail.post.myVote)}
          disabled={readOnly || actor === undefined}
          onVote={value => { props.onVote('post', detail.post.id, value, props.voteOf('post', detail.post.id, detail.post.myVote)) }}
        />
      </div>
    </article>
  )
}

/** The thread's reply modal, pointed at the post or at one comment. 主题的回复模态框，指向帖子或某条评论。 */
function ThreadReplyModal(props: {
  readonly t: (key: ForumKey) => string
  readonly target: ReplyTarget
  readonly actor: string | undefined
  readonly readOnly: boolean
  readonly postId: string
  readonly onComment: (input: CommentInput) => Promise<boolean>
  readonly onClose: () => void
}) {
  const { t, target, actor, readOnly, postId, onComment, onClose } = props
  return (
    <ReplyModal
      t={t} author={target.author} actor={actor} readOnly={readOnly} onClose={onClose}
      onSubmit={async (body, notify) => onComment({
        postId, author: actor ?? '', body, notifyMode: notify,
        ...target.commentId === undefined ? {} : { parentCommentId: target.commentId },
      })}
    />
  )
}

/** One post's discussion: the body, the comment tree, and its reply modal. 一条帖子的讨论：正文、评论树与回复模态框。 */
export function Thread(props: {
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
  return (
    <div className="forum-thread">
      <button type="button" className="forum-btn forum-ghost forum-back" onClick={onBack}>
        <ArrowLeftIcon />
        {t('back')}
      </button>
      <ThreadCard
        t={t} detail={detail} actor={actor} readOnly={readOnly} voteOf={props.voteOf}
        onVote={onVote} onPin={onPin} onStartReply={() => { setReplyTo({}) }}
      />
      <CommentsSection
        t={t} comments={detail.comments} total={countComments(detail.comments)} actor={actor}
        busy={readOnly} postAuthor={detail.post.author} voteOf={props.voteOf}
        onReply={target => { setReplyTo(target) }} onStartReply={() => { setReplyTo({}) }}
        onVote={onVote}
      />
      {replyTo !== undefined && (
        <ThreadReplyModal
          t={t} target={replyTo} actor={actor} readOnly={readOnly} postId={detail.post.id}
          onComment={onComment} onClose={() => { setReplyTo(undefined) }}
        />
      )}
    </div>
  )
}
