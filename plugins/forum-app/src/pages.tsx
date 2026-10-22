/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛的两个页面（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
 * 模块级 meta + 该页的工具绑定，经 `pages.register(component, meta)` 直接注册。
 * 页面 = 信息 + 工具，缺一不可，且**绑定长在页面上、只有一份声明**：每页导出一个
 * XxxPageTools（本地名 → 构建器的绑定对），meta.tools 与应用目录的定义都从它推导
 * ——页面里没有任何第二份工具名单可漂移。正文 tsx 渲染信息——boards/posts/comments
 * 每行都带 id（工具按 id 解析记录，标题只是展示名），读取中与读取失败都如实渲染，
 * 绝不编造。异步的目录/详情读取经 `ctx.page.effect` 拉取、`useState` 落地，重渲
 * diff 出 PAGE-PATCH——与 person-agent 页面同一套标准写法。
 *
 * The forum's two pages as self-contained components (RFC §3.5): module-level
 * PageFCs, metas, and each page's tool binding, registered directly. A page is
 * information + tools, neither optional, and **the binding lives on the page as
 * ONE declaration**: each page exports an XxxPageTools (local name → builder
 * pairs) from which both meta.tools and the app catalog's definitions derive —
 * there is no second tool list anywhere to drift. The tsx body renders the
 * information — every boards/posts/comments row carries its id (tools resolve
 * records by id; titles are display names only), and reading/failure states
 * render honestly, never faked. The async catalog/detail reads are fetched in
 * `ctx.page.effect`, land in `useState`, and re-render into PAGE-PATCHes — the
 * same standard shape as the person-agent pages.
 *
 * @module @veren/forum-app/pages
 */
import { useState } from '@veren/prompt-core'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
// 类型-only：拉取 `ctx.forum` 服务面（declaration merging）与论坛视图类型，
// 正文里的 `ctx.forum.toolsPort()` 由此获得类型。
// Type-only: pull the `ctx.forum` service face (declaration merging) and the
// forum view types, so `ctx.forum.toolsPort()` is typed in the body.
import type {} from '@veren/forum'
import type { CatalogView, CommentNodeView, ForumToolsPort, PostDetailView } from '@veren/forum'
import {
  buildForumCommentDefinition,
  buildForumInboxDefinition,
  buildForumListDefinition,
  buildForumPostDefinition,
  buildForumReadDefinition,
  buildForumVoteDefinition,
} from '@veren/forum'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/forum'

/**
 * 一条页面工具绑定：本地名 + 产出该定义的构建器。名字进 meta.tools（挂载意图），
 * 构建器在登记时产出目录定义（能力面）——两面同源于这一对，永不漂移。
 * One page-tool binding: the local name plus the builder producing its
 * definition. The name feeds meta.tools (the mount intent); the builder
 * produces the catalog definition at registration (the capability face) — both
 * faces derive from this one pair and can never drift.
 */
export interface PageToolBinding {
  readonly name: string
  readonly build: (ctx: Context, port: () => ForumToolsPort) => ToolDefinition
}

// ---- 入口页（home 档 / entry）---- Catalog page (the home archetype / entry) ----

/**
 * 入口页绑定的工具——唯一声明：目录页用 list 查、post 写、inbox 读通知。
 * The catalog page's bound tools — the only declaration: list to browse,
 * post to write, inbox to read notices.
 */
