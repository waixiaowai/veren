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
 * 4. 任务通道（ctx.taskCenter.send）缺席时优雅降级，不阻塞激活。
 * @module @veren/task-workbench
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { APP_DEFINITION, APP_ID, createAppTools, createTaskChannel } from './app.ts'
import { detailPage, listPage, publishPage } from './pages.tsx'
import { TaskStore, makeList } from './store.ts'

export const name = 'veren-task-workbench'

export interface Config {
  /** 初始示例任务数量 / initial number of sample tasks */
  listSize: number
}

export const Config: z<Config> = z.object({
  listSize: z.number().default(5).description('初始示例任务数量 / initial number of sample tasks'),
})

/** apps 必需（本插件就是应用）；pageRegistry 由 app-registry 的镜像面内部使用 */
export const inject = ['apps', 'pageRegistry']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  const store = new TaskStore(makeList(config.listSize))
  const channel = createTaskChannel(ctx, ctx.logger)

  // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除，
  //    且镜像面会先摘该应用所有活会话的页面工具（会话保留）
  ctx.effect(() => apps.register(APP_DEFINITION, ctx), 'task-workbench:app')

  // 2) 工具目录先于页面：页面 tools 字段引用的本地名必须已在目录里（fail loud）
  const tools = apps.tools(APP_ID, ctx)
  for (const tool of createAppTools(store, channel)) {
    ctx.effect(() => tools.define(tool), `task-workbench:tool:${tool.name}`)
  }

  // 3) 页面注册：单入口。app-registry 内部镜像进 page-registry（可被 openUrl
  //    解析）；镜像失败会回滚并抛错，不会出现"目录可见却打不开"的静默漂移。
  const pages = apps.pages(APP_ID, ctx)
  for (const page of [listPage, detailPage, publishPage]) {
    ctx.effect(() => pages.register(page as never), `task-workbench:page:${page.name}`)
  }
}
