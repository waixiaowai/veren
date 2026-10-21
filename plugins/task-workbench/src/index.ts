/**
 * @veren/task-workbench 插件入口：注册「任务工作台」应用（定义 → 工具 → 页面）。
 * Plugin entry: registers the task-workbench app (definition → tools → pages).
 *
 * 这是「怎样写一个 Veren 应用」的参考实现（README 有完整流程）：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. ctx.apps.tools(id, ctx) —— 定义应用级工具目录（本地名，前缀由注册表拼）；
 * 3. ctx.apps.pages(id, ctx) —— 注册页面（/apps/<appId>/...，tools 引用本地名）。
 *    页面注册是单入口：app-registry 内部自动镜像进 page-registry 的 URL 索引，
 *    应用作者不再（也不能）自己调 ctx.pageRegistry.registerAppPage。
 * 4. 依赖全部显式声明（G13）：apps / pageRegistry / taskCenter 都是硬 inject，
 *    没有任何运行期探测兄弟服务的降级通道——那条通道在真实宿主上从未生效过。
 * @module @veren/task-workbench
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AppCapability } from '@veren/app-registry'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
import { APP_DEFINITION, APP_ID, createAppTools, createTaskChannel, PUBLISH_TASK_REQUIRES } from './app.ts'
import { createTaskPages } from './pages.tsx'
import { TaskStore, makeList } from './store.ts'
import type { PageTaskScope } from './types.ts'

export const name = 'veren-task-workbench'

export interface Config {
  /** 初始示例任务数量 / initial number of sample tasks */
  listSize: number
}

export const Config: z<Config> = z.object({
  listSize: z.number().default(5).description('初始示例任务数量 / initial number of sample tasks'),
})

/** 三个服务依赖全部显式声明：本插件就是应用，任务中心是发布/拆分的必经面 */
export const inject = ['apps', 'pageRegistry', 'taskCenter']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  // 任务中心是声明的硬 inject：通道从注入的服务面纯参数构建，不再探测 ctx。
  // taskCenter is a declared hard inject: the channel is built from the injected
  // service face as a pure parameter — no ctx probing.
  const channel = createTaskChannel(ctx.taskCenter)
  const store = new TaskStore(makeList(config.listSize))
  // 页面作用域解析面（take_page_task 的"本页那条"）：用 page-registry 实例索引
  // 反查本会话在详情页上的 live 行——URL 里已有 taskId，接取天然受限，不靠参数。
  // / The page-scope resolver (take_page_task's "this page's task"): look this
  // session's live detail row up through the page-registry instance index — the
  // url already carries the taskId, so the take is naturally scoped, parameter-free.
  const scope: PageTaskScope = {
    liveDetailTaskOf: async (sessionId) => {
      const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
      const row = rows.find((candidate) => candidate.state === 'live'
        && candidate.sessionId === sessionId
        && candidate.page === `${APP_ID}/detail`)
      if (row === undefined) return undefined
      // params 键与 URL 模式逐字一致是注册期/挂载期的门禁（§3.10.5 规则 5），
      // 这里只为类型面如实收窄，不构造缺省值。
      // / params keys matching the url pattern are gated at registration/mount
      // (§3.10.5 rule 5); this is just the honest type-face narrowing, no default.
      const taskId: string | undefined = row.params.taskId
      if (taskId === undefined || taskId.length === 0) return undefined
      return { taskId, url: row.url }
    },
  }

  // 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面，体内任何一步失败都把
  // 已完成的步骤逆序回滚——绝不留下"应用在、工具缺页"的半接线状态。
  // One effect owns the wiring (G13 rule 3): definition → tools → pages; any
  // failing step rolls the finished ones back in reverse, never leaving a
  // half-wired "app present, tools/pages missing" state.
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具目录先于页面：defineTool 产物进应用目录（publish 需要 tasks:send
      //    能力，经 define 的 meta 参数声明；take_page_task 带页面作用域解析面）
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of createAppTools(store, channel, scope)) {
        done.push(tools.define(tool, tool.name === 'publish_task'
          ? { requires: [...PUBLISH_TASK_REQUIRES] as AppCapability[] }
          : undefined))
      }
      // 3) 页面注册（组件形态，RFC prompt-page-render §3.5）：单入口，app-registry
      //    内部镜像进 page-registry（可被 openUrl 解析）；镜像失败会回滚并抛错。
      //    三页闭包引用本次装配的权威 store（§3.10.3）：组件经 useSnapshot 读它，
      //    变化经 PAGE-PATCH 增量进上下文——单一事实源，无第二数据源。
      // 3) Page registration (component form, RFC prompt-page-render §3.5):
      //    single entry, app-registry mirrors into page-registry internally
      //    (resolvable by openUrl); a mirror failure rolls back and throws. All
      //    three pages close over this assembly's authoritative store
      //    (§3.10.3): components read it via useSnapshot, and changes reach the
      //    context as PAGE-PATCH blocks — a single source of fact, no second
      //    data source.
      const pages = apps.pages(APP_ID, ctx)
      const taskPages = createTaskPages(store)
      done.push(pages.register(taskPages.ListPage, taskPages.ListMeta))
      done.push(pages.register(taskPages.DetailPage, taskPages.DetailMeta))
      done.push(pages.register(taskPages.PublishPage, taskPages.PublishMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    // 本接线不持有独立资源：清理全部由注册表侧的 disposer 承担，effect 返回空清理器。
    // This wiring owns no standalone resource: cleanup lives in the registry
    // disposers, so the effect returns a no-op disposer.
    return () => undefined
  }, 'task-workbench:app')
}
