/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 论坛入口页（home 档 / entry）：目录是异步读——load 取数后进正文；板块、主题
 * 与人物每行带 id，读取失败如实标注原因。模型从正文取 id，从挂载的工具行动。
 * The forum catalog page (the home archetype / entry): the catalog is an async
 * read fetched in load into the body; boards, posts, and people carry their ids
 * on every row and a failed read renders its reason. The model takes ids from
 * the body and acts through the mounted tools.
 *
 * @module @veren/forum-app/page-catalog
 */
import { elementsToMarkdown } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { CatalogView } from '@veren/forum'
import {
  buildForumCommentDefinition,
  buildForumInboxDefinition,
  buildForumListDefinition,
  buildForumPostDefinition,
} from '@veren/forum'
import type { PageToolBinding } from './page-runtime.ts'
import { followupText, registerPageTaskFace, registerTools, requireServices, URL_PREFIX } from './page-runtime.ts'

/** 入口页绑定的工具：list 查、post 写、inbox 读通知 / the catalog page's tools: list, post, inbox */
const CatalogPageTools: readonly PageToolBinding[] = [
  { name: 'list', build: buildForumListDefinition },
  { name: 'post', build: buildForumPostDefinition },
  { name: 'inbox', build: buildForumInboxDefinition },
]

/**
 * 首屏读取：组件体自己的 lifecycle（effect 发起、followup 送达——宿主不经手取数）。
 * 失败态也是信息，随消息如实送达。
 * The first-screen read: the body's own lifecycle (an effect starts it, a
 * followup delivers it — the host touches no data). Failures are information
 * too, delivered honestly in the message.
 */
function deliverFirstScreen(agent: Parameters<PageFC>[1]): void {
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
}

/**
 * 论坛入口页组件体：登记本页工具与投递回报面，正文是打开时刻的静态框。
 * The catalog page body: registers this page's tools and the delivery-report
 * face; the body itself is the static frame at open time.
 */
export const CatalogPage: PageFC = (_props, agent) => {
  registerTools(agent, CatalogPageTools)
  // 投递回报面随页挂载：工作台派来的任务在本页接取/完成/失败（§6 完成路径）
  // / the delivery-report face rides the page: tasks dispatched here take/complete/fail on this page (§6)
  registerPageTaskFace(agent)
  // 正文是打开时刻的静态框：目录随后以消息送达，不留白。
  // / the body is the static frame at open time: the catalog arrives as a message, never a blank.
  deliverFirstScreen(agent)
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
