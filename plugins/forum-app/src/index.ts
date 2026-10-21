/**
 * @veren/forum-app plugin entry: registers the forum as an application
 * (definition → tools → pages) over the `@veren/forum` service. This plugin
 * is deliberately separate from the host package (G2 package split): the host
 * keeps the service, the global `forum_*` tools, and the notifications, and
 * activates even where the application framework is absent; installing this
 * package is what turns the forum into an app.
 *
 * @veren/forum-app 插件入口：在 `@veren/forum` 服务之上把论坛注册成一个应用
 * （定义 → 工具 → 页面）。本插件刻意与宿主包分离（G2 拆包）：宿主保留服务、全局
 * `forum_*` 工具与通知，在应用框架缺席的部署里照常激活；装上本包，论坛才成为应用。
 *
 * 注册走单入口：ctx.apps.pages(id).register 内部镜像进 page-registry，
 * 不手动调 pageRegistry.registerAppPage。
 * Single entry: ctx.apps.pages(id).register mirrors into the page registry
 * internally; pageRegistry.registerAppPage is never called by hand.
 * @module @veren/forum-app
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the `ctx.forum` service face (declaration merging) and the
// `ctx.apps` face into this file; the value imports come from './app.ts'.
// 仅类型导入：把 `ctx.forum` 服务面（declaration merging）与 `ctx.apps` 面拉进本文件；
// 值导入来自 './app.ts'。
import type {} from '@veren/forum'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { registerForumApp } from './app.ts'

// Re-exported so consumers (bundle metadata tests) can pin the definition
// without reaching into internals.
// 再导出给消费者（组合包元数据测试）钉住定义，不必深入内部结构。
export { FORUM_APP_DEFINITION, FORUM_APP_ID, FORUM_ENTRY_KEY } from './app.ts'

export const name = 'forumApp'

export interface Config {
  /** Reserved for future app-layer switches; empty today. 预留的应用层开关；当前为空。 */
  reserved?: false
}

export const Config: z<Config> = z.object({}).description('Reserved; no app-layer options yet.')

// 框架与宿主服务都是显式硬 inject（G13）：本插件就是应用层，缺任何一个都不激活——
// 绝不运行期探测。callerOf 还要读 agentPresets / workingDirectory / workspaceRegistry
// 解析调用者身份，同样显式声明。
// The framework and the host service are declared hard injects (G13): this
// plugin IS the application layer and stays pending without either — never a
// runtime probe. callerOf also reads agentPresets / workingDirectory /
// workspaceRegistry to resolve the caller; declared just as explicitly.
export const inject = ['apps', 'forum', 'agentPresets', 'workingDirectory', 'workspaceRegistry']
export const provide = []

export const apply = (ctx: Context): void => {
  // The app acts through the host service's public tools port: page tools and
  // global tools write one record set.
  // 应用经宿主服务的公开工具端口行动：页面工具与全局工具写同一份记录集合。
  registerForumApp(ctx, () => ctx.forum.toolsPort())
}
