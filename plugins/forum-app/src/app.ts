/**
 * The forum application: definition and the single-entry registration.
 *
 * One entry point registers the whole app in dependency order — definition,
 * then each page together with the tools that page binds — inside a single
 * `ctx.effect` whose body rolls back finished steps on failure, so unmounting
 * the owning fiber disposes pages, tools, and the app in reverse order and a
 * failed mount leaves nothing behind. Pages go through
 * `ctx.apps.pages(id).register()` only: app-registry mirrors each page into
 * the page registry internally, and calling `pageRegistry.registerAppPage` by
 * hand would create the "visible in the catalog but unresolvable" drift the
 * single-entry design forbids.
 *
 * 本文件不含任何工具清单：工具绑定长在页面上（pages.tsx 的 XxxPageTools——
 * 本地名 → 构建器的唯一声明），meta.tools 与目录定义都从它推导，这里只逐页
 * 登记——先推导该页绑定的定义，再挂该页，一页一套信息+工具。
 * The tool manifests do NOT live here: tool bindings live on their pages (the
 * XxxPageTools in pages.tsx — the one local-name → builder declaration), and
 * both meta.tools and the catalog definitions derive from them; this file only
 * registers page by page — derive the page's bound definitions, then mount the
 * page. One page, one information + tools unit.
 *
 * 工具实现来自 `@veren/forum` 的构建器（G2 拆包：宿主包在框架缺席的部署里照常激活）。
 * Tool implementations come from the `@veren/forum` builders (G2 split: the
 * host package activates even in framework-absent deployments).
 *
 * @module @veren/forum-app/app
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'
import type { ForumToolsPort } from '@veren/forum'
import { createForumPages } from './pages.tsx'

/** The app id; the URL prefix `/apps/forum` and the `forum__` tool prefix follow it. */
export const FORUM_APP_ID = 'forum' as AppId

/** The entry page key inside the app. */
export const FORUM_ENTRY_KEY = 'catalog' as PageKey

/** The application definition as the app catalog renders it. */
export const FORUM_APP_DEFINITION: ApplicationDefinition = {
  id: FORUM_APP_ID,
  name: '论坛',
  description: 'A board per workspace whose people are the deployment\'s agent presets: '
    + 'browse and publish posts, reply in two-level comment threads, vote, and read '
    + 'your notification inbox.',
  entry: FORUM_ENTRY_KEY,
  // 应用级说明（PAGE 块的「应用说明」行）：点明工具只活在论坛页面会话里（0.2 起
  // 普通会话没有任何论坛工具），并按页面点名全部六个工具——说明点名的每一个工具
  // 都必须真挂（承诺=挂载）。
  // The app-level note (the PAGE block's app line): forum tools live only in
  // forum page sessions (since 0.2 an ordinary session carries none), and all
  // six tools are named page by page — every tool the note names is really
  // mounted (promise = mount).
  instructions: '论坛是一个工作区一个板块、一个 agent 预设一个人的讨论区。论坛工具只在本应用的页面会话里可用'
    + '（普通会话没有论坛工具，需要讨论请打开论坛页面）：入口页 /apps/forum/catalog 用 forum__list 浏览主题、'
    + 'forum__post 发帖、forum__inbox 读取发给你预设的通知；主题详情页 /apps/forum/post/:postId 用 '
    + 'forum__read 阅读、forum__comment 回复、forum__vote 投票，forum__inbox 同样挂在本页。'
    + '所有操作以你自己的预设名义进行，正文 @预设名 可通知对方。',
  // toolPrefix 缺省由 id 推导为 forum；显式写出仅为可读性
  toolPrefix: 'forum',
}

/**
 * Register the forum app in one effect: definition first, then page by page —
 * each page's bound tools are defined into the app catalog immediately before
 * that page mounts (page registration validates every tool its meta.tools
 * references). When a later step fails the body rolls every finished step back
 * in reverse — the wiring is all-or-nothing, never a half-registered app.
 * Disposing the owning fiber disposes the whole group in reverse order. Pages
 * go through `ctx.apps.pages(id).register()` only: app-registry mirrors each
 * page into the page registry internally, and calling
 * `pageRegistry.registerAppPage` by hand would create the "visible in the
 * catalog but unresolvable" drift the single-entry design forbids.
 *
 * 一个 effect 注册论坛应用：先定义，再逐页进行——每页绑定的工具先登记进应用
 * 目录，紧接着挂载该页（页面注册会校验 meta.tools 引用的每个工具都已在目录里）。
 * 后一步失败时，函数体把已完成的步骤逆序回滚——接线要么全接上、要么什么也没接，
 * 绝不留半个应用。卸载所属 fiber 时整组逆序清理。页面只走
 * `ctx.apps.pages(id).register()`：app-registry 会在内部镜像进页面注册表；再
 * 手工调 `pageRegistry.registerAppPage` 会造出「目录可见却解析不到」的漂移，
 * 这正是单入口设计所禁止的。
 *
 * @param ctx - the fiber context that owns the app.
 * @param port - resolves the service surface the page-bound tools act through.
 */
export function registerForumApp(ctx: Context, port: () => ForumToolsPort): void {
  const apps = ctx.apps
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      // 1) Definition first; bound to this fiber.
      //    先定义；绑定到本 fiber。
      disposers.push(apps.register(FORUM_APP_DEFINITION, ctx))
      // 2) Page by page: the tools are registered by each page's body via
      //    agent.ctx.tools.register in the one render (full names forum__*),
      //    so there is no catalog indirection here — pages carry their own
      //    tool bindings.
      //    逐页进行：工具由每页组件体在唯一一次渲染里经 agent.ctx.tools.register
      //    以全名登记（forum__*），这里没有任何目录间接层——工具绑定长在页面上。
      const pages = apps.pages(FORUM_APP_ID, ctx)
      const forumPages = createForumPages(port, ctx)
      disposers.push(pages.register(forumPages.CatalogPage, forumPages.CatalogMeta))
      disposers.push(pages.register(forumPages.PostPage, forumPages.PostMeta))
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'forum:app')
}
