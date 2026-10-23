/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛的两个页面（一次性渲染形态）：`createForumPages(port)` 产出模块级 PageFC
 * + meta，经 `pages.register(component, meta)` 注册。组件体在页面会话的真实
 * Agent 上执行恰好一次：工具由体直接 `agent.ctx.tools.register` 登记（全名
 * `forum__<本地名>`，随 agent fiber 生灭）；目录/详情是异步读——load 先取数，
 * 经 useSnapshot 进正文，读取中/读取失败都如实渲染，绝不编造。此后页面不再
 * 渲染：正文是打开时刻的首屏，此后变化以工具调用的结果为准。
 *
 * The forum's two pages in the one-shot form: `createForumPages(port)` yields
 * the PageFCs and metas registered via `pages.register(component, meta)`. The
 * body runs exactly once on the page session's real Agent: tools are registered
 * by the body via `agent.ctx.tools.register` (full names `forum__<local>`,
 * living and dying with the agent fiber); the catalog/detail are async reads —
 * load fetches first, useSnapshot feeds the body, and reading/failure states
 * render honestly, never faked. The page never renders again: the body is the
 * first screen at open time; later changes are learned from tool results.
 *
 * @module @veren/forum-app/pages
 */
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageJsonValue } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
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

/** 工具对外名：`forum__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
const externalName = (localName: string): string => `forum__${localName}`

/**
 * 一条页面工具绑定：本地名 + 产出该定义的构建器。构建器闭包 ctx（callerOf 从
 * ctx.agentPresets 解析调用者）与 port；组件体按绑定登记全名定义——页面的工具
 * 面只有这一份声明，永不漂移。
 * One page-tool binding: the local name plus the builder producing its
 * definition. The builder closes over ctx (callerOf resolves the caller from
 * ctx.agentPresets) and the port; the body registers the full-named definition
 * from the binding — the page's tool face has this one declaration and can
 * never drift.
 */
export interface PageToolBinding {
  readonly name: string
  readonly build: (ctx: Context, port: () => ForumToolsPort) => ToolDefinition
}

