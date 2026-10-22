/**
 * The forum application: definition, the collected-tool manifest, and the
 * single-entry registration.
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
 * 论坛应用：定义、工具收编清单与单入口注册。
 *
 * 一个入口按依赖顺序注册整个应用——先定义、再工具、后页面——收在单个 `ctx.effect`
 * 里，体内失败即逆序回滚已完成步骤，因此卸载所属 fiber 按逆序摘除页面、工具与应用，
 * 装配失败也不留残渣。页面只走 `ctx.apps.pages(id).register()`：app-registry
 * 会在内部镜像进页面注册表；再手工调 `pageRegistry.registerAppPage` 会造出「目录
 * 可见却解析不到」的漂移，这正是单入口设计所禁止的。
 *
 * 工具收编自 `@veren/forum` 的构建器（本文件不含任何工具实现，G2 拆包：宿主包在
 * 框架缺席的部署里照常激活）。This file carries no tool implementation — every
 * tool comes from a `@veren/forum` builder (G2 split: the host package
 * activates even in framework-absent deployments).
 *
 * @module @veren/forum-app/app
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'
import {
  buildForumCommentDefinition,
  buildForumInboxDefinition,
  buildForumListDefinition,
  buildForumPostDefinition,
  buildForumReadDefinition,
  buildForumVoteDefinition,
} from '@veren/forum'
import type { ForumToolsPort } from '@veren/forum'
import { CatalogMeta, CatalogPage, PostMeta, PostPage } from './pages.tsx'

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
 * 收编论坛工具：调用宿主包导出的构建器，拿到唯一实现的 `ToolDefinition`——这里只
 * 登记进应用工具目录（对外名带 `forum__` 前缀），不注册到 ctx.tools，也绝不复制
 * 第二份实现。页面会话里的实际挂载走静态脸（页面 meta.tools）。
 * Collect the forum tools: call the host package's exported builders to obtain
 * the one `ToolDefinition` implementation — this only enters the app tool
 * catalog (external names carry the `forum__` prefix), never ctx.tools, and
 * never duplicates an implementation. The actual mount inside a page session is
 * the static face (the pages' meta.tools).
 * @param ctx - 携带 Session 与工作区服务的宿主上下文（调用者身份从这里解析）。
 *   The host context carrying the Session and workspace services (caller identity resolves here).
 * @param port - resolves the service surface the app tools act through.
 * @returns 收编的工具定义（本地名即目录名）。The collected definitions (local names).
 */
export function collectForumAppTools(ctx: Context, port: () => ForumToolsPort): ToolDefinition[] {
  return [
    buildForumListDefinition(ctx, port),
    buildForumReadDefinition(ctx, port),
    buildForumPostDefinition(ctx, port),
    buildForumCommentDefinition(ctx, port),
    buildForumVoteDefinition(ctx, port),
    buildForumInboxDefinition(ctx, port),
  ]
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
      for (const tool of collectForumAppTools(ctx, port)) {
        disposers.push(tools.define(tool))
      }
      // 3) Pages: the single entry — app-registry mirrors into the page registry.
      //    Module-level PageFCs read `ctx.forum` in their bodies (the plugin
      //    injects the service), so each page's body renders the very record
      //    set its page tools act on — no factory, no closure injection.
      //    页面：单入口——app-registry 内部镜像进页面注册表。模块级 PageFC 在
      //    正文直读 `ctx.forum`（本插件声明注入该服务），正文渲染的正是页面工具
      //    操作的那份记录集合——零工厂、零闭包注入。
      const pages = apps.pages(FORUM_APP_ID, ctx)
      disposers.push(pages.register(CatalogPage, CatalogMeta))
      disposers.push(pages.register(PostPage, PostMeta))
    } catch (error: unknown) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'forum:app')
}
