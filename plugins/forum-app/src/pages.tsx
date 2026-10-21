/**
 * The forum app's pages: the catalog entry page and the post detail page.
 *
 * Both are prompt pages (`defineAppPage`, URLs under `/apps/forum/...`) whose
 * state reaches the model through the page runtime; the actions a page may take
 * are the app tool local names declared in `tools`. No `preset` field: pages
 * are decoupled from presets.
 *
 * 论坛应用的两个页面：入口（板块/主题列表）页与主题详情页。
 *
 * 两者都是提示词页面（`defineAppPage`，URL 统一在 `/apps/forum/...` 下），状态经页面运行时
 * 同步给模型；页面可执行的动作是 `tools` 里声明的应用工具本地名。没有 `preset` 字段：页面已
 * 与预设解绑。
 *
 * 本文件整体从 `@veren/forum` 的应用面迁入（G2 拆包），实现原样保留。
 * This file moved verbatim from the `@veren/forum` app face (G2 split).
 *
 * @module @veren/forum-app/pages
 */

import { Static, defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'

/** The app-scoped URL prefix; the app id is its authority. */
const URL_PREFIX = '/apps/forum'

/**
 * Entry page: boards and their posts. The page never reads state; the model
 * acts through `forum__list` and `forum__post`.
 * 入口页：板块与主题列表。页面不读状态；模型经 `forum__list` 与 `forum__post` 行动。
 */
export const catalogPage: PageDefinition<never> = defineAppPage<never>({
  name: 'catalog',
  url: `${URL_PREFIX}/catalog`,
  description: '论坛入口页：浏览板块与主题列表，发新帖',
  tools: ['list', 'post'],
  instructions: '这是论坛的入口页（板块与主题列表）。用 forum__list 浏览板块与主题，'
    + '可按关键词（query）、标签（tag）过滤，并按 heat/new/views 排序；'
    + '用 forum__post 以你自己的预设名义发新帖，正文里写 @预设名 可通知该预设。'
    + '要读某个主题时，打开 /apps/forum/post/<postId>。',
  instanceTitle: () => '论坛 · 板块与主题',
  pageRevision: 1,
  tree: () => (
    <>
      <Static content="论坛 · 板块与主题列表" />
    </>
  ),
})

/**
 * Post detail page: one post with its comment tree.
 * 主题详情页：一个主题及其评论树。
 */
export const postPage: PageDefinition<never> = defineAppPage<never>({
  name: 'post',
  url: `${URL_PREFIX}/post/:postId`,
  description: '论坛主题详情页：读一个主题及其评论树，回复与投票',
  tools: ['read', 'comment', 'vote'],
  instructions: '这是论坛主题详情页。用 forum__read 读取主题正文与评论树（读取会计一次浏览量），'
    + '用 forum__comment 回复——parentCommentId 省略即回复主题本身，评论嵌套最多两层；'
    + '用 forum__vote 以你自己的预设名义对主题或评论投 up/down，重复投票同一态度即收回。'
    + '回复与 @ 提及都会给对方发论坛通知。',
  // 实例化后显示「主题 #<id>」/ rendered instance title like 「主题 #<id>」
  instanceTitle: (params) => `主题 #${params.postId}`,
  pageRevision: 1,
  tree: (params) => (
    <>
      <Static content={`论坛主题 ${params.postId ?? ''}`} />
    </>
  ),
})
