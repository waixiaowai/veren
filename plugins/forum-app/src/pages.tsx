/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛的两个页面（一次性渲染形态，模块级组件）：`export const XxxPage: PageFC`
 * 直接导出，不做工厂封装。组件体在页面会话的真实 Agent 上执行恰好一次：
 * `agent.ctx` 沿作用域链解析宿主服务（`ctx.forum` / `ctx.agentPresets`），工具
 * 构建器用它闭包，登记全名 `forum__<本地名>`（随 agent fiber 生灭）。
 * 首屏读取是组件体自己的生命周期：异步目录/详情读经 `agent.ctx.effect` 发起，
 * 读到的视图（失败态也是信息）经 `agent.followup` 以新消息进上下文——正文是
 * 打开时刻的静态框。此后页面不再渲染，变化以工具调用的结果为准。
 *
 * The forum's two pages in the one-shot form as MODULE-LEVEL components — no
 * factory wrapper. The body runs exactly once on the page session's real Agent:
 * `agent.ctx` resolves the host services down the scope chain (`ctx.forum` /
 * `ctx.agentPresets`), tool builders close over it and register under full
 * names `forum__<local>` (living and dying with the agent fiber).
 * The first-screen read is the body's own lifecycle: the async catalog/detail
 * read starts via `agent.ctx.effect` and the view it lands (failures are
 * information too) rides `agent.followup` as a new message — the body itself is
 * the static frame at open time. The page never renders again; later changes
 * are learned from tool results.
 *
 * @module @veren/forum-app/pages
 */
import { elementsToMarkdown } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { CatalogView, CommentNodeView, ForumToolsPort, PostDetailView } from '@veren/forum'
import { buildPageTaskTools } from '@veren/task-center'
import type {} from '@veren/task-center'
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

/** 应用 id（页面作用域 task 面按它查 live 行）/ the app id (the page-task face looks up live rows by it) */
const FORUM_APP_ID = 'forum'

/** 工具对外名：`forum__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
const externalName = (localName: string): string => `forum__${localName}`

/**
 * 装配期绑定的模块级槽位：组件体的工具构建与首屏读从这里取 forum 服务面。
 * 注册（`registerForumApp`）一定发生在任何页面打开之前，槽位此刻必然已绑定；
 * 未绑定即取 = 装配错误，fail loud。
 * The module-level slot bound at assembly time: the bodies' tool builds and
 * first-screen reads take the forum face from here. Registration
 * (registerForumApp) always precedes any page open, so the slot is bound by
 * then; reading it unbound is an assembly error and fails loud.
 */
let services: { readonly ctx: Context; readonly port: () => ForumToolsPort } | undefined

/** 装配时绑定论坛服务面（app.ts 的单入口注册调用一次）/ bind at assembly time (called once by app.ts's registration) */
export function bindForumServices(ctx: Context, port: () => ForumToolsPort): void {
  services = { ctx, port }
}

/** 取绑定的服务面；未绑定 = 装配错误 fail loud / read the bound face; unbound = assembly error, fail loud */
function requireServices(): { readonly ctx: Context; readonly port: () => ForumToolsPort } {
  if (services === undefined) {
    throw new Error('[forum-app] forum services are not bound; registerForumApp must run before pages open')
  }
  return services
}

/**
 * 一条页面工具绑定：本地名 + 产出该定义的构建器。构建器闭包 ctx（callerOf 从
 * ctx.agentPresets 解析调用者）与 port；组件体按绑定登记全名定义——页面的工具
 * 面只有这一份声明，永不漂移。仅本模块内部使用，不对外导出。
 * One page-tool binding: the local name plus the builder producing its
 * definition. The builder closes over ctx (callerOf resolves the caller from
 * ctx.agentPresets) and the port; the body registers the full-named definition
 * from the binding — the page's tool face has this one declaration and can
 * never drift. Internal to this module; not exported.
 */
