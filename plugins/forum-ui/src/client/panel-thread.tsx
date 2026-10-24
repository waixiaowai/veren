/**
 * One post's discussion view: the thread card, the comment tree, and the reply
 * modal. The tree is rendered recursively with the same folding rule as before
 * — a foldable comment collapses to 200 characters until the reader expands it.
 *
 * 一条帖子的讨论视图：主题卡片、评论树与回复模态框。评论树按此前的同一折叠规则递归渲染——
 * 可折叠评论先收起为 200 字符，读者点开后才展示全文。
 *
 * @module @veren/forum-ui/client/panel-thread
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { messageOf } from './catalog.ts'
import type { CommentNodeView, PostDetailView } from './remote.ts'
import type { CommentInput } from './panel-model.ts'
import type { ForumKey } from './locales.ts'
import { initial } from './panel-model.ts'
import { ArrowLeftIcon, Modal, VoteButtons } from './panel-kit.tsx'

/** Where one reply modal points, when a comment started it. 回复模态框的指向：由某条评论发起时记录它。 */
interface ReplyTarget {
  readonly commentId?: string
  readonly author?: string
}

/** Count a comment tree, replies included. 统计评论树，含所有回复。 */
function countComments(nodes: readonly CommentNodeView[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countComments(node.replies)
  return total
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

/** One comment, its folded body, its votes, and its direct replies. 一条评论：折叠正文、投票与直接回复。 */
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

/** The reply box, in a centered modal. 居中模态框里的回复框。 */
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
