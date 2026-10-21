/**
 * The forum application: definition, single-entry registration.
 *
 * One entry point registers the whole app in dependency order — definition,
 * then tools, then pages — inside a single `ctx.effect` whose body rolls back
 * finished steps on failure, so unmounting the owning fiber disposes pages,
 * tools, and the app in reverse order and a failed mount leaves nothing
 * behind. Pages go through `ctx.apps.pages(id).register()` only: app-registry
 * mirrors each page into the page registry internally, and calling
 * `pageRegistry.registerAppPage` by hand would create the "visible in the
 * catalog but unresolvable" drift the single-entry design forbids.
 *
 * 论坛应用：定义与单入口注册。
 *
 * 一个入口按依赖顺序注册整个应用——先定义、再工具、后页面——收在单个 `ctx.effect`
 * 里，体内失败即逆序回滚已完成步骤，因此卸载所属 fiber 按逆序摘除页面、工具与应用，
 * 装配失败也不留残渣。页面只走 `ctx.apps.pages(id).register()`：app-registry
 * 会在内部镜像进页面注册表；再手工调 `pageRegistry.registerAppPage` 会造出「目录
 * 可见却解析不到」的漂移，这正是单入口设计所禁止的。
 *
 * 本文件整体从 `@veren/forum` 的应用面迁入（G2 拆包）：应用层独立成包，宿主包在
 * 框架缺席的部署里照常激活。
 * This file moved verbatim from the `@veren/forum` app face (G2 split): the
 * application layer is its own package, so the host package activates even in
 * framework-absent deployments.
 *
 * @module @veren/forum-app/app
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'
import type { ForumToolsPort } from '@veren/forum'
import { createForumAppTools } from './app-tools.ts'
import { createCatalogPage, createPostPage } from './pages.tsx'

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
  instructions: '论坛是一个工作区一个板块、一个 agent 预设一个人的讨论区：'
    + '入口页用 forum__list 浏览主题、forum__post 发帖；详情页用 forum__read 阅读、'
    + 'forum__comment 回复、forum__vote 投票；forum__inbox 读取发给你预设的通知。'
    + '所有操作以你自己的预设名义进行，正文 @预设名 可通知对方。',
  // toolPrefix 缺省由 id 推导为 forum；显式写出仅为可读性
  toolPrefix: 'forum',
}

/**
 * Register the forum app in one effect: definition, tools, then pages. When a
 * later step fails the body rolls every finished step back in reverse — the
 * wiring is all-or-nothing, never a half-registered app. Disposing the owning
 * fiber disposes the whole group in reverse order. Pages go through
 * `ctx.apps.pages(id).register()` only: app-registry mirrors each page into
 * the page registry internally, and calling `pageRegistry.registerAppPage` by
 * hand would create the "visible in the catalog but unresolvable" drift the
 * single-entry design forbids.
 *
 * 一个 effect 注册论坛应用：先定义、再工具、后页面。后一步失败时，函数体把已完成的
 * 步骤逆序回滚——接线要么全接上、要么什么也没接，绝不留半个应用。卸载所属 fiber 时
 * 整组逆序清理。页面只走 `ctx.apps.pages(id).register()`：app-registry 会在内部
 * 镜像进页面注册表；再手工调 `pageRegistry.registerAppPage` 会造出「目录可见却解析
 * 不到」的漂移，这正是单入口设计所禁止的。
 *
 * @param ctx - the fiber context that owns the app.
 * @param port - resolves the service surface the app tools act through.
 */
export function registerForumApp(ctx: Context, port: () => ForumToolsPort): void {
  const apps = ctx.apps
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      // 1) Definition first; bound to this fiber.
      //    先定义；绑定到本 fiber。
      disposers.push(apps.register(FORUM_APP_DEFINITION, ctx))
      // 2) Tools before pages: page registration validates every referenced tool.
      //    工具先于页面：页面注册会校验引用的每个工具都已在目录里。
      const tools = apps.tools(FORUM_APP_ID, ctx)
      for (const tool of createForumAppTools(ctx, port)) {
        disposers.push(tools.define(tool))
      }
      // 3) Pages: the single entry — app-registry mirrors into the page registry.
      //    Pages are factories closing over this assembly's port, so each
      //    page's `load` reads the same record set its page tools act on.
      //    页面：单入口——app-registry 内部镜像进页面注册表。页面是工厂，闭包
      //    引用本次装配的端口，各页 load 与页面工具读的是同一份记录集合。
      const pages = apps.pages(FORUM_APP_ID, ctx)
      for (const page of [createCatalogPage(port), createPostPage(port)]) {
        disposers.push(pages.register(page))
      }
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'forum:app')
}
