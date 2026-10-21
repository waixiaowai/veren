/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * The forum app's pages: the catalog (home) page and the post detail page.
 *
 * §3.10.1 archetype annotations: the catalog page is the home page (the entry)
 * — basic information (boards/posts/people via `load`, read from the real
 * service port) plus the capability map (this app has a detail page, so the
 * map must be non-empty and list the post url template). The post page is a
 * detail page: a `:param` url, a `load` of that one post with its comment
 * tree, `writes: true` (comment/vote act on the record), and a "this page does
 * one thing" note. Pages are factories closing over the port of this assembly,
 * so the PAGE block's first screen and the page tools read the very same
 * record set.
 *
 * 论坛应用的两个页面：入口（板块/主题列表）页与主题详情页。
 *
 * §3.10.1 三档标注：入口页是首页（home 档 / entry）——基础信息（load 经真实
 * 服务端口取板块/主题/人物）+ 能力地图（本应用有详情页 → map 必须非空，列主题
 * 详情页 URL 模板）。详情页是详情页（detail 档）：URL 带 :param、load 取该条
 * 主题与评论树、writes: true（comment/vote 作用于该记录）、说明写明"只处理
 * 这一条主题"。页面是工厂，闭包引用本次装配的端口，PAGE 块首屏与页面工具读的
 * 是同一份记录集合。
 *
 * @module @veren/forum-app/pages
 */

import { Static, defineAppPage } from '@veren/prompt-page'
import type { PageJsonValue, PageDefinition } from '@veren/prompt-page'
import type { CatalogView, CommentNodeView, ForumToolsPort, PostDetailView } from '@veren/forum'

/** The app-scoped URL prefix; the app id is its authority. */
const URL_PREFIX = '/apps/forum'

/** 首屏列表条数上限（与 PAGE-DATA 的 50 条上限同口径）/ the first-screen list cap (aligned with the PAGE-DATA cap) */
const FIRST_SCREEN_LIMIT = 50

/** 入口页首屏快照 / the catalog page's first-screen snapshot */
export type ForumCatalogFirstScreen = {
  boards: { id: string; title: string; path: string; posts: number }[]
  posts: { id: string; title: string; author: string; boardId: string; heat: number; views: number; comments: number }[]
  people: string[]
}

/** 详情页首屏快照 / the post page's first-screen snapshot */
export type ForumPostFirstScreen = {
  post: { id: string; title: string; author: string; boardId: string; up: number; down: number; views: number; comments: number }
  body: string
  comments: { id: string; parent: string; depth: number; author: string; body: string; up: number; down: number }[]
}

/** 入口页首屏：板块 + 最新主题 + 可提及的人（真实目录数据）/ the catalog first screen: boards + latest posts + people, from the real catalog */
export function catalogFirstScreen(view: CatalogView): ForumCatalogFirstScreen {
  return {
    boards: view.boards.map((board) => ({ id: board.id, title: board.title, path: board.path, posts: board.postCount })),
    posts: view.posts.slice(0, FIRST_SCREEN_LIMIT).map((post) => ({
      id: post.id,
      title: post.title,
      author: post.author,
      boardId: post.boardId,
      heat: post.heat,
      views: post.views,
      comments: post.commentCount,
    })),
    people: view.people.map((person) => person.name),
  }
}

/** 评论树展平成首屏行（深度随记录，超限截断）/ flatten the comment tree into first-screen rows (record depth, capped) */
function flattenComments(nodes: readonly CommentNodeView[], rows: ForumPostFirstScreen['comments']): void {
  for (const node of nodes) {
    if (rows.length >= FIRST_SCREEN_LIMIT) return
    rows.push({
      id: node.id,
      parent: node.parentId,
      depth: node.depth,
      author: node.author,
      body: node.body,
      up: node.up,
      down: node.down,
    })
    flattenComments(node.replies, rows)
  }
}

/** 详情页首屏：该主题的字段、正文与评论树 / the post first screen: the post's fields, body, and comment tree */
export function postFirstScreen(view: PostDetailView): ForumPostFirstScreen {
  const comments: ForumPostFirstScreen['comments'] = []
  flattenComments(view.comments, comments)
  return {
    post: {
      id: view.post.id,
      title: view.post.title,
      author: view.post.author,
      boardId: view.post.boardId,
      up: view.post.up,
      down: view.post.down,
      views: view.post.views,
      comments: view.post.commentCount,
    },
    body: view.body,
    comments,
  }
}

