/**
 * @veren/notebook-app plugin entry: registers the notebook as an application
 * (definition → tools → pages) over the `@veren/notebook` domain service. This
 * plugin is deliberately separate from the host package (G2 package split):
 * the host is the pure domain service and exports the tool builders, activating
 * even where the application framework is absent; this package is the notebook's
 * single registration face — installing it is what turns the notebook into an
 * app whose page sessions carry the `notebook__*` page tools.
 *
 * @veren/notebook-app 插件入口：在 `@veren/notebook` 领域服务之上把记事本注册成一个应用
 * （定义 → 工具 → 页面）。本插件刻意与宿主包分离（G2 拆包）：宿主是纯领域服务并导出工具
 * 构建器，在应用框架缺席的部署里照常激活；本包是记事本唯一的注册面——装上它，记事本才
 * 成为应用，页面会话才挂上 `notebook__*` 页面工具。
 *
 * 注册走单入口：ctx.apps.pages(id).register 内部镜像进 page-registry，
 * 不手动调 pageRegistry.registerAppPage。
 * Single entry: ctx.apps.pages(id).register mirrors into the page registry
 * internally; pageRegistry.registerAppPage is never called by hand.
 * @module @veren/notebook-app
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the `ctx.notebook` service face (declaration merging) and
// the `ctx.apps` face into this file; the value imports come from './app.ts'.
// 仅类型导入：把 `ctx.notebook` 服务面（declaration merging）与 `ctx.apps` 面拉进本文件；
// 值导入来自 './app.ts'。
import type {} from '@veren/notebook'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
// 任务中心类型面：页面作用域完成回报面（task_take/task_complete/task_fail）从
// 它构建——投递到笔记页的任务由此收口（docs/unattended-page-contract §6）。
// Task-center type face: the page-scoped completion face builds on it — tasks
// delivered to notebook pages close here (docs/unattended-page-contract §6).
import type {} from '@veren/task-center'
import { registerNotebookApp } from './app.ts'

// Re-exported so consumers (bundle metadata tests) can pin the definition
// without reaching into internals.
// 再导出给消费者（组合包元数据测试）钉住定义，不必深入内部结构。
export { APP_DEFINITION, APP_ID } from './app.ts'

export const name = 'notebookApp'

export interface Config {
  /** Reserved for future app-layer switches; empty today. 预留的应用层开关；当前为空。 */
  reserved?: false
}

export const Config: z<Config> = z.object({}).description('Reserved; no app-layer options yet.')

// 框架与宿主服务都是显式硬 inject（G13）：本插件就是应用层，缺任何一个都不激活——
// 绝不运行期探测。页面工具还要读 agentPresets 解析调用者归属，同样显式声明。
// The framework and the host service are declared hard injects (G13): this
// plugin IS the application layer and stays pending without either — never a
// runtime probe. The page tools also read agentPresets to resolve the caller;
// declared just as explicitly.
export const inject = ['apps', 'notebook', 'agentPresets', 'taskCenter', 'pageRegistry']
export const provide = []

export const apply = (ctx: Context): void => {
  // The app acts through the host service's public tools port: every mounted
  // page tool writes the one table the panel reads.
  // 应用经宿主服务的公开工具端口行动：挂载的每个页面工具都写在面板所读的同一张表上。
  registerNotebookApp(ctx, () => ctx.notebook.toolsPort())
}