interface PageToolBinding {
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
function registerTools(agent: Parameters<PageFC>[1], bindings: readonly PageToolBinding[]): void {
  const { ctx, port } = requireServices()
  for (const binding of bindings) {
    agent.ctx.tools.register({ ...binding.build(ctx, port), name: externalName(binding.name) })
  }
}

/**
 * 页面作用域完成回报面（docs/unattended-page-contract.cn.md §6 的一般形态）：
 * 投递到本页的任务由此回报——task_take / task_complete / task_fail（无 id 参数，
 * 目标 URL 就是本页；名字与宿主全局面逐字相同，TASK 块与收件箱指引逐字为真）。
 * 作用域解析走装配绑定的 ctx（page-registry 实例索引反查本会话的 live 行）。
 * The page-scoped completion face (the general shape of
 * docs/unattended-page-contract.md §6): tasks delivered to this page report
 * here — task_take / task_complete / task_fail (no id parameter; the target url
 * IS this page; names match the host global face verbatim so the TASK block and
 * inbox guidance read true). Scope resolution rides the bound ctx (the
 * page-registry instance index resolves this session's live row).
 */
function registerPageTaskFace(agent: Parameters<PageFC>[1]): void {
  const { ctx } = requireServices()
  for (const tool of buildPageTaskTools(() => ctx.taskCenter, {
    urlOfSession: async (sessionId) => {
      const rows = await ctx.pageRegistry.instances.listByApp(FORUM_APP_ID)
      return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
    },
  })) {
    agent.ctx.tools.register(tool)
  }
}

/** 页面自推消息的 source kind（宿主装配的 PAGE 块同源；wire 值协议常量）
 * / the source kind of a page-pushed message (same source as the host assembly's PAGE block; a wire-value protocol constant) */
const PAGE_SOURCE = 'app/page' as const

// 类型合并扩充：复用宿主的 app/page 消息源。形状必须与 app-host 的声明逐字
// 一致——TS 接口合并规则下两处同键成员类型不同会直接报错，漂移无处藏身。
// Type-merge extension: reuse the host's app/page message source. The shape
// must match app-host's declaration verbatim — under TS interface merging,
// same-key members with different types are a hard error, so the two cannot
// drift apart.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page session's PAGE block (app-host) and the page body's own followups. @persistenceSource user */
    'app/page': { kind: 'app/page' }
  }
}

/** 把一条首屏文本作为新消息推进上下文（页面自己的送达路径）/ push one first-screen text into the context as a new message (the page's own delivery path) */
function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: PAGE_SOURCE } }))
}

// ---- 入口页（home 档 / entry）---- Catalog page (the home archetype / entry) ----

/**
 * 论坛入口页：目录是异步读——load 取数后进正文；板块、主题与人物每行带 id，
 * 读取失败如实标注原因。模型从正文取 id，从挂载的工具行动。
 * The forum catalog page: the catalog is an async read fetched in load into
 * the body; boards, posts, and people carry their ids on every row and a
 * failed read renders its reason. The model takes ids from the body and acts
 * through the mounted tools.
 */