/** 入口页绑定的工具：list 查、post 写、inbox 读通知 / the catalog page's tools: list, post, inbox */
const CatalogPageTools: readonly PageToolBinding[] = [
  { name: 'list', build: buildForumListDefinition },
  { name: 'post', build: buildForumPostDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/** 详情页绑定的工具：read 读、comment 回、vote 投；inbox 两页都挂——处理某条
 * 主题的会话同样要读自己的通知 / the post page's tools: read, comment, vote;
 * inbox rides both pages — a session working one post still reads its notices */
const PostPageTools: readonly PageToolBinding[] = [
  { name: 'read', build: buildForumReadDefinition },
  { name: 'comment', build: buildForumCommentDefinition },
  { name: 'vote', build: buildForumVoteDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/** 按绑定登记工具（全名）/ register the bound tools under full names */
function registerTools(agent: Parameters<PageFC>[1], ctx: Context, port: () => ForumToolsPort, bindings: readonly PageToolBinding[]): void {
  for (const binding of bindings) {
    agent.ctx.tools.register({ ...binding.build(ctx, port), name: externalName(binding.name) })
  }
}

/** 页面集合：port 以纯参数进入（G13 规则 2），load 闭包它取首屏数据
 * / the page set: the port arrives as a pure parameter (G13 rule 2); load
 * closures over it for the first-screen data */
export interface ForumPages {
  readonly CatalogPage: PageFC
  readonly CatalogMeta: ComponentPageMeta
  readonly PostPage: PageFC<{ postId: string }>
  readonly PostMeta: ComponentPageMeta<{ postId: string }>
}

/**
 * 论坛页面工厂：port 以纯参数进入。目录/详情的异步读在 load 里完成（一次性
 * 渲染没有"渲染后再取数"的第二次入口）。
 * The forum page factory: the port arrives as a pure parameter. The async
 * catalog/detail reads happen in load (a one-shot render has no second
 * "fetch after render" entry).
 */
export function createForumPages(port: () => ForumToolsPort, ctx: Context): ForumPages {
  // ---- 入口页（home 档 / entry）---- Catalog page (the home archetype / entry) ----

  /**
   * 论坛入口页：目录是异步读——load 取数后进正文；板块、主题与人物每行带 id，
   * 读取失败如实标注原因。模型从正文取 id，从挂载的工具行动。
   * The forum catalog page: the catalog is an async read fetched in load into
   * the body; boards, posts, and people carry their ids on every row and a
   * failed read renders its reason. The model takes ids from the body and acts
   * through the mounted tools.
   */
  const CatalogPage: PageFC = (_props, agent) => {
    registerTools(agent, ctx, port, CatalogPageTools)
    // 失败态也是数据：load 抛错时运行时下发信封（{error:{message}}），正文如实渲染
    // / failures are data too: on a load throw the runtime hands the envelope
    // ({error:{message}}) down and the body renders it honestly
    const view = useSnapshot<CatalogView & { error?: { message: string } }>()
    return (
      <>
        <h1>论坛 · 板块与主题列表</h1>
        {view?.error !== undefined
          ? <p>论坛目录读取失败：{view.error.message}——如实告知用户，不要编造板块或主题。</p>
          : view === undefined || view === null
            ? <p>论坛目录为空——如实告知用户，不要编造板块或主题。</p>
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

  const CatalogMeta: ComponentPageMeta = {
    name: 'catalog',
    url: `${URL_PREFIX}/catalog`,
    description: '论坛入口页：浏览板块与主题列表，发新帖',
    // 首屏数据：目录视图（失败态也是数据，load 内如实落地）
    // / the first screen: the catalog view (failure states are data too)
    load: async (): Promise<PageJsonValue> => await port().catalog({}) as unknown as PageJsonValue,
    // forum__post 是写动作，如实声明写意图（§3.9/§3.10.1）
    // / forum__post writes; declare the write intent honestly (§3.9/§3.10.1)
    writes: true,
    instructions: '这是论坛的首页（板块与主题列表）。正文首屏：boards（板块，行内 id 是 boardId）、'
      + 'posts（最新主题，行内 id 是 postId，热度为默认排序）、people（可发帖/提及的预设名）。'
      + '正文是打开时刻的首屏——此后变化以你调用工具返回的结果为准。'
      + '用 forum__list 浏览板块与主题，可按关键词（query）、标签（tag）过滤，并按 heat/new/views 排序；'
      + '用 forum__post 以你自己的预设名义发新帖，正文里写 @预设名 可通知该预设；'
      + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
      + '要读某个主题时，打开 map 里的主题详情页 URL。',
    instanceTitle: () => '论坛 · 板块与主题',
  }

  // ---- 主题详情页（detail 档）---- Post detail page (the detail archetype) ----

  /**
   * 主题详情页：只处理 props.postId 指定的这一条主题。详情是异步读——load 取数；
   * 主题不存在等失败态如实渲染（失败态也是数据）。正文带主题字段、正文全文与
   * 展平的评论树，每行带 id（parentCommentId/subjectId 从行内取）。
   * The post detail page: handles exactly the one post props.postId names. The
   * detail is an async read fetched in load; failure states (a missing post
   * among them) render honestly — failures are data too. The body carries the
   * post's fields, its full text, and the flattened comment tree, ids on every
   * row (parentCommentId / subjectId come from the rows).
   */
  const PostPage: PageFC<{ postId: string }> = (props, agent) => {
    registerTools(agent, ctx, port, PostPageTools)
    const postId = String(props.postId ?? '')
    // 失败态也是数据：load 抛错的运行时信封由正文如实渲染（拒绝消息原样进正文）
    // / failures are data too: the load-throw envelope renders honestly (the
    // refusal message lands verbatim in the body)
    const view = useSnapshot<PostDetailView & { error?: { message: string } }>()
    return (
      <>
        <h1>论坛主题 {postId}</h1>
        {view?.error !== undefined
          ? <p>主题读取失败：{view.error.message}——如实告知用户，不要编造这条主题的内容。</p>
          : view === undefined || view === null
            ? <p>主题读取失败：该主题不存在或读取出错——如实告知用户，不要编造这条主题的内容。</p>
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

  const PostMeta: ComponentPageMeta<{ postId: string }> = {
    name: 'post',
    url: `${URL_PREFIX}/post/:postId`,
    description: '论坛主题详情页：读一个主题及其评论树，回复与投票',
    // 首屏数据：详情视图（失败态也是数据，load 内如实落地）
    // / the first screen: the detail view (failure states are data too)
    load: async (params) => await port().detail({ postId: String(params.postId ?? '') }) as unknown as PageJsonValue,
    writes: true,
    instructions: '这是论坛主题详情页，只处理 params.postId 指定的这一条主题——这一页只干这一件事。'
      + '正文自带主题字段、正文全文与展平的评论树（每条评论行内 id 是 parentCommentId/subjectId 的取值；'
      + '顶层评论直接回复主题本身）。正文是打开时刻的首屏——此后变化以你调用工具返回的结果为准。'
      + '用 forum__read 读取全文与最新评论树（读取会计一次浏览量），'
      + '用 forum__comment 回复——parentCommentId 省略即回复主题本身，评论嵌套最多两层；'
      + '用 forum__vote 以你自己的预设名义对主题或评论投 up/down，重复投票同一态度即收回；'
      + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
      + '回复与 @ 提及都会给对方发论坛通知。',
    instanceTitle: (params) => `主题 #${params.postId}`,
  }

  return { CatalogPage, CatalogMeta, PostPage, PostMeta }
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