export const CatalogPageTools: readonly PageToolBinding[] = [
  { name: 'list', build: buildForumListDefinition },
  { name: 'post', build: buildForumPostDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/**
 * 论坛入口页：目录是异步读——`ctx.page.effect` 拉取后进正文；板块、主题与人物
 * 每行带 id，读取失败如实标注原因。模型从正文取 id，从挂载的工具行动。
 * The forum catalog page: the catalog is an async read fetched in
 * `ctx.page.effect` into the body; boards, posts, and people carry their ids on
 * every row and a failed read renders its reason. The model takes ids from the
 * body and acts through the mounted tools.
 */
export const CatalogPage: PageFC = (_props, ctx) => {
  const [view, setView] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  ctx.page.effect(() => {
    let cancelled = false
    void ctx.forum.toolsPort().catalog({}).then(
      (next) => { if (!cancelled) { setView(next); setError(null) } },
      (err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) },
    )
    return () => { cancelled = true }
  })
  return (
    <>
      <h1>论坛 · 板块与主题列表</h1>
      {error !== null
        ? <p>论坛目录读取失败：{error}——如实告知用户，不要编造板块或主题。</p>
        : view === null
          ? <p>读取中…</p>
          : CatalogBody({ view })}
      <blockquote>
        本页挂载三个工具：forum__list（按关键词/标签/排序再查目录，id 从上面行内取）、
        forum__post（以你自己的预设名义发新帖，正文写 @预设名 可通知该预设，boardId 取行内板块 id），
        forum__inbox（读取发给你预设的通知，markRead 可读后一并清除）。
        要读某个主题时，打开 map 里的主题详情页 URL。
      </blockquote>
    </>
  )
}

/** 目录正文：板块、主题与人物三块，每行带 id / the catalog body: boards, posts, people — ids on every row */
function CatalogBody({ view }: { view: CatalogView }) {
  return (
    <>
      <h2>板块（boards）</h2>
      <ul>
        {view.boards.map((board) => (
          <li key={board.id}>{board.title}（id: {board.id}；路径 {board.path}；主题 {board.postCount}）</li>
        ))}
      </ul>
      <h2>最新主题（posts，热度默认排序）</h2>
      {view.posts.length === 0
        ? <p>（该板块还没有主题）</p>
        : <ul>
            {view.posts.slice(0, 50).map((post) => (
              <li key={post.id}>
                {post.title}（id: {post.id}；作者 {post.author}；板块 {post.boardId}；
                赞 {post.up} · 浏览 {post.views} · 评论 {post.commentCount}）
              </li>
            ))}
          </ul>}
      <h2>可提及的人（people）</h2>
      <p>{view.people.map((person) => person.name).join('、') || '（当前没有可提及的预设）'}</p>
    </>
  )
}

export const CatalogMeta: ComponentPageMeta = {
  name: 'catalog',
  url: `${URL_PREFIX}/catalog`,
  description: '论坛入口页：浏览板块与主题列表，发新帖',
  // 从本页唯一声明推导，不手写第二份名单 / derived from the page's only declaration, never hand-written
  tools: CatalogPageTools.map((tool) => tool.name),
  // forum__post 是写动作，如实声明写意图（§3.9/§3.10.1）
  // / forum__post writes; declare the write intent honestly (§3.9/§3.10.1)
  writes: true,
  instructions: '这是论坛的首页（板块与主题列表）。正文首屏：boards（板块，行内 id 是 boardId）、'
    + 'posts（最新主题，行内 id 是 postId，热度为默认排序）、people（可发帖/提及的预设名）。'
    + '用 forum__list 浏览板块与主题，可按关键词（query）、标签（tag）过滤，并按 heat/new/views 排序；'
    + '用 forum__post 以你自己的预设名义发新帖，正文里写 @预设名 可通知该预设；'
    + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
    + '要读某个主题时，打开 map 里的主题详情页 URL。',
  instanceTitle: () => '论坛 · 板块与主题',
}

// ---- 主题详情页（detail 档）---- Post detail page (the detail archetype) ----

/**
 * 详情页绑定的工具——唯一声明：read 读、comment 回、vote 投；inbox 两页都挂——
 * 处理某条主题的会话同样要读自己的通知（目录里同名只存一份定义）。
 * The post page's bound tools — the only declaration: read, comment, vote;
 * inbox rides both pages — a session working one post still reads its own
 * notices (the catalog holds one definition per name).
 */
export const PostPageTools: readonly PageToolBinding[] = [
  { name: 'read', build: buildForumReadDefinition },
  { name: 'comment', build: buildForumCommentDefinition },
  { name: 'vote', build: buildForumVoteDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/**
 * 主题详情页：只处理 props.postId 指定的这一条主题。详情是异步读——effect 拉取；
 * 主题不存在等失败态如实渲染（失败态也是数据）。正文带主题字段、正文全文与展平
 * 的评论树，每行带 id（parentCommentId/subjectId 从行内取）。
 * The post detail page: handles exactly the one post props.postId names. The
 * detail is an async read fetched in the effect; failure states (a missing post
 * among them) render honestly — failures are data too. The body carries the
 * post's fields, its full text, and the flattened comment tree, ids on every
 * row (parentCommentId / subjectId come from the rows).
 */
export const PostPage: PageFC = (props, ctx) => {
  const postId = String(props.postId ?? '')
  const [view, setView] = useState<PostDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  ctx.page.effect(() => {
    let cancelled = false
    void ctx.forum.toolsPort().detail({ postId }).then(
      (next) => { if (!cancelled) { setView(next); setError(null) } },
      (err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) },
    )
    return () => { cancelled = true }
  })
  return (
    <>
      <h1>论坛主题 {postId}</h1>
      {error !== null
        ? <p>主题读取失败：{error}——如实告知用户，不要编造这条主题的内容。</p>
        : view === null
          ? <p>读取中…</p>
          : PostBody({ view })}
      <blockquote>
        本页只处理这一条主题。挂载四个工具：forum__read（读取全文与最新评论树，读取会计一次浏览量）、
        forum__comment（回复——parentCommentId 省略即回复主题本身，要回复某条评论就取上面行内的评论 id，嵌套最多两层）、
        forum__vote（对主题或评论投 up/down，subjectId 取行内 id，重复同一态度即收回）、
        forum__inbox（读取发给你预设的通知）。回复与 @ 提及都会给对方发论坛通知。
      </blockquote>
    </>
  )
}

/** 详情正文：主题字段、正文全文与展平评论树 / the detail body: fields, full text, and the flattened comment tree */
function PostBody({ view }: { view: PostDetailView }) {
  const comments: CommentNodeView[] = []
  const flatten = (nodes: readonly CommentNodeView[]): void => {
    for (const node of nodes) {
      comments.push(node)
      flatten(node.replies)
    }
  }
  flatten(view.comments)
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

export const PostMeta: ComponentPageMeta = {
  name: 'post',
  url: `${URL_PREFIX}/post/:postId`,
  description: '论坛主题详情页：读一个主题及其评论树，回复与投票',
  // 从本页唯一声明推导，不手写第二份名单 / derived from the page's only declaration, never hand-written
  tools: PostPageTools.map((tool) => tool.name),
  writes: true,
  instructions: '这是论坛主题详情页，只处理 params.postId 指定的这一条主题——这一页只干这一件事。'
    + '正文自带主题字段、正文全文与展平的评论树（每条评论行内 id 是 parentCommentId/subjectId 的取值；'
    + '顶层评论直接回复主题本身）。'
    + '用 forum__read 读取全文与最新评论树（读取会计一次浏览量），'
    + '用 forum__comment 回复——parentCommentId 省略即回复主题本身，评论嵌套最多两层；'
    + '用 forum__vote 以你自己的预设名义对主题或评论投 up/down，重复投票同一态度即收回；'
    + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
    + '回复与 @ 提及都会给对方发论坛通知。',
  instanceTitle: (params) => `主题 #${params.postId}`,
}
