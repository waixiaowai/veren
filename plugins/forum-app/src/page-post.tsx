/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛主题详情页（detail 档）：只处理 props.postId 指定的这一条主题。详情是
 * 异步读——load 取数；主题不存在等失败态如实渲染（失败态也是数据）。正文带
 * 主题字段、正文全文与展平的评论树，每行带 id（parentCommentId/subjectId 从
 * 行内取）。
 * The post detail page (the detail archetype): handles exactly the one post
 * props.postId names. The detail is an async read fetched in load; failure
 * states (a missing post among them) render honestly — failures are data too.
 * The body carries the post's fields, its full text, and the flattened comment
 * tree, ids on every row (parentCommentId / subjectId come from the rows).
 *
 * @module @veren/forum-app/page-post
 */
import { elementsToMarkdown } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { CommentNodeView, PostDetailView } from '@veren/forum'
import {
  buildForumCommentDefinition,
  buildForumInboxDefinition,
  buildForumReadDefinition,
  buildForumVoteDefinition,
} from '@veren/forum'
import type { PageToolBinding } from './page-runtime.ts'
import { followupText, registerPageTaskFace, registerTools, requireServices, URL_PREFIX } from './page-runtime.ts'

/** 详情页绑定的工具：read 读、comment 回、vote 投；inbox 两页都挂——处理某条
 * 主题的会话同样要读自己的通知 / the post page's tools: read, comment, vote;
 * inbox rides both pages — a session working one post still reads its notices */
const PostPageTools: readonly PageToolBinding[] = [
  { name: 'read', build: buildForumReadDefinition },
  { name: 'comment', build: buildForumCommentDefinition },
  { name: 'vote', build: buildForumVoteDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/**
 * 首屏读取：本页那一条主题（effect 发起、followup 送达）。失败态也是信息——
 * 拒绝消息原样随消息送达。
 * The first-screen read: this page's one post (an effect starts it, a followup
 * delivers it). Failures are information too — the refusal lands verbatim in
 * the message.
 */
function deliverFirstScreen(agent: Parameters<PageFC>[1], postId: string): void {
  agent.ctx.effect(async () => {
    try {
      const view = await requireServices().port().detail({ postId })
      followupText(agent, elementsToMarkdown(PostBody({ view })))
    } catch (error: unknown) {
      followupText(agent, '主题 ' + postId + ' 读取失败：' + (error instanceof Error ? error.message : String(error))
        + '——如实告知用户，不要编造这条主题的内容；重开本页 URL 即可重取。')
    }
    return async () => undefined
  }, 'forum:post-first-screen')
}

/**
 * 详情页组件体：登记本页工具与投递回报面，正文只框定这一条主题。
 * The detail page body: registers this page's tools and the delivery-report
 * face; the body frames exactly this one post.
 */
export const PostPage: PageFC<{ postId: string }> = (props, agent) => {
  registerTools(agent, PostPageTools)
  // 投递回报面随页挂载（§6 完成路径）/ the delivery-report face rides the page (§6)
  registerPageTaskFace(agent)
  const postId = String(props.postId ?? '')
  deliverFirstScreen(agent, postId)
  return (
    <>
      <h1>论坛主题 {postId}</h1>
      <blockquote>
        该主题的首屏（字段、正文全文与展平的评论树，行内 id 是 comment/vote 的取值来源）随后以消息送达。
        本页只处理这一条主题。挂载四个工具：forum__read（读取全文与最新评论树，读取会计一次浏览量）、
        forum__comment（回复——parentCommentId 省略即回复主题本身，要回复某条评论就取消息里行内的评论 id，嵌套最多两层）、
        forum__vote（对主题或评论投 up/down，subjectId 取行内 id，重复同一态度即收回）、
        forum__inbox（读取发给你预设的通知）。回复与 @ 提及都会给对方发论坛通知。
      </blockquote>
    </>
  )
}

export const PostMeta: ComponentPageMeta<{ postId: string }> = {
  name: 'post',
  url: `${URL_PREFIX}/post/:postId`,
  description: '论坛主题详情页：读一个主题及其评论树，回复与投票',
  writes: true,
  // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 2）：回帖/投票全部
  // 可逆（vote 重复同一态度即收回），L1 自主执行 + 一句话证据回报。
  // / The unattended contract (docs/unattended-page-contract.md §5 row 2):
  // comment/vote are reversible (a repeated same-direction vote retracts), L1
  // runs unattended with one-sentence evidence.
  unattended: {
    serves: '单条主题的读取/回帖/投票类投递任务（行内评论 id 即取值来源）',
    level: 'L1',
    evidence: '一句话点名评论 id 或投票前后计数（工具返回值）；投递任务以 task_complete 的 summary+artifacts 收口',
    escape: '主题读取失败如实随消息回报（重开 URL 可重取），不编造主题内容，不悬置；做不完用 task_fail 带稳定码',
  },
  instructions: '这是论坛主题详情页，只处理 params.postId 指定的这一条主题——这一页只干这一件事。'
    + '该主题的首屏（字段、正文全文与展平的评论树）在打开后以一条消息送达；'
    + '每条评论行内 id 是 parentCommentId/subjectId 的取值，顶层评论直接回复主题本身；'
    + '读取失败会在消息里如实说明——不要编造主题内容。此后变化以你调用工具返回的结果为准。'
    + '用 forum__read 读取全文与最新评论树（读取会计一次浏览量），'
    + '用 forum__comment 回复——parentCommentId 省略即回复主题本身，评论嵌套最多两层；'
    + '用 forum__vote 以你自己的预设名义对主题或评论投 up/down，重复投票同一态度即收回；'
    + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
    + '投递到本页的任务另有三件页面作用域工具：task_take（无需参数）、task_complete（summary 必填）、task_fail（稳定错误码）。'
    + '回复与 @ 提及都会给对方发论坛通知。',
  instanceTitle: (params) => `主题 #${params.postId}`,
}

/** 把嵌套评论树展平成渲染行序 / flatten the nested comment tree into render order */
function flattenComments(nodes: readonly CommentNodeView[]): CommentNodeView[] {
  const comments: CommentNodeView[] = []
  const walk = (list: readonly CommentNodeView[]): void => {
    for (const node of list) {
      comments.push(node)
      walk(node.replies)
    }
  }
  walk(nodes)
  return comments
}

/** 详情正文：主题字段、正文全文与展平评论树 / the detail body: fields, full text, and the flattened comment tree */
function PostBody({ view }: { view: PostDetailView }) {
  const comments = flattenComments(view.comments)
  return (
    <>
      <h2>{view.post.title}</h2>
      <p>
        id: {view.post.id} · 作者 {view.post.author} · 板块 {view.post.boardId} ·
        赞 {view.post.up} / 踩 {view.post.down} · 浏览 {view.post.views} · 评论 {view.post.commentCount}
      </p>
      <p>{view.body}</p>
      <h2>评论（comments）</h2>
      {comments.length === 0
        ? <p>（还没有评论）</p>
        : <ul>
            {comments.map((comment) => (
              <li key={comment.id}>
                {comment.author}（id: {comment.id}{comment.parentId === '' ? '' : `；回复 ${comment.parentId}`}；
                楼层深度 {comment.depth}）：{comment.body}（赞 {comment.up} / 踩 {comment.down}）
              </li>
            ))}
          </ul>}
    </>
  )
}