export const CatalogPage: PageFC = (_props, agent) => {
  registerTools(agent, CatalogPageTools)
  // 投递回报面随页挂载：工作台派来的任务在本页接取/完成/失败（§6 完成路径）
  // / the delivery-report face rides the page: tasks dispatched here take/complete/fail on this page (§6)
  registerPageTaskFace(agent)
  // 首屏读取：组件体自己的 lifecycle（effect 发起、followup 送达——宿主不经手取数）。
  // 失败态也是信息，随消息如实送达。
  // / the first-screen read: the body's own lifecycle (an effect starts it, a
  // followup delivers it — the host touches no data). Failures are information
  // too, delivered honestly in the message.
  agent.ctx.effect(async () => {
    try {
      const view = await requireServices().port().catalog({})
      followupText(agent, elementsToMarkdown(CatalogBody({ view })))
    } catch (error: unknown) {
      followupText(agent, '论坛目录读取失败：' + (error instanceof Error ? error.message : String(error))
        + '——如实告知用户，不要编造板块或主题；重开本页 URL 即可重取。')
    }
    return async () => undefined
  }, 'forum:catalog-first-screen')
  // 正文是打开时刻的静态框：目录随后以消息送达，不留白。
  // / the body is the static frame at open time: the catalog arrives as a message, never a blank.
  return (
    <>
      <h1>论坛 · 板块与主题列表</h1>
      <blockquote>
        目录首屏（板块、最新主题、可提及的人）随后以消息送达，行内 id 是 list/post 的取值来源。
        本页挂载三个工具：forum__list（按关键词/标签/排序再查目录）、
        forum__post（以你自己的预设名义发新帖，正文写 @预设名 可通知该预设）、
        forum__inbox（读取发给你预设的通知，markRead 可读后一并清除）。
        要读某个主题时，打开 map 里的主题详情页 URL。
      </blockquote>
    </>
  )
}

export const CatalogMeta: ComponentPageMeta = {
  name: 'catalog',
  url: `${URL_PREFIX}/catalog`,
  description: '论坛入口页：浏览板块与主题列表，发新帖',
  // forum__post 是写动作，如实声明写意图（§3.9/§3.10.1）
  // / forum__post writes; declare the write intent honestly (§3.9/§3.10.1)
  writes: true,
  // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 1）：forum 是全自主
  // 达标参照——L1 自主执行 + 一句话证据回报，绝无"写前确认"停摆措辞。
  // / The unattended contract (docs/unattended-page-contract.md §5 row 1): forum
  // is the autonomous reference — L1 runs unattended with one-sentence evidence,
  // never a "confirm before writing" stall.
  unattended: {
    serves: '目录盘点与发帖类投递任务（板块/主题/人物行内 id 即取值来源）',
    level: 'L1',
    evidence: '一句话点名新帖 id 与标题（forum__post 返回值）；投递任务以 task_complete 的 summary+artifacts 收口',
    escape: '目录读取失败如实随消息回报（重开 URL 可重取），不编造板块或主题，不悬置；做不完用 task_fail 带稳定码',
  },
  instructions: '这是论坛的首页（板块与主题列表）。目录首屏在打开后以一条消息送达：'
    + 'boards（板块，行内 id 是 boardId）、posts（最新主题，行内 id 是 postId，热度为默认排序）、'
    + 'people（可发帖/提及的预设名）；读取失败也会在消息里如实说明——不要编造板块或主题。'
    + '此后变化以你调用工具返回的结果为准。'
    + '用 forum__list 浏览板块与主题，可按关键词（query）、标签（tag）过滤，并按 heat/new/views 排序；'
    + '用 forum__post 以你自己的预设名义发新帖，正文里写 @预设名 可通知该预设；'
    + '用 forum__inbox 读取发给你预设的通知（markRead 可读后一并清除）。'
    + '投递到本页的任务另有三件页面作用域工具：task_take（无需参数，接取目标 URL 就是本页的那条）、'
    + 'task_complete（summary 必填+artifacts 引用）、task_fail（稳定错误码）——收到 TASK 块或 [task-center] 通知后按其指引执行。'
    + '要读某个主题时，打开 map 里的主题详情页 URL。',
  instanceTitle: () => '论坛 · 板块与主题',
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
export const PostPage: PageFC<{ postId: string }> = (props, agent) => {
  registerTools(agent, PostPageTools)
  // 投递回报面随页挂载（§6 完成路径）/ the delivery-report face rides the page (§6)
  registerPageTaskFace(agent)
  const postId = String(props.postId ?? '')
  // 首屏读取：本页那一条主题（effect 发起、followup 送达）。失败态也是信息——
  // 拒绝消息原样随消息送达。
  // / the first-screen read: this page's one post (an effect starts it, a
  // followup delivers it). Failures are information too — the refusal lands
  // verbatim in the message.
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