/**
 * Home page (the home archetype / entry): boards and their posts. The page's
 * first screen comes from the real catalog read; the model acts through
 * `forum__list` and `forum__post`. This app has a detail page, so the home map
 * must be non-empty (§3.10.5 rule 1).
 * 首页（home 档 / entry）：板块与主题列表。首屏来自真实目录读取；模型经
 * `forum__list` 与 `forum__post` 行动。本应用有详情页 → 首页 map 必须非空
 * （§3.10.5 规则 1）。
 */
export function createCatalogPage(port: () => ForumToolsPort): PageDefinition<never> {
  return defineAppPage<never>({
    name: 'catalog',
    url: `${URL_PREFIX}/catalog`,
    description: '论坛入口页：浏览板块与主题列表，发新帖',
    tools: ['list', 'post'],
    instructions: '这是论坛的首页（板块与主题列表）。data 行是首屏快照：boards（板块）、posts（最新主题，heat 为默认热度）、people（可发帖/提及的预设名）。'
      + '用 forum__list 浏览板块与主题，可按关键词（query）、标签（tag）过滤，并按 heat/new/views 排序；'
      + '用 forum__post 以你自己的预设名义发新帖，正文里写 @预设名 可通知该预设。'
      + '要读某个主题时，打开 map 里的主题详情页 URL。',
    instanceTitle: () => '论坛 · 板块与主题',
    // §3.10.1：首页 = 基础信息（load 取真实目录）+ 能力地图（有详情页 → map 必须非空）
    // / §3.10.1: the home page = basic information (a real catalog read via load)
    // + the capability map (a detail page exists → the map must be non-empty)
    load: async () => catalogFirstScreen(await port().catalog({})) satisfies PageJsonValue,
    map: [
      {
        url: `${URL_PREFIX}/post/:postId`,
        use: '读某个主题及其评论树、回复或投票时打开',
        params: { postId: '主题 id，来自列表 data 的 posts[].id' },
      },
    ],
    tree: () => (
      <>
        <Static content="论坛 · 板块与主题列表" />
      </>
    ),
  })
}

/**
 * Post detail page (the detail archetype): one post with its comment tree; a
 * page that exists to act on that one post (comment, vote).
 * 主题详情页（detail 档）：一个主题及其评论树；为"处理这一条主题"而存在的页面
 * （回复、投票）。
 */
export function createPostPage(port: () => ForumToolsPort): PageDefinition<never> {
  return defineAppPage<never>({
    name: 'post',
    url: `${URL_PREFIX}/post/:postId`,
    description: '论坛主题详情页：读一个主题及其评论树，回复与投票',
    tools: ['read', 'comment', 'vote'],
    writes: true,
    instructions: '这是论坛主题详情页，只处理 params.postId 指定的这一条主题——这一页只干这一件事。'
      + 'data 行自带主题字段、正文与展平的评论树（parent 为空串即回复主题本身）；'
      + '用 forum__read 读取全文与最新评论树（读取会计一次浏览量），'
      + '用 forum__comment 回复——parentCommentId 省略即回复主题本身，评论嵌套最多两层；'
      + '用 forum__vote 以你自己的预设名义对主题或评论投 up/down，重复投票同一态度即收回。'
      + '回复与 @ 提及都会给对方发论坛通知。',
    // 实例化后显示「主题 #<id>」/ rendered instance title like 「主题 #<id>」
    instanceTitle: (params) => `主题 #${params.postId}`,
    // §3.10.3：详情页 load 按参数取该条记录的首屏快照；主题不存在时 load 抛
    // forum/post-not-found，data 行如实给出失败态与重试指引。
    // §3.10.3: the detail load fetches that one record's first screen; a missing
    // post throws forum/post-not-found and the data line carries the error state.
    load: async (params) => postFirstScreen(await port().detail({ postId: String(params.postId ?? '') })) satisfies PageJsonValue,
    tree: (params) => (
      <>
        <Static content={`论坛主题 ${params.postId ?? ''}`} />
      </>
    ),
  })
}
